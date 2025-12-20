import Constants from 'expo-constants';

const extra = Constants.expoConfig?.extra ?? (Constants as any).manifest?.extra ?? {};

export const SUPABASE_URL = extra.SUPABASE_URL ?? 'https://ulrbgmuqqenpauejbkcj.supabase.co';
export const SUPABASE_ANON_KEY = extra.SUPABASE_ANON_KEY ?? 'change-me';
