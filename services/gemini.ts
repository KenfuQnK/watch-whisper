import { SearchResult, MediaType, SeasonData } from "../types";
import { GoogleGenAI } from "@google/genai";
import { updateMediaItem } from "./db";

// --- HELPERS ---
const cleanTitle = (title: string, year: string) => `${title.toLowerCase().trim()}-${year}`;

// Regex to validate real YouTube URLs (prevents AI hallucinations)
const YOUTUBE_REGEX = /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

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
export const fetchTrailerInBackground = async (title: string, year: string, type: MediaType, itemId: string): Promise<string> => {
    try {
        if (!process.env.API_KEY) {
            console.warn("No API_KEY found for Gemini trailer search");
            return "";
        }

        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        
        const prompt = `Find the official YouTube trailer URL for the ${type} "${title}" released in ${year}. 
        Return ONLY the raw YouTube URL. Do not include words like "Here is the link". Just the URL.`;

        // We use the Google Search tool to ensure the link actually exists (Grounding)
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                tools: [{ googleSearch: {} }] 
            }
        });

        const text = response.text || "";
        
        // 1. Extract potential URL from text
        const urlMatch = text.match(/https?:\/\/[^\s]+/);
        const candidateUrl = urlMatch ? urlMatch[0] : "";

        // 2. Validate it is a real YouTube link
        const isValid = YOUTUBE_REGEX.test(candidateUrl);

        if (isValid) {
            console.log(`✅ Trailer validado para ${title}: ${candidateUrl}`);
            // Save to DB
            await updateMediaItem(itemId, { trailerUrl: candidateUrl });
            return candidateUrl;
        } else {
            console.warn(`❌ Gemini encontró algo pero no es un link válido de YT: ${text}`);
            
            // Fallback: Check grounding chunks if text failed (sometimes links are in metadata)
            const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
            if (chunks) {
                for (const chunk of chunks) {
                    if (chunk.web?.uri && YOUTUBE_REGEX.test(chunk.web.uri)) {
                         const validUri = chunk.web.uri;
                         console.log(`✅ Trailer encontrado en metadatos para ${title}: ${validUri}`);
                         await updateMediaItem(itemId, { trailerUrl: validUri });
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


// --- API CLIENTS ---

// 1. CinemaMeta (Stremio Catalog) - VERY ROBUST, CORS Friendly
const fetchMoviesFromCinemaMeta = async (query: string): Promise<SearchResult[]> => {
    try {
        const url = `https://v3-cinemeta.strem.io/catalog/movie/top/search=${encodeURIComponent(query)}.json`;
        const res = await fetch(url);
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
    
    const res = await fetch(proxyUrl);
    
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
    const res = await fetch(url);
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

// --- ENRICHMENT FUNCTION ---
// ONLY fetches structural data (Episodes), NOT the trailer (which is slow)
export const getSeriesDetails = async (item: SearchResult): Promise<SearchResult> => {
  let enrichedItem = { ...item };
  
  if (item.source === 'tvmaze' && item.type === MediaType.SERIES) {
    try {
      const url = `https://api.tvmaze.com/shows/${item.externalId}/episodes`;
      const res = await fetch(url);
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