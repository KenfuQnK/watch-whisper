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
  type: MediaType;
  posterUrl: string;
  backupPosterUrl?: string; // Second chance image
  description: string;
  year?: string;
  addedAt: number;
  collectionId: CollectionType;
  
  // New Fields
  platform?: Platform;
  releaseDate?: string; // YYYY-MM-DD
  rating?: number; // 1 (Bad), 2 (Good), 3 (Amazing/DoubleThumbs), 4 (Masterpiece/Star)
  trailerUrl?: string; // YouTube URL

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