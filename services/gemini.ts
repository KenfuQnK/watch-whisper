import { SearchResult, MediaType, SeasonData, MediaItem } from "../types";
import { GoogleGenAI } from "@google/genai";
import { updateMediaItem } from "./db";

// --- HELPERS ---
const cleanTitle = (title: string, year: string) => `${title.toLowerCase().trim()}-${year}`;

// --- TMDB API IMPLEMENTATION ---
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

const getTMDBHeaders = () => {
    return {
        accept: 'application/json',
        Authorization: `Bearer ${process.env.TMDB_READ_TOKEN}`
    };
};

const fetchTrailerFromTMDB = async (title: string, year: string, type: MediaType): Promise<string | null> => {
    if (!process.env.TMDB_READ_TOKEN) {
        console.warn("⚠️ [TMDB] No TMDB_READ_TOKEN found. Skipping trailer search.");
        return null;
    }

    try {
        const tmdbType = type === MediaType.MOVIE ? 'movie' : 'tv';
        const yearParam = type === MediaType.MOVIE ? `&primary_release_year=${year}` : `&first_air_date_year=${year}`;
        
        // 1. Search for the ID
        const searchUrl = `${TMDB_BASE_URL}/search/${tmdbType}?query=${encodeURIComponent(title)}&include_adult=false&language=es-ES&page=1${yearParam}`;
        
        const searchRes = await fetch(searchUrl, { headers: getTMDBHeaders() });
        const searchData = await searchRes.json();

        if (!searchData.results || searchData.results.length === 0) {
            console.log(`⚠️ [TMDB] No results found for "${title}"`);
            return null;
        }

        // Best match implies first result usually, but let's check basic title match if possible? 
        // TMDB search is usually good enough to take the first one.
        const tmdbId = searchData.results[0].id;

        // 2. Get Videos for that ID
        // We look for 'es-ES' first, then fallback to 'en-US' (trailers are often in English)
        let videoResults = [];
        
        // Try Spanish
        const videosEsUrl = `${TMDB_BASE_URL}/${tmdbType}/${tmdbId}/videos?language=es-ES`;
        const videosEsRes = await fetch(videosEsUrl, { headers: getTMDBHeaders() });
        const videosEsData = await videosEsRes.json();
        
        if (videosEsData.results) videoResults = [...videosEsData.results];

        // Try English if no spanish trailer found
        if (!videoResults.some(v => v.type === "Trailer")) {
            const videosEnUrl = `${TMDB_BASE_URL}/${tmdbType}/${tmdbId}/videos?language=en-US`;
            const videosEnRes = await fetch(videosEnUrl, { headers: getTMDBHeaders() });
            const videosEnData = await videosEnRes.json();
            if (videosEnData.results) videoResults = [...videoResults, ...videosEnData.results];
        }

        // 3. Filter: Site=YouTube, Type=Trailer
        const trailer = videoResults.find(v => v.site === "YouTube" && v.type === "Trailer");

        if (trailer) {
            const finalUrl = `https://www.youtube.com/watch?v=${trailer.key}`;
            console.log(`✅ [TMDB] Trailer found: ${finalUrl}`);
            return finalUrl;
        }

        // Fallback: Teaser?
        const teaser = videoResults.find(v => v.site === "YouTube" && v.type === "Teaser");
        if (teaser) {
             return `https://www.youtube.com/watch?v=${teaser.key}`;
        }

        return null;

    } catch (e) {
        console.error("❌ [TMDB] Error fetching trailer:", e);
        return null;
    }
};

// --- METADATA ENRICHMENT (TITLE/DESC) ---
// Still using AI for translation/metadata normalization as requested previously
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

    // We allow enrichment even if one key is missing, we just skip that part
    
    // --- PROCESS 1: TRAILER (TMDB) ---
    const trailerPromise = (async () => {
        const url = await fetchTrailerFromTMDB(item.title, item.year || '', item.type);
        if (url) {
            await updateMediaItem(item.id, { trailerUrl: url });
        }
    })();

    // --- PROCESS 2: METADATA (GEMINI) ---
    const metadataPromise = (async () => {
        if (!process.env.API_KEY) return;
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
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