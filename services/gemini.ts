import { SearchResult, MediaType, SeasonData, MediaItem } from '../types';
import { updateMediaItem } from './db';
import { TMDB_READ_TOKEN } from '../lib/env';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

const getTMDBConfig = () => {
  const token = TMDB_READ_TOKEN || '';
  if (!token) return { mode: 'none', value: '' };
  return token.length > 40 ? { mode: 'bearer', value: token } : { mode: 'query', value: token };
};

const getOptions = () => {
  const { mode, value } = getTMDBConfig();
  return mode === 'bearer' ? { headers: { accept: 'application/json', Authorization: `Bearer ${value}` } } : {};
};

const appendAuth = (url: string) => {
  const { mode, value } = getTMDBConfig();
  const separator = url.includes('?') ? '&' : '?';
  return mode === 'query' ? `${url}${separator}api_key=${value}` : url;
};

const mapProviderName = (name: string): string => {
  const n = name.toLowerCase();
  if (n.includes('netflix')) return 'Netflix';
  if (n.includes('hbo')) return 'HBO';
  if (n.includes('disney')) return 'Disney+';
  if (n.includes('apple tv')) return 'AppleTV';
  if (n.includes('amazon') || n.includes('prime')) return 'Prime';
  return name;
};

const fetchWatchProviders = async (type: MediaType, id: string | number): Promise<string[]> => {
  try {
    const tmdbType = type === MediaType.MOVIE ? 'movie' : 'tv';
    let url = `${TMDB_BASE_URL}/${tmdbType}/${id}/watch/providers`;
    url = appendAuth(url);
    const res = await fetch(url, getOptions());
    const data = await res.json();

    const providers = data.results?.ES?.flatrate || data.results?.US?.flatrate || [];
    return Array.from(new Set(providers.map((p: any) => mapProviderName(p.provider_name))));
  } catch (e) {
    return [];
  }
};

export const searchMedia = async (query: string): Promise<SearchResult[]> => {
  const { mode } = getTMDBConfig();
  if (mode === 'none') return [];

  try {
    let url = `${TMDB_BASE_URL}/search/multi?query=${encodeURIComponent(query)}&include_adult=false&language=es-ES&page=1`;
    url = appendAuth(url);
    const res = await fetch(url, getOptions());
    const data = await res.json();

    const results = await Promise.all((data.results || [])
      .filter((item: any) => item.media_type === 'movie' || item.media_type === 'tv')
      .map(async (item: any) => {
        const isMovie = item.media_type === 'movie';
        const date = isMovie ? item.release_date : item.first_air_date;
        return {
          id: `tmdb-${item.id}`,
          externalId: item.id,
          source: 'tmdb' as const,
          title: isMovie ? item.title : item.name,
          type: isMovie ? MediaType.MOVIE : MediaType.SERIES,
          year: date ? date.substring(0, 4) : '',
          releaseDate: date || '',
          description: item.overview || '',
          posterUrl: item.poster_path ? `${TMDB_IMAGE_BASE}${item.poster_path}` : '',
          backupPosterUrl: item.backdrop_path ? `${TMDB_IMAGE_BASE}${item.backdrop_path}` : '',
        };
      }));
    return results;
  } catch (e) {
    return [];
  }
};

export const getSeriesDetails = async (item: SearchResult): Promise<SearchResult> => {
  const tmdbId = item.externalId || item.id.replace('tmdb-', '');
  const isMovie = item.type === MediaType.MOVIE;
  const tmdbPath = isMovie ? 'movie' : 'tv';

  try {
    let url = `${TMDB_BASE_URL}/${tmdbPath}/${tmdbId}?language=es-ES`;
    url = appendAuth(url);
    const res = await fetch(url, getOptions());
    const data = await res.json();

    const seasons: SeasonData[] = isMovie ? [] : (data.seasons || [])
      .filter((s: any) => s.season_number > 0)
      .map((s: any) => ({ seasonNumber: s.season_number, episodeCount: s.episode_count }));

    const platforms = await fetchWatchProviders(item.type, tmdbId);

    return {
      ...item,
      seasons,
      platforms,
      releaseDate: isMovie ? data.release_date : data.first_air_date
    };
  } catch (e) {
    return item;
  }
};

export const enrichMediaContent = async (item: MediaItem): Promise<void> => {
  if (item.isEnriched) return;
  const tmdbId = item.id.startsWith('tmdb-') ? item.id.replace('tmdb-', '') : undefined;

  const trailerPromise = (async () => {
    try {
      const tmdbType = item.type === MediaType.MOVIE ? 'movie' : 'tv';
      let finalId = tmdbId;
      if (!finalId) {
        let searchUrl = appendAuth(`${TMDB_BASE_URL}/search/${tmdbType}?query=${encodeURIComponent(item.title)}`);
        const sRes = await fetch(searchUrl, getOptions());
        const sData = await sRes.json();
        finalId = sData.results?.[0]?.id;
      }
      if (!finalId) return;

      let vUrl = appendAuth(`${TMDB_BASE_URL}/${tmdbType}/${finalId}/videos?language=es-ES`);
      const vRes = await fetch(vUrl, getOptions());
      const vData = await vRes.json();
      const trailer = vData.results?.find((v: any) => v.type === 'Trailer' && v.site === 'YouTube');
      if (trailer) await updateMediaItem(item.id, { trailerUrl: `https://www.youtube.com/watch?v=${trailer.key}` });
    } catch (e) { }
  })();

  await Promise.allSettled([trailerPromise]);
  await updateMediaItem(item.id, { isEnriched: true });
};
