import { supabase } from '../lib/supabase';
import { MediaItem } from '../types';

// --- MAPPING HELPERS ---
// Translates between App types (camelCase) and DB columns (snake_case)

const mapFromDb = (row: any): MediaItem => ({
  id: row.id,
  title: row.title,
  type: row.type,
  posterUrl: row.poster_url,
  backupPosterUrl: row.backup_poster_url,
  description: row.description,
  year: row.year,
  addedAt: parseInt(row.added_at), // BigInt comes as string sometimes from JSON
  collectionId: row.collection_id,
  platform: row.platform,
  releaseDate: row.release_date,
  rating: row.rating,
  trailerUrl: row.trailer_url,
  seasons: row.seasons,
  userStatus: row.user_status || {}
});

const mapToDb = (item: MediaItem) => ({
  id: item.id,
  title: item.title,
  type: item.type,
  poster_url: item.posterUrl,
  backup_poster_url: item.backupPosterUrl,
  description: item.description,
  year: item.year,
  added_at: item.addedAt,
  collection_id: item.collectionId,
  platform: item.platform,
  release_date: item.releaseDate,
  rating: item.rating,
  trailer_url: item.trailerUrl,
  seasons: item.seasons,
  user_status: item.userStatus
});

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
  if (changes.platform !== undefined) dbChanges.platform = changes.platform;
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