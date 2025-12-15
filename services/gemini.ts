import { SearchResult, MediaType, SeasonData, MediaItem } from "../types";
import { GoogleGenAI } from "@google/genai";
import { updateMediaItem } from "./db";

// --- HELPERS ---
const cleanTitle = (title: string, year: string) => `${title.toLowerCase().trim()}-${year}`;

// --- TMDB API IMPLEMENTATION ---
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

// Helper to determine if we are using a Bearer Token (Long) or an API Key (Short)
const getTMDBConfig = () => {
    const token = process.env.TMDB_READ_TOKEN || (import.meta as any).env?.VITE_TMDB_READ_TOKEN || '';
    
    if (!token) return { mode: 'none', value: '' };
    
    if (token.length > 40) {
        return { mode: 'bearer', value: token };
    }
    return { mode: 'query', value: token };
};

const getOptions = () => {
    const { mode, value } = getTMDBConfig();
    if (mode === 'bearer') {
        return {
            headers: {
                accept: 'application/json',
                Authorization: `Bearer ${value}`
            }
        };
    }
    return {};
};

const appendAuth = (url: string) => {
    const { mode, value } = getTMDBConfig();
    const separator = url.includes('?') ? '&' : '?';
    if (mode === 'query') {
        return `${url}${separator}api_key=${value}`;
    }
    return url;
};

// --- CORE FUNCTIONS ---

// 1. Unified TMDB Search (Movies & TV)
const searchTMDB = async (query: string): Promise<SearchResult[]> => {
    const { mode } = getTMDBConfig();
    if (mode === 'none') {
        console.warn("⚠️ TMDB Token missing.");
        return [];
    }

    try {
        let url = `${TMDB_BASE_URL}/search/multi?query=${encodeURIComponent(query)}&include_adult=false&language=es-ES&page=1`;
        url = appendAuth(url);

        const res = await fetch(url, getOptions());
        if (!res.ok) throw new Error(`TMDB Error: ${res.status}`);
        const data = await res.json();

        if (!data.results) return [];

        return data.results
            .filter((item: any) => item.media_type === 'movie' || item.media_type === 'tv')
            .map((item: any) => {
                const isMovie = item.media_type === 'movie';
                const date = isMovie ? item.release_date : item.first_air_date;
                const year = date ? date.substring(0, 4) : '';
                
                return {
                    id: `tmdb-${item.id}`,
                    externalId: item.id,
                    source: 'tmdb', // Unified source
                    title: isMovie ? item.title : item.name,
                    type: isMovie ? MediaType.MOVIE : MediaType.SERIES,
                    year: year,
                    description: item.overview || '',
                    posterUrl: item.poster_path ? `${TMDB_IMAGE_BASE}${item.poster_path}` : '',
                    backupPosterUrl: item.backdrop_path ? `${TMDB_IMAGE_BASE}${item.backdrop_path}` : '',
                };
            });

    } catch (e) {
        console.error("Error searching TMDB", e);
        return [];
    }
};

// 2. Fetch Trailer (Existing logic preserved, simplified with helpers)
const fetchTrailerFromTMDB = async (title: string, year: string, type: MediaType, tmdbId?: string | number): Promise<string | null> => {
    try {
        const tmdbType = type === MediaType.MOVIE ? 'movie' : 'tv';
        let finalId = tmdbId;

        // If we don't have the ID (legacy items), we search again specifically to find the ID
        if (!finalId) {
            const yearParam = type === MediaType.MOVIE ? `&primary_release_year=${year}` : `&first_air_date_year=${year}`;
            let searchUrl = `${TMDB_BASE_URL}/search/${tmdbType}?query=${encodeURIComponent(title)}&include_adult=false&language=es-ES&page=1${yearParam}`;
            searchUrl = appendAuth(searchUrl);
            
            const searchRes = await fetch(searchUrl, getOptions());
            const searchData = await searchRes.json();
            
            if (searchData.results?.[0]) {
                finalId = searchData.results[0].id;
            } else {
                return null;
            }
        }

        // Get Videos
        let videosEsUrl = `${TMDB_BASE_URL}/${tmdbType}/${finalId}/videos?language=es-ES`;
        videosEsUrl = appendAuth(videosEsUrl);
        
        const videosEsRes = await fetch(videosEsUrl, getOptions());
        const videosEsData = await videosEsRes.json();
        
        let results = videosEsData.results || [];

        // Fallback to English
        if (!results.some((v: any) => v.type === "Trailer")) {
            let videosEnUrl = `${TMDB_BASE_URL}/${tmdbType}/${finalId}/videos?language=en-US`;
            videosEnUrl = appendAuth(videosEnUrl);
            const videosEnRes = await fetch(videosEnUrl, getOptions());
            const videosEnData = await videosEnRes.json();
            results = [...results, ...(videosEnData.results || [])];
        }

        const trailer = results.find((v: any) => v.site === "YouTube" && v.type === "Trailer");
        if (trailer) return `https://www.youtube.com/watch?v=${trailer.key}`;
        
        const teaser = results.find((v: any) => v.site === "YouTube" && v.type === "Teaser");
        if (teaser) return `https://www.youtube.com/watch?v=${teaser.key}`;

        return null;
    } catch (e) {
        console.error("Error fetching trailer", e);
        return null;
    }
};

// --- METADATA ENRICHMENT ---
const enrichMetadata = async (item: MediaItem, ai: GoogleGenAI): Promise<Partial<MediaItem>> => {
    // Only translate if description is missing or very short, otherwise TMDB data is usually good enough.
    // But user requested Gemini enrichment logic to stay.
    
    const prompt = `
    TASK: Translate/Verify metadata for ${item.type}: "${item.title}" (${item.year}) to Spanish (Spain).
    Current Description: "${item.description}"

    RULES:
    1. "spanishTitle": Official title in Spain.
    2. "spanishDescription": Concise synopsis in Spanish.
    3. If current title/description are already good Spanish, keep them.

    JSON: {"spanishTitle": "...", "spanishDescription": "..."}
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
            
            // Only update if significantly different and not generic
            if (json.spanishTitle && json.spanishTitle !== item.title && !json.spanishTitle.includes('Trailer')) {
                updates.title = json.spanishTitle;
                updates.originalTitle = item.title;
            }
            if (json.spanishDescription && json.spanishDescription.length > item.description.length) {
                updates.description = json.spanishDescription;
            }
            return updates;
        }
    } catch (e) {
        // Ignore AI errors
    }
    return {};
};

// --- MAIN SEARCH EXPORT ---
export const searchMedia = async (query: string): Promise<SearchResult[]> => {
  // We prioritize TMDB. We can add others later if needed.
  return await searchTMDB(query);
};

// --- API SERIES DETAILS (TMDB) ---
export const getSeriesDetails = async (item: SearchResult): Promise<SearchResult> => {
  if (item.type !== MediaType.SERIES) return item;

  // If it's a TMDB item, we fetch details from TMDB
  if (item.source === 'tmdb' || item.id.startsWith('tmdb-')) {
      try {
          const tmdbId = item.externalId || item.id.replace('tmdb-', '');
          let url = `${TMDB_BASE_URL}/tv/${tmdbId}?language=es-ES`;
          url = appendAuth(url);

          const res = await fetch(url, getOptions());
          if (!res.ok) throw new Error("Failed to fetch TV details");
          const data = await res.json();

          // Map TMDB Seasons to our format
          const seasons: SeasonData[] = (data.seasons || [])
            .filter((s: any) => s.season_number > 0) // Skip "Specials" (Season 0) usually
            .map((s: any) => ({
                seasonNumber: s.season_number,
                episodeCount: s.episode_count
            }));

          return { ...item, seasons };
      } catch (e) {
          console.error("Error fetching TMDB series details", e);
          return item;
      }
  }

  return item;
};

// --- ENRICHMENT PIPELINE ---
export const enrichMediaContent = async (item: MediaItem): Promise<void> => {
    if (item.isEnriched) return; 

    // Extract ID if possible for faster lookups
    let tmdbId = undefined;
    if (item.id.startsWith('tmdb-')) {
        tmdbId = item.id.replace('tmdb-', '');
    }

    const trailerPromise = (async () => {
        const url = await fetchTrailerFromTMDB(item.title, item.year || '', item.type, tmdbId);
        if (url) await updateMediaItem(item.id, { trailerUrl: url });
    })();

    const metadataPromise = (async () => {
        if (!process.env.API_KEY) return;
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const changes = await enrichMetadata(item, ai);
        if (Object.keys(changes).length > 0) await updateMediaItem(item.id, changes);
    })();

    try {
        await Promise.allSettled([trailerPromise, metadataPromise]);
        await updateMediaItem(item.id, { isEnriched: true });
    } catch (e) {
        await updateMediaItem(item.id, { isEnriched: true });
    }
};