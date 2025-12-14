import { supabase } from '../lib/supabase';
import { MediaItem, MediaType } from '../types';

// --- AI RESULT CACHE ---
// Stores translation/trailer results keyed by (title, year, type)
const aiResultCache = new Map<string, Partial<Pick<MediaItem, 'trailerUrl' | 'description'>>>();

const buildAiCacheKey = (title: string, year?: string, type?: MediaType) =>
  `${title.toLowerCase().trim()}|${year || ''}|${type || ''}`;

export const getAiCache = (title: string, year?: string, type?: MediaType) => {
  const key = buildAiCacheKey(title, year, type);
  return aiResultCache.get(key);
};

export const setAiCache = (
  title: string,
  year: string | undefined,
  type: MediaType | undefined,
  data: Partial<Pick<MediaItem, 'trailerUrl' | 'description'>>
) => {
  const key = buildAiCacheKey(title, year, type);
  const prev = aiResultCache.get(key) || {};
  aiResultCache.set(key, { ...prev, ...data });
};

// --- MAPPING HELPERS ---
// Translates between App types (camelCase) and DB columns (snake_case)

const mapFromDb = (row: any): MediaItem => {
  // Handle Platform: DB might be string (CSV) or null. Convert to Array.
  let platforms: string[] = [];
  if (row.platform) {
      // If it's already an array (postgres array), use it. If string, split it.
      platforms = Array.isArray(row.platform) 
        ? row.platform 
        : row.platform.split(',').filter((p: string) => p.trim() !== '');
  }

  return {
    id: row.id,
    title: row.title,
    type: row.type,
    posterUrl: row.poster_url,
    backupPosterUrl: row.backup_poster_url,
    description: row.description,
    year: row.year,
    addedAt: parseInt(row.added_at), // BigInt comes as string sometimes from JSON
    collectionId: row.collection_id,
    platform: platforms,
    releaseDate: row.release_date,
    rating: row.rating,
    trailerUrl: row.trailer_url,
    trailerStatus: row.trailer_url ? 'found' : 'idle',
    seasons: row.seasons,
    userStatus: row.user_status || {}
  };
};

const mapToDb = (item: MediaItem) => {
  // Handle Platform: Convert Array to CSV String for safer DB storage if column is text
  const platformStr = item.platform ? item.platform.join(',') : null;

  return {
    id: item.id,
    title: item.title,
    type: item.type,
    poster_url: item.posterUrl,
    backup_poster_url: item.backupPosterUrl,
    description: item.description,
    year: item.year,
    added_at: item.addedAt,
    collection_id: item.collectionId,
    platform: platformStr, 
    release_date: item.releaseDate,
    rating: item.rating,
    trailer_url: item.trailerUrl,
    seasons: item.seasons,
    user_status: item.userStatus
  };
};

// --- API METHODS ---

export const fetchMediaItems = async (): Promise<MediaItem[]> => {
  const { data, error } = await supabase
    .from('media_items')
    .select('*')
    .order('added_at', { ascending: false });

  if (error) {
    console.error('Error fetching items:', error);
    return [];
  }

  return data.map(mapFromDb);
};

export const addMediaItem = async (item: MediaItem) => {
  const dbItem = mapToDb(item);
  const { error } = await supabase.from('media_items').insert(dbItem);
  if (error) console.error('Error adding item:', error);
};

export const updateMediaItem = async (id: string, changes: Partial<MediaItem>) => {
  // We need to map the partial changes to snake_case
  const dbChanges: any = {};
  if (changes.title !== undefined) dbChanges.title = changes.title;
  if (changes.posterUrl !== undefined) dbChanges.poster_url = changes.posterUrl;
  if (changes.backupPosterUrl !== undefined) dbChanges.backup_poster_url = changes.backupPosterUrl;
  if (changes.description !== undefined) dbChanges.description = changes.description;
  
  if (changes.platform !== undefined) {
      dbChanges.platform = Array.isArray(changes.platform) ? changes.platform.join(',') : changes.platform;
  }

  if (changes.releaseDate !== undefined) dbChanges.release_date = changes.releaseDate;
  if (changes.rating !== undefined) dbChanges.rating = changes.rating;
  if (changes.trailerUrl !== undefined) dbChanges.trailer_url = changes.trailerUrl;
  if (changes.seasons !== undefined) dbChanges.seasons = changes.seasons;
  if (changes.userStatus !== undefined) dbChanges.user_status = changes.userStatus;
  if (changes.collectionId !== undefined) dbChanges.collection_id = changes.collectionId;

  const { error } = await supabase
    .from('media_items')
    .update(dbChanges)
    .eq('id', id);

  if (error) console.error('Error updating item:', error);
};

export const deleteMediaItem = async (id: string) => {
  const { error } = await supabase.from('media_items').delete().eq('id', id);
  if (error) console.error('Error deleting item:', error);
};