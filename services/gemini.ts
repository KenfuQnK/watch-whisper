import { SearchResult, MediaType, SeasonData } from "../types";
import { GoogleGenAI } from "@google/genai";
import { getAiCache, setAiCache, updateMediaItem } from "./db";

// --- HELPERS ---
const cleanTitle = (title: string, year: string) => `${title.toLowerCase().trim()}-${year}`;
const buildCacheKey = (item: SearchResult) => `${item.source}-${item.externalId}`;

const enrichmentCache = new Map<string, SearchResult>();
const discardedCache = new Set<string>();

// Regex to validate real YouTube URLs (prevents AI hallucinations)
const YOUTUBE_REGEX = /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
const GEMINI_MODEL = "gemini-2.5-flash";

const extractText = (data: any) => {
    if (!data) return "";
    const parts = data.candidates?.[0]?.content?.parts;
    if (!parts || !Array.isArray(parts)) return "";
    return parts.map((p: any) => p.text || "").join("");
};

const fetchWithRetry = async (url: string, options: RequestInit = {}, retries = 2, delayMs = 750): Promise<Response> => {
    let attempt = 0;
    let lastError: any = null;

    while (attempt <= retries) {
        try {
            const res = await fetch(url, options);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res;
        } catch (err) {
            lastError = err;
            attempt++;
            if (attempt > retries) break;
            await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
        }
    }

    throw lastError;
};

const callGemini = async (body: any) => {
    if (!process.env.API_KEY) {
        console.warn("No API_KEY found for Gemini operations");
        return null;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.API_KEY}`;

    try {
        const res = await fetchWithRetry(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });

        return await res.json();
    } catch (e) {
        console.warn("Gemini request failed", e);
        return null;
    }
};

// Detect language and translate to Spanish when needed
export const enrichInSpanish = async (
  item: Pick<SearchResult, "title" | "description" | "type" | "year"> & { id: string }
): Promise<{ title: string; description: string } | null> => {
  try {
    if (!process.env.API_KEY) {
      console.warn("No API_KEY found for Gemini translation");
      return null;
    }

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const prompt = `Detecta el idioma del siguiente contenido. Si no es español, traduce el título y la sinopsis a español neutro. 
    Devuelve siempre un JSON con la forma { "language": "<codigo>", "title": "<titulo_es>", "description": "<sinopsis_es>" } sin texto adicional.
    Título: "${item.title}"
    Sinopsis: "${item.description}"
    Tipo: ${item.type}
    Año: ${item.year || ""}`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      generationConfig: {
        responseMimeType: "application/json"
      }
    });

    const raw = response.text || "";
    const parsed = JSON.parse(raw);
    const detectedLang = (parsed.language || "").toString().toLowerCase();

    if (detectedLang === "es") {
      return null;
    }

    const translatedTitle = parsed.title || item.title;
    const translatedDescription = parsed.description || item.description;

    return { title: translatedTitle, description: translatedDescription };
  } catch (e) {
    console.warn("Gemini translation failed", e);
    return null;
  }
};

// Detect language and translate to Spanish when needed
export const enrichInSpanish = async (
  item: Pick<SearchResult, "title" | "description" | "type" | "year"> & { id: string }
): Promise<{ title: string; description: string } | null> => {
  try {
    if (!process.env.API_KEY) {
      console.warn("No API_KEY found for Gemini translation");
      return null;
    }

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const prompt = `Detecta el idioma del siguiente contenido. Si no es español, traduce el título y la sinopsis a español neutro.
Devuelve un JSON exacto con la forma { "language": "<codigo>", "title": "<titulo_es>", "description": "<sinopsis_es>" } sin comentario adicional.
Título: "${item.title}"
Sinopsis: "${item.description}"
Tipo: ${item.type}
Año: ${item.year || ""}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json"
      }
    });

    const raw = response.response?.text() || "";
    const cleaned = raw.trim().replace(/^```json\n?|```$/g, "");
    const parsed = JSON.parse(cleaned);
    const detectedLang = (parsed.language || "").toString().toLowerCase();

    if (detectedLang === "es") {
      return null;
    }

    const translatedTitle = parsed.title || item.title;
    const translatedDescription = parsed.description || item.description;

    return { title: translatedTitle, description: translatedDescription };
  } catch (e) {
    console.warn("Gemini translation failed", e);
    return null;
  }
};

// --- AI TRAILER SEARCH (Background Process) ---
export const fetchTrailerInBackground = async (
    title: string,
    year: string,
    type: MediaType,
    itemId: string,
    currentSource?: { title: 'api' | 'ai'; description: 'api' | 'ai'; trailer: 'api' | 'ai' }
): Promise<string> => {
    try {
        const cached = getAiCache(title, year, type);
        if (cached?.trailerUrl) {
            console.log(`♻️ Reutilizando tráiler cacheado para ${title} (${year})`);
            await updateMediaItem(itemId, { trailerUrl: cached.trailerUrl });
            return cached.trailerUrl;
        }

        if (!process.env.API_KEY) {
            console.warn("No API_KEY found for Gemini trailer search");
            return "";
        }

        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        
        const prompt = `Find the official YouTube trailer URL for the ${type} "${title}" released in ${year}. 
        Return ONLY the raw YouTube URL. Do not include words like "Here is the link". Just the URL.`;

        const response = await callGemini({
            contents: [{ parts: [{ text: prompt }] }],
            tools: [{ googleSearch: {} }],
            generationConfig: {
                temperature: 0.4
            }
        });

        if (!response) return "";

        const text = extractText(response);

        // 1. Extract potential URL from text
        const urlMatch = text.match(/https?:\/\/[^\s]+/);
        const candidateUrl = urlMatch ? urlMatch[0] : "";

        // 2. Validate it is a real YouTube link
        const isValid = YOUTUBE_REGEX.test(candidateUrl);

        if (isValid) {
            console.log(`✅ Trailer validado para ${title}: ${candidateUrl}`);
            const newSource = currentSource ? { ...currentSource, trailer: 'ai' } : { title: 'api', description: 'api', trailer: 'ai' };
            // Save to DB
            await updateMediaItem(itemId, { trailerUrl: candidateUrl, source: newSource });
            return candidateUrl;
        } else {
            if (text) {
                console.warn(`❌ Gemini encontró algo pero no es un link válido de YT: ${text}`);
            }

            // Fallback: Check grounding chunks if text failed (sometimes links are in metadata)
            const chunks = response?.candidates?.[0]?.groundingMetadata?.groundingChunks;
            if (chunks) {
                for (const chunk of chunks) {
                    if (chunk.web?.uri && YOUTUBE_REGEX.test(chunk.web.uri)) {
                         const validUri = chunk.web.uri;
                         console.log(`✅ Trailer encontrado en metadatos para ${title}: ${validUri}`);
                         const newSource = currentSource ? { ...currentSource, trailer: 'ai' } : { title: 'api', description: 'api', trailer: 'ai' };
                         await updateMediaItem(itemId, { trailerUrl: validUri, source: newSource });
                         return validUri;
                    }
                }
            }
            return "";
        }

    } catch (e) {
        console.warn("Gemini trailer search failed", e);
        return "";
    }
};

// --- TRANSLATION (Background Process) ---
export const translateDescriptionInBackground = async (title: string, description: string): Promise<string> => {
    try {
        const prompt = `Traduce al español neutro la siguiente sinopsis de ${title}. No agregues prefijos ni explicaciones, solo devuelve el texto limpio en español. Texto: """${description}"""`;

        const response = await callGemini({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.3
            }
        });

        return extractText(response).trim();
    } catch (e) {
        console.warn("Gemini translation failed", e);
        return "";
    }
};


// --- API CLIENTS (SIN IA) ---

// 1. CinemaMeta (Stremio Catalog) - VERY ROBUST, CORS Friendly
const fetchMoviesFromCinemaMeta = async (query: string): Promise<SearchResult[]> => {
    try {
        const url = `https://v3-cinemeta.strem.io/catalog/movie/top/search=${encodeURIComponent(query)}.json`;
        const res = await fetchWithRetry(url);
        const data = await res.json();

        if (!data.metas || !Array.isArray(data.metas)) return [];

        return data.metas.map((item: any) => ({
            id: `cinemeta-${item.imdb_id || item.id}`,
            externalId: item.imdb_id || item.id,
            source: 'cinemeta',
            title: item.name,
            type: MediaType.MOVIE,
            year: item.releaseInfo ? item.releaseInfo.substring(0, 4) : '',
            description: item.description || 'Sin descripción (Fuente: CinemaMeta)',
            posterUrl: item.poster || '',
            backupPosterUrl: item.poster ? item.poster.replace('large', 'medium') : '',
        }));
    } catch (e) {
        // Silently fail for individual providers to avoid console spam
        return [];
    }
}

// 2. iTunes Search API (Best for Spanish data)
const fetchMoviesFromItunes = async (query: string): Promise<SearchResult[]> => {
  try {
    const targetUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=movie&entity=movie&country=ES&lang=es_es&limit=15`;

    // Changed Proxy: corsproxy.io (403 error) -> api.allorigins.win (More permissive)
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;

    const res = await fetchWithRetry(proxyUrl);

    // If proxy fails, just return empty array without throwing loud error
    if (!res.ok) return [];

    const data = await res.json();

    return (data.results || []).map((item: any) => ({
      id: `itunes-${item.trackId}`,
      externalId: item.trackId,
      source: 'itunes',
      title: item.trackName,
      type: MediaType.MOVIE,
      year: item.releaseDate ? item.releaseDate.substring(0, 4) : '',
      description: item.longDescription || item.shortDescription || 'Sin descripción.',
      posterUrl: item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb', '600x900bb') : '',
      backupPosterUrl: item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb', '400x600bb') : '',
    }));
  } catch (e) {
    // Silently fail to keep console clean
    return [];
  }
};

// 3. TVMaze API (Primary for Series)
const fetchSeriesFromTvMaze = async (query: string): Promise<SearchResult[]> => {
  try {
    const url = `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`;
    const res = await fetchWithRetry(url);
    const data = await res.json();

    return data.map((item: any) => {
      const show = item.show;
      return {
        id: `tvmaze-${show.id}`,
        externalId: show.id,
        source: 'tvmaze',
        title: show.name,
        type: MediaType.SERIES,
        year: show.premiered ? show.premiered.substring(0, 4) : '',
        description: show.summary ? show.summary.replace(/<[^>]*>/g, '') : 'Sin descripción.',
        posterUrl: show.image?.original || '',
        backupPosterUrl: show.image?.medium || '',
      };
    });
  } catch (e) {
    return [];
  }
};

// --- MAIN SEARCH FUNCTION ---

export const searchMedia = async (query: string): Promise<SearchResult[]> => {
  const [itunesMovies, cinemetaMovies, series] = await Promise.all([
    fetchMoviesFromItunes(query),
    fetchMoviesFromCinemaMeta(query),
    fetchSeriesFromTvMaze(query)
  ]);

  const movieMap = new Map<string, SearchResult>();

  // 1. Add CinemaMeta movies
  cinemetaMovies.forEach(m => {
      movieMap.set(cleanTitle(m.title, m.year), m);
  });

  // 2. Add/Overwrite with iTunes movies
  itunesMovies.forEach(m => {
      const key = cleanTitle(m.title, m.year);
      movieMap.set(key, m);
  });

  const finalMovies = Array.from(movieMap.values());
  const combined: SearchResult[] = [];
  const maxLen = Math.max(finalMovies.length, series.length);

  for (let i = 0; i < maxLen; i++) {
      if (i < series.length) combined.push(series[i]);
      if (i < finalMovies.length) combined.push(finalMovies[i]);
  }

  return combined;
};

// --- POST-PROCESSING (AI ONLY WHEN NEEDED) ---

export const postProcessMediaData = async (item: SearchResult): Promise<SearchResult> => {
  const needsTitle = !item.title || item.title.trim() === "";
  const needsDescription = !item.description || item.description.trim() === "" || item.description.toLowerCase().includes("sin descripción");

  // If everything is already populated, skip AI entirely
  if (!needsTitle && !needsDescription) return item;

  if (!process.env.API_KEY) {
    console.warn("No API_KEY configured for AI post-processing; returning original data");
    return item;
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const prompt = `Recibe la ficha de un título audiovisual y completa SOLO los campos faltantes en español.`
      + ` Si ya existen, respétalos.`
      + ` Devuelve un JSON plano con las claves \"title\" y \"description\" en español.`
      + ` Datos conocidos: ${JSON.stringify({
          title: item.title,
          description: item.description,
          year: item.year,
          type: item.type,
          source: item.source,
        })}`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });

    const rawText = (typeof response.text === 'function' ? response.text() : response.text) || '';
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

    return {
      ...item,
      title: needsTitle && parsed.title ? parsed.title : item.title,
      description: needsDescription && parsed.description ? parsed.description : item.description,
    };
  } catch (e) {
    console.warn("AI post-processing failed", e);
    return item;
  }
};

// --- ENRICHMENT FUNCTION ---
// ONLY fetches structural data (Episodes), NOT the trailer (which is slow)
export const getSeriesDetails = async (item: SearchResult): Promise<SearchResult> => {
  let enrichedItem = { ...item };

  if (item.source === 'tvmaze' && item.type === MediaType.SERIES) {
    try {
      const url = `https://api.tvmaze.com/shows/${item.externalId}/episodes`;
      const res = await fetchWithRetry(url);
      const episodes = await res.json();

      const seasonMap: Record<number, number> = {};
      episodes.forEach((ep: any) => {
        const s = ep.season;
        seasonMap[s] = (seasonMap[s] || 0) + 1;
      });

      const seasons: SeasonData[] = Object.keys(seasonMap).map(s => ({
        seasonNumber: parseInt(s),
        episodeCount: seasonMap[parseInt(s)]
      }));

      enrichedItem.seasons = seasons;
    } catch (e) {
      console.error("Error fetching episodes", e);
    }
  }

  return enrichedItem;
};
