
export enum MediaType {
  MOVIE = 'movie',
  SERIES = 'series',
}

export enum CollectionType {
  WATCHLIST = 'watchlist',
  WATCHED = 'watched',
}

export type Platform = 'Netflix' | 'HBO' | 'Disney+' | 'AppleTV' | 'Prime' | 'Stremio' | 'Torrent' | 'Online' | 'Cine' | '';

export interface User {
  id: string;
  name: string;
  avatar: string;
  color: string;
}

export interface SeasonData {
  seasonNumber: number;
  episodeCount: number;
}

export interface WatchInfo {
  // For Movies
  watched: boolean;
  date?: number; 
  
  // For Series (List of "S1_E1" strings watched by this user)
  watchedEpisodes: string[]; 
}

export interface MediaItem {
  id: string;
  title: string;
  originalTitle?: string; // To keep the English/Original name if we translate
  type: MediaType;
  posterUrl: string;
  backupPosterUrl?: string; // Second chance image
  description: string;
  year?: string;
  addedAt: number;
  collectionId: CollectionType;
  
  // New Fields
  platform?: string[]; // Changed from Platform (single string) to string array
  releaseDate?: string; // YYYY-MM-DD
  rating?: number; // 9 = Discarded. 1-4 = Rated. undefined/0 = Unrated.
  trailerUrl?: string; // YouTube URL
  
  // AI Metadata
  isEnriched?: boolean; // True if AI has already processed this item

  // Metadata for series structure
  seasons?: SeasonData[]; 

  // Map userId to their specific watch status
  userStatus: Record<string, WatchInfo>; 
}

export interface SearchResult {
  id: string; // Internal temp ID for list key
  externalId: string | number; // ID from the API (TVMaze or iTunes)
  source: 'tvmaze' | 'itunes' | 'cinemeta' | 'manual';
  title: string;
  type: MediaType;
  year: string;
  description: string;
  posterUrl: string;
  backupPosterUrl?: string;
  seasons?: SeasonData[]; 
  trailerUrl?: string;
}