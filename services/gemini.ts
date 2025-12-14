import { SearchResult, MediaType, SeasonData, MediaItem } from "../types";
import { GoogleGenAI } from "@google/genai";
import { updateMediaItem } from "./db";

// --- HELPERS ---
const cleanTitle = (title: string, year: string) => `${title.toLowerCase().trim()}-${year}`;

// Regex to capture ANY YouTube URL found in text
const YOUTUBE_REGEX_GLOBAL = /(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/g;

// --- VALIDATION HELPER ---
// Uses noembed.com (CORS friendly) to check if a video actually exists and is public.
const validateYoutubeUrl = async (url: string): Promise<boolean> => {
    try {
        // Extract ID to clean up URL before checking
        const match = url.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/);
        if (!match) return false;
        
        const cleanUrl = `https://www.youtube.com/watch?v=${match[1]}`;
        const checkUrl = `https://noembed.com/embed?url=${cleanUrl}`;
        
        const res = await fetch(checkUrl);
        const data = await res.json();
        
        // noembed returns { error: "..." } if invalid
        if (data.error) {
            console.warn(`❌ [VALIDATOR] URL Inválida/Borrada: ${cleanUrl}`);
            return false;
        }
        
        console.log(`✅ [VALIDATOR] URL Verificada: ${cleanUrl} (${data.title})`);
        return true;
    } catch (e) {
        // If validation service fails, we assume false to be safe, or true if we trust regex? 
        // Let's assume false to avoid broken links.
        console.warn("⚠️ [VALIDATOR] Error conectando con servicio de validación", e);
        return false;
    }
};

// --- AI ENRICHMENT PIPELINE (Background Process) ---
export const enrichMediaContent = async (item: MediaItem): Promise<void> => {
    if (item.isEnriched) return; 

    console.log(`🤖 [AI] START: Buscando datos VERIFICADOS para "${item.title}"...`);

    if (!process.env.API_KEY) {
        console.warn("❌ [AI] No API_KEY found");
        return;
    }

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    let finalTrailerUrl = '';
    let spanishTitle = '';
    let spanishDescription = '';
    
    // RETRY LOOP FOR TRAILER
    // We will try up to 3 times to find a working URL
    const MAX_ATTEMPTS = 3;
    
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (finalTrailerUrl) break; // Exit if found

        console.log(`🔄 [AI] Intento ${attempt}/${MAX_ATTEMPTS} buscando trailer...`);
        
        // Varies prompt slightly to try different angles
        let searchContext = "";
        if (attempt === 1) searchContext = `trailer español oficial "${item.title}" ${item.year} youtube`; // Specific Spanish
        if (attempt === 2) searchContext = `trailer official "${item.title}" ${item.year} youtube`; // English/Global
        if (attempt === 3) searchContext = `trailer "${item.title}" movie youtube`; // Broad

        const prompt = `
        TASK: Find metadata and a REAL, WORKING YouTube trailer for: "${item.title}" (${item.year}).
        
        INSTRUCTIONS:
        1. USE 'googleSearch' to search exactly for: '${searchContext}'.
        2. From the search results, EXTRACT any YouTube URLs found.
        3. Translate Title/Description to Spanish (Spain).
        4. Output valid JSON.

        JSON STRUCTURE:
        {
            "spanishTitle": "...",
            "spanishDescription": "...",
            "potentialUrls": ["url1", "url2"] 
        }
        `;

        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: { tools: [{ googleSearch: {} }] }
            });

            const resultText = response.text || "";
            
            // 1. Extract Metadata (Only on first attempt or if missing)
            if (!spanishDescription) {
                try {
                    const cleanText = resultText.replace(/```json/g, '').replace(/```/g, '').trim();
                    const firstBrace = cleanText.indexOf('{');
                    const lastBrace = cleanText.lastIndexOf('}');
                    if (firstBrace !== -1) {
                        const json = JSON.parse(cleanText.substring(firstBrace, lastBrace + 1));
                        spanishTitle = json.spanishTitle;
                        spanishDescription = json.spanishDescription;
                    }
                } catch(e) { /* Ignore JSON parse error, focus on regex later */ }
            }

            // 2. Extract ALL YouTube URLs from the raw text (ignoring JSON structure issues)
            const matches = [...resultText.matchAll(YOUTUBE_REGEX_GLOBAL)];
            const candidates = matches.map(m => m[0]);
            
            console.log(`🔎 [AI] URLs candidatas encontradas en texto:`, candidates);

            // 3. Verify Candidates
            for (const url of candidates) {
                const isValid = await validateYoutubeUrl(url);
                if (isValid) {
                    finalTrailerUrl = url;
                    break; // Found one! Stop checking candidates.
                }
            }

        } catch (e) {
            console.error(`⚠️ [AI] Error en intento ${attempt}:`, e);
        }
    }

    // --- SAVE RESULT ---
    const updates: Partial<MediaItem> = { isEnriched: true };
    
    if (spanishTitle && spanishTitle !== item.title) {
        updates.title = spanishTitle;
        updates.originalTitle = item.title;
    }
    if (spanishDescription) updates.description = spanishDescription;
    
    if (finalTrailerUrl) {
        console.log(`🎉 [AI] ¡Trailer válido encontrado y guardado!: ${finalTrailerUrl}`);
        updates.trailerUrl = finalTrailerUrl;
    } else {
        console.warn(`⛔ [AI] Imposible encontrar trailer válido tras ${MAX_ATTEMPTS} intentos. Se deja vacío.`);
        updates.trailerUrl = ''; // Ensure we don't save garbage
    }

    await updateMediaItem(item.id, updates);
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
    // Changed proxy to corsproxy.io (faster/more reliable currently) or directly failing over
    // If this fails, we just return empty array quickly.
    const targetUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=movie&entity=movie&country=ES&lang=es_es&limit=15`;
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;
    
    const res = await fetchWithTimeout(proxyUrl, 2500); // 2.5s hard timeout
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
    console.warn("iTunes Search timed out or failed, skipping...");
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
  // Run all in parallel, but handle individual failures gracefully so we don't block
  const [itunesMovies, cinemetaMovies, series] = await Promise.all([
    fetchMoviesFromItunes(query),
    fetchMoviesFromCinemaMeta(query),
    fetchSeriesFromTvMaze(query)
  ]);

  const movieMap = new Map<string, SearchResult>();
  
  // Prioritize CinemaMeta then overwrite with iTunes
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