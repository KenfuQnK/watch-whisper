import { SearchResult, MediaType, SeasonData, MediaItem } from "../types";
import { GoogleGenAI } from "@google/genai";
import { updateMediaItem } from "./db";

// --- HELPERS ---
const cleanTitle = (title: string, year: string) => `${title.toLowerCase().trim()}-${year}`;

// Regex to validate real YouTube URLs (standard watch URLs and short URLs)
const YOUTUBE_REGEX = /(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

// --- AI ENRICHMENT PIPELINE (Background Process) ---
// This acts "After" the API data is saved. It polishes the data.
export const enrichMediaContent = async (item: MediaItem): Promise<void> => {
    if (item.isEnriched) return; 

    console.log(`🤖 [AI] START: Iniciando enriquecimiento para "${item.title}"...`);

    try {
        if (!process.env.API_KEY) {
            console.warn("❌ [AI] No API_KEY found");
            return;
        }

        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        
        // Simplified prompt focusing on Search first, JSON second.
        const prompt = `
        TASK: Find metadata and a YouTube trailer for the ${item.type}: "${item.title}" (${item.year}).

        STEPS:
        1. USE THE 'googleSearch' TOOL to search for: "trailer español ${item.title} ${item.year} youtube".
        2. From the search results, COPY the most accurate YouTube URL (watch?v=...).
        3. Translate Title and Description to Spanish (Spain).
        4. Output the result in JSON format.

        JSON STRUCTURE:
        {
            "spanishTitle": "...",
            "spanishDescription": "...",
            "trailerUrl": "..."
        }
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                tools: [{ googleSearch: {} }], 
            }
        });

        let resultText = response.text;
        
        if (!resultText) {
            console.warn(`⚠️ [AI] Respuesta vacía para ${item.title}`);
            return;
        }

        console.log(`🤖 [AI] Respuesta Bruta para ${item.title}:`, resultText.substring(0, 200) + "...");

        // --- STRATEGY 1: Parse JSON ---
        let result: any = {};
        let jsonSuccess = false;

        try {
            const cleanText = resultText.replace(/```json/g, '').replace(/```/g, '').trim();
            // Try to find the JSON block if there is extra text around it
            const firstBrace = cleanText.indexOf('{');
            const lastBrace = cleanText.lastIndexOf('}');
            
            if (firstBrace !== -1 && lastBrace !== -1) {
                const jsonString = cleanText.substring(firstBrace, lastBrace + 1);
                result = JSON.parse(jsonString);
                jsonSuccess = true;
            }
        } catch (e) {
            console.warn(`⚠️ [AI] JSON parsing failed for ${item.title}. Trying text fallback.`);
        }

        // --- STRATEGY 2: Fallback extraction (The Safety Net) ---
        // If JSON didn't give us a URL, scan the WHOLE text for a YouTube link.
        // Google Search tool often puts the link in the text even if JSON fails.
        let finalTrailerUrl = '';

        if (jsonSuccess && result.trailerUrl && YOUTUBE_REGEX.test(result.trailerUrl)) {
            finalTrailerUrl = result.trailerUrl;
            console.log(`✅ [AI] URL encontrada via JSON: ${finalTrailerUrl}`);
        } else {
            // REGEX HUNT
            console.log(`🔍 [AI] Buscando URL en texto plano (Fallback)...`);
            const match = resultText.match(YOUTUBE_REGEX);
            if (match && match[0]) {
                finalTrailerUrl = match[0];
                console.log(`✅ [AI] URL encontrada via REGEX en texto: ${finalTrailerUrl}`);
            } else {
                console.log(`❌ [AI] No se encontró ninguna URL válida en la respuesta.`);
            }
        }

        // --- MERGE & SAVE ---
        const updates: Partial<MediaItem> = { isEnriched: true };
        
        if (jsonSuccess && result.spanishTitle && result.spanishTitle !== item.title) {
            updates.title = result.spanishTitle;
            updates.originalTitle = item.title;
        }

        if (jsonSuccess && result.spanishDescription) {
            updates.description = result.spanishDescription;
        }

        if (finalTrailerUrl) {
            updates.trailerUrl = finalTrailerUrl;
        }

        console.log(`💾 [AI] Guardando cambios en DB para ${item.title}:`, updates);
        
        // Save to DB
        await updateMediaItem(item.id, updates);

    } catch (e) {
        console.error("❌ [AI] CRITICAL ERROR:", e);
        // Mark as enriched to stop loop
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