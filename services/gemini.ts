import { SearchResult, MediaType, SeasonData, MediaItem } from "../types";
import { GoogleGenAI } from "@google/genai";
import { updateMediaItem } from "./db";

// --- HELPERS ---
const cleanTitle = (title: string, year: string) => `${title.toLowerCase().trim()}-${year}`;

// Regex to validate real YouTube URLs
const YOUTUBE_REGEX = /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

// --- AI ENRICHMENT PIPELINE (Background Process) ---
// This acts "After" the API data is saved. It polishes the data.
export const enrichMediaContent = async (item: MediaItem): Promise<void> => {
    if (item.isEnriched) return; // Cache check: Don't process twice

    try {
        if (!process.env.API_KEY) {
            console.warn("No API_KEY found for Gemini enrichment");
            return;
        }

        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        
        // NOTE: We cannot use 'responseMimeType: application/json' together with 'tools: googleSearch'
        // in the current API version. We must ask for JSON in the prompt text.

        const prompt = `
        You are a cinema metadata expert for a Spanish audience.
        Target Item: ${item.type} "${item.title}" (${item.year}).
        
        GOAL: Validate metadata and find a REAL, WORKING YouTube trailer.
        
        INSTRUCTIONS:
        1. SPANISH INFO: Translate Title and Description to Spanish (Spain).
        2. TRAILER SEARCH (CRITICAL): 
           - You MUST use the 'googleSearch' tool to search for: "trailer oficial español ${item.title} ${item.year} youtube".
           - Look for results from "Netflix", "HBO", "Disney", "Universal", "Warner", or official movie channels.
           - EXTRACT the EXACT URL from the search result. 
           - DO NOT GUESS OR INVENT A URL. If the search does not provide a direct YouTube link, return an empty string for the trailer.
           - Prefer Spanish audio/subs. If not found, English is acceptable.

        OUTPUT FORMAT:
        Return ONLY a raw JSON string (no markdown).
        {
            "spanishTitle": "string",
            "spanishDescription": "string",
            "trailerUrl": "string (MUST be a valid https://www.youtube.com/watch?v=... found in search, or empty string)"
        }
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                tools: [{ googleSearch: {} }], // Use Grounding for Trailer
            }
        });

        let resultText = response.text;
        if (!resultText) return;

        // Cleanup: Sometimes the model adds markdown code blocks despite instructions
        resultText = resultText.replace(/```json/g, '').replace(/```/g, '').trim();

        let result;
        try {
            result = JSON.parse(resultText);
        } catch (e) {
            console.error("Failed to parse AI JSON response", resultText);
            return;
        }

        // Validation & Merge Logic
        const updates: Partial<MediaItem> = { isEnriched: true };
        
        // Only update title if it's significantly different and exists
        if (result.spanishTitle && result.spanishTitle !== item.title) {
            updates.title = result.spanishTitle;
            updates.originalTitle = item.title; // Backup original
        }

        // Always update description if we got a Spanish one
        if (result.spanishDescription) {
            updates.description = result.spanishDescription;
        }

        // Validate Trailer
        if (result.trailerUrl && YOUTUBE_REGEX.test(result.trailerUrl)) {
            updates.trailerUrl = result.trailerUrl;
        } else {
            // Explicitly set to empty if invalid so we don't keep garbage
            updates.trailerUrl = '';
        }

        console.log(`✨ AI Enriched ${item.title}:`, updates);
        
        // Save to DB (UI will react via subscription)
        await updateMediaItem(item.id, updates);

    } catch (e) {
        console.warn("AI Enrichment failed", e);
        // Mark as enriched anyway so we don't retry infinitely on error
        await updateMediaItem(item.id, { isEnriched: true });
    }
};


// --- API CLIENTS (The "Raw" Data Layer) ---

// 1. iTunes Search API (Best for Spanish data + High Quality Images)
const fetchMoviesFromItunes = async (query: string): Promise<SearchResult[]> => {
  try {
    // Prioritize Spanish (ES) results
    const targetUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=movie&entity=movie&country=ES&lang=es_es&limit=15`;
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
    
    const res = await fetch(proxyUrl);
    if (!res.ok) return [];
    
    const data = await res.json();
    
    return (data.results || []).map((item: any) => ({
      id: `itunes-${item.trackId}`,
      externalId: item.trackId,
      source: 'itunes',
      title: item.trackName, // Usually in Spanish due to country=ES param
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

// 2. CinemaMeta (Stremio Catalog) - Good fallback
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
            description: item.description || '',
            posterUrl: item.poster || '',
            backupPosterUrl: item.poster ? item.poster.replace('large', 'medium') : '',
        }));
    } catch (e) {
        return [];
    }
}

// 3. TVMaze API (Primary for Series structure)
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
// Aggregates raw data, prioritizes iTunes for Movies (better spanish), TVMaze for Series
export const searchMedia = async (query: string): Promise<SearchResult[]> => {
  const [itunesMovies, cinemetaMovies, series] = await Promise.all([
    fetchMoviesFromItunes(query),
    fetchMoviesFromCinemaMeta(query),
    fetchSeriesFromTvMaze(query)
  ]);

  const movieMap = new Map<string, SearchResult>();
  
  // Strategy: 
  // 1. Fill with CinemaMeta (Broad database)
  // 2. Overwrite with iTunes (Better metadata/Spanish/Images)
  
  cinemetaMovies.forEach(m => {
      movieMap.set(cleanTitle(m.title, m.year), m);
  });

  itunesMovies.forEach(m => {
      const key = cleanTitle(m.title, m.year);
      // iTunes is preferred, so we always set/overwrite
      movieMap.set(key, m);
  });

  const finalMovies = Array.from(movieMap.values());
  
  // Interleave results: Series first if query matches strictly? No, simple mix.
  const combined: SearchResult[] = [];
  const maxLen = Math.max(finalMovies.length, series.length);
  
  for (let i = 0; i < maxLen; i++) {
      if (i < series.length) combined.push(series[i]);
      if (i < finalMovies.length) combined.push(finalMovies[i]);
  }
  
  return combined;
};

// --- API SERIES DETAILS ---
// Fast structural fetch (No AI)
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