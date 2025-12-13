import { SearchResult, MediaType, SeasonData } from "../types";
import { GoogleGenAI } from "@google/genai";

// --- HELPERS ---
const cleanTitle = (title: string, year: string) => `${title.toLowerCase().trim()}-${year}`;

// --- AI TRAILER SEARCH ---
// Using Gemini to find the best YouTube link since we don't have a YouTube Data API Key
const fetchTrailerWithGemini = async (title: string, year: string, type: MediaType): Promise<string> => {
    try {
        // NOTE: The process.env.API_KEY must be set in your Vercel project environment variables.
        // For development, ensure you have a .env file or hardcode it temporarily (not recommended for commit).
        if (!process.env.API_KEY) {
            console.warn("No API_KEY found for Gemini trailer search");
            return "";
        }

        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const prompt = `Find the official YouTube trailer URL for the ${type} "${title}" released in ${year}. 
        Prefer a trailer in Spanish (Español de España or Latino). 
        Return ONLY the raw YouTube URL string. If not found, return an empty string. Do not include any text, markdown or explanation.`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });

        const url = response.text?.trim() || "";
        return url.startsWith("http") ? url : "";
    } catch (e) {
        console.warn("Gemini trailer search failed", e);
        return "";
    }
};


// --- API CLIENTS ---

// 1. CinemaMeta (Stremio Catalog) - VERY ROBUST, CORS Friendly
// This is our "SI O SI" backup for movies.
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
        console.warn("CinemaMeta API failed", e);
        return [];
    }
}

// 2. iTunes Search API (Best for Spanish data)
// Changed proxy to corsproxy.io which is often more reliable
const fetchMoviesFromItunes = async (query: string): Promise<SearchResult[]> => {
  try {
    const targetUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=movie&entity=movie&country=ES&lang=es_es&limit=15`;
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;
    
    const res = await fetch(proxyUrl);
    if (!res.ok) throw new Error('Proxy returned error');
    
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
    console.warn("iTunes API failed (likely CORS or network), skipping...", e);
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
    console.error("TVMaze API error", e);
    return [];
  }
};

// --- MAIN SEARCH FUNCTION ---

export const searchMedia = async (query: string): Promise<SearchResult[]> => {
  // Execute all searches in parallel
  // Now using CinemaMeta as the heavy lifter for movies if iTunes fails
  const [itunesMovies, cinemetaMovies, series] = await Promise.all([
    fetchMoviesFromItunes(query),
    fetchMoviesFromCinemaMeta(query),
    fetchSeriesFromTvMaze(query)
  ]);

  const movieMap = new Map<string, SearchResult>();

  // Strategy: Add CinemaMeta first (reliable), then overwrite with iTunes (Spanish) if available
  
  // 1. Add CinemaMeta movies
  cinemetaMovies.forEach(m => {
      movieMap.set(cleanTitle(m.title, m.year), m);
  });

  // 2. Add/Overwrite with iTunes movies (better description/language usually)
  itunesMovies.forEach(m => {
      const key = cleanTitle(m.title, m.year);
      // We prioritize iTunes because it respects the "es_es" language param
      movieMap.set(key, m);
  });

  const finalMovies = Array.from(movieMap.values());

  // Interleave results: Series, Movie, Series, Movie...
  const combined: SearchResult[] = [];
  const maxLen = Math.max(finalMovies.length, series.length);
  
  for (let i = 0; i < maxLen; i++) {
      if (i < series.length) combined.push(series[i]);
      if (i < finalMovies.length) combined.push(finalMovies[i]);
  }
  
  return combined;
};

// --- ENRICHMENT FUNCTION ---
export const getSeriesDetails = async (item: SearchResult): Promise<SearchResult> => {
  // 1. Fetch Episodes (if series)
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

  // 2. Fetch Trailer (for all types) using Gemini
  // We do this in the enrichment phase to avoid slowing down the main search list
  const trailerUrl = await fetchTrailerWithGemini(item.title, item.year, item.type);
  if (trailerUrl) {
      enrichedItem.trailerUrl = trailerUrl;
  }
  
  return enrichedItem;
};