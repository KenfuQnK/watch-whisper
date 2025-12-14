import { SearchResult, MediaType, SeasonData, MediaItem } from "../types";
import { GoogleGenAI } from "@google/genai";
import { updateMediaItem } from "./db";

// --- HELPERS ---
const cleanTitle = (title: string, year: string) => `${title.toLowerCase().trim()}-${year}`;

// Regex to capture ANY YouTube URL found in text
const YOUTUBE_REGEX_GLOBAL = /(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/g;

// --- VALIDATION HELPER ---
const validateYoutubeUrl = async (url: string): Promise<boolean> => {
    try {
        const match = url.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/);
        if (!match) return false;
        
        const cleanUrl = `https://www.youtube.com/watch?v=${match[1]}`;
        const checkUrl = `https://noembed.com/embed?url=${cleanUrl}`;
        
        const res = await fetch(checkUrl);
        const data = await res.json();
        
        if (data.error) {
            console.warn(`❌ [VALIDATOR] URL Inválida/Borrada: ${cleanUrl}`);
            return false;
        }
        
        console.log(`✅ [VALIDATOR] URL Verificada: ${cleanUrl} (${data.title})`);
        return true;
    } catch (e) {
        console.warn("⚠️ [VALIDATOR] Error conectando con servicio de validación", e);
        return false;
    }
};

// --- YOUTUBE API V3 DIRECT ---
const fetchTrailerFromYoutubeApi = async (title: string, year: string): Promise<string | null> => {
    if (!process.env.API_KEY) return null;
    
    // We assume the user has enabled YouTube Data API v3 on this key
    const query = `Trailer oficial español ${title} ${year}`;
    console.log(`🎥 [YOUTUBE API] Buscando: "${query}" via API V3...`);
    
    try {
        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&key=${process.env.API_KEY}&maxResults=1`;
        const res = await fetch(url);
        
        if (!res.ok) {
            console.warn(`⚠️ [YOUTUBE API] Falló (Status: ${res.status}). Probablemente la API no está habilitada en la key.`);
            return null;
        }

        const data = await res.json();
        if (data.items && data.items.length > 0) {
            const videoId = data.items[0].id.videoId;
            const fullUrl = `https://www.youtube.com/watch?v=${videoId}`;
            console.log(`✅ [YOUTUBE API] Encontrado: ${fullUrl}`);
            return fullUrl;
        }
        return null;
    } catch (e) {
        console.warn(`⚠️ [YOUTUBE API] Error de red o config:`, e);
        return null;
    }
};

// --- AI FALLBACK TRAILER SEARCH ---
const findTrailerWithAI = async (item: MediaItem, ai: GoogleGenAI): Promise<string> => {
    const MAX_ATTEMPTS = 3;
    let finalTrailerUrl = '';

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (finalTrailerUrl) break;

        console.log(`🔄 [AI TRAILER] Intento ${attempt}/${MAX_ATTEMPTS} (Fallback)...`);
        
        let searchContext = "";
        if (attempt === 1) searchContext = `trailer español oficial "${item.title}" ${item.year} youtube`;
        if (attempt === 2) searchContext = `trailer official "${item.title}" ${item.year} youtube`;
        if (attempt === 3) searchContext = `trailer "${item.title}" movie youtube`;

        const prompt = `
        TASK: Find a REAL, WORKING YouTube trailer for: "${item.title}" (${item.year}).
        INSTRUCTIONS:
        1. USE 'googleSearch' to search exactly for: '${searchContext}'.
        2. From the search results, EXTRACT any YouTube URLs found.
        3. RETURN JSON: { "potentialUrls": ["url1"] }
        `;

        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: { tools: [{ googleSearch: {} }] }
            });

            const resultText = response.text || "";
            const matches = [...resultText.matchAll(YOUTUBE_REGEX_GLOBAL)];
            const candidates = matches.map(m => m[0]);
            
            for (const url of candidates) {
                const isValid = await validateYoutubeUrl(url);
                if (isValid) {
                    finalTrailerUrl = url;
                    break;
                }
            }
        } catch (e) {
            console.error(`⚠️ [AI TRAILER] Error en intento ${attempt}:`, e);
        }
    }
    return finalTrailerUrl;
}


// --- METADATA ENRICHMENT (TITLE/DESC) ---
const enrichMetadata = async (item: MediaItem, ai: GoogleGenAI): Promise<Partial<MediaItem>> => {
    console.log(`📚 [METADATA] Traduciendo datos para "${item.title}"...`);
    
    const prompt = `
    TASK: Translate the metadata for the ${item.type}: "${item.title}" (${item.year}) to Spanish (Spain).

    CRITICAL RULES:
    1. "spanishTitle" MUST be the OFFICIAL title of the movie/series in Spain.
    2. DO NOT include words like "Trailer", "Teaser", "Review", "Official", "Cast". JUST THE TITLE.
    3. If the title is the same in English and Spanish, keep it.
    4. "spanishDescription" must be a concise synopsis in Spanish.

    JSON STRUCTURE:
    {
        "spanishTitle": "...",
        "spanishDescription": "..."
    }
    `;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt
        });

        const resultText = response.text || "";
        const cleanText = resultText.replace(/```json/g, '').replace(/```/g, '').trim();
        const firstBrace = cleanText.indexOf('{');
        const lastBrace = cleanText.lastIndexOf('}');
        
        if (firstBrace !== -1) {
            const json = JSON.parse(cleanText.substring(firstBrace, lastBrace + 1));
            
            const updates: Partial<MediaItem> = {};
            if (json.spanishTitle && json.spanishTitle !== item.title) {
                // Double check it's not a garbage title
                if (!json.spanishTitle.toLowerCase().includes('trailer')) {
                    updates.title = json.spanishTitle;
                    updates.originalTitle = item.title;
                }
            }
            if (json.spanishDescription) {
                updates.description = json.spanishDescription;
            }
            console.log(`✅ [METADATA] Datos obtenidos:`, updates);
            return updates;
        }
    } catch (e) {
        console.error("❌ [METADATA] Error parsing/fetching metadata", e);
    }
    return {};
};

// --- MAIN PIPELINE (PARALLEL) ---
export const enrichMediaContent = async (item: MediaItem): Promise<void> => {
    if (item.isEnriched) return; 

    if (!process.env.API_KEY) {
        console.warn("❌ [AI] No API_KEY found");
        return;
    }

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    // We launch 2 independent processes:
    // 1. Trailer Search (API -> AI Fallback)
    // 2. Metadata Translation (AI)
    // We update the DB as soon as each one finishes.

    // --- PROCESS 1: TRAILER ---
    const trailerPromise = (async () => {
        // Option A: Direct YouTube API (Best)
        let url = await fetchTrailerFromYoutubeApi(item.title, item.year || '');
        
        // Option B: AI Search Fallback
        if (!url) {
            url = await findTrailerWithAI(item, ai);
        }

        if (url) {
            await updateMediaItem(item.id, { trailerUrl: url });
        }
    })();

    // --- PROCESS 2: METADATA ---
    const metadataPromise = (async () => {
        const changes = await enrichMetadata(item, ai);
        if (Object.keys(changes).length > 0) {
            await updateMediaItem(item.id, changes);
        }
    })();

    try {
        await Promise.allSettled([trailerPromise, metadataPromise]);
        // Mark as enriched finally
        await updateMediaItem(item.id, { isEnriched: true });
        console.log(`🏁 [ENRICHMENT] Finalizado para ${item.title}`);
    } catch (e) {
        console.error("Critical Enrichment Error", e);
        await updateMediaItem(item.id, { isEnriched: true });
    }
};


// --- API CLIENTS (Raw Data Layer) ---

// Helper for timeout fetching
const fetchWithTimeout = async (url: string, timeout = 3000) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(id);
        return response;
    } catch (e) {
        clearTimeout(id);
        throw e;
    }
};

// 1. iTunes Search API (Timeout Protected)
const fetchMoviesFromItunes = async (query: string): Promise<SearchResult[]> => {
  try {
    const targetUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=movie&entity=movie&country=ES&lang=es_es&limit=15`;
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;
    
    const res = await fetchWithTimeout(proxyUrl, 2500); 
    if (!res.ok) throw new Error("iTunes Error");
    
    const data = await res.json();
    
    return (data.results || []).map((item: any) => ({
      id: `itunes-${item.trackId}`,
      externalId: item.trackId,
      source: 'itunes',
      title: item.trackName,
      type: MediaType.MOVIE,
      year: item.releaseDate ? item.releaseDate.substring(0, 4) : '',
      description: item.longDescription || item.shortDescription || '',
      posterUrl: item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb', '600x900bb') : '',
      backupPosterUrl: item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb', '400x600bb') : '',
    }));
  } catch (e) {
    return [];
  }
};

// 2. CinemaMeta (Stremio Catalog)
const fetchMoviesFromCinemaMeta = async (query: string): Promise<SearchResult[]> => {
    try {
        const url = `https://v3-cinemeta.strem.io/catalog/movie/top/search=${encodeURIComponent(query)}.json`;
        const res = await fetchWithTimeout(url, 3000);
        const data = await res.json();
        
        if (!data.metas || !Array.isArray(data.metas)) return [];

        return data.metas.map((item: any) => ({
            id: `cinemeta-${item.imdb_id || item.id}`,
            externalId: item.imdb_id || item.id,
            source: 'cinemeta',
            title: item.name,
            type: MediaType.MOVIE,
            year: item.releaseInfo ? item.releaseInfo.substring(0, 4) : '',
            description: item.description || '',
            posterUrl: item.poster || '',
            backupPosterUrl: item.poster ? item.poster.replace('large', 'medium') : '',
        }));
    } catch (e) {
        return [];
    }
}

// 3. TVMaze API (Series)
const fetchSeriesFromTvMaze = async (query: string): Promise<SearchResult[]> => {
  try {
    const url = `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`;
    const res = await fetchWithTimeout(url, 3000);
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
        description: show.summary ? show.summary.replace(/<[^>]*>/g, '') : '',
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
  
  cinemetaMovies.forEach(m => movieMap.set(cleanTitle(m.title, m.year), m));
  itunesMovies.forEach(m => movieMap.set(cleanTitle(m.title, m.year), m));

  const finalMovies = Array.from(movieMap.values());
  const combined: SearchResult[] = [];
  const maxLen = Math.max(finalMovies.length, series.length);
  
  for (let i = 0; i < maxLen; i++) {
      if (i < series.length) combined.push(series[i]);
      if (i < finalMovies.length) combined.push(finalMovies[i]);
  }
  
  return combined;
};

// --- API SERIES DETAILS ---
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