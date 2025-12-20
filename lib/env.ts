import Constants from 'expo-constants';

const extra = Constants.expoConfig?.extra ?? (Constants as any).manifest?.extra ?? {};

export const API_KEY = extra.API_KEY ?? process.env.API_KEY ?? '';
export const TMDB_READ_TOKEN = extra.TMDB_READ_TOKEN ?? process.env.TMDB_READ_TOKEN ?? '';
