import { request } from './http';
import { logger } from '../middleware/logger';

/**
 * Couche CATALOGUE TMDB : fournit une navigation quasi-infinie (tendances,
 * populaires, découverte par genre/pays/année, pagination) en métadonnées
 * françaises. C'est la source du « catalogue de tout » façon Netflix.
 *
 * Les items sont mappés au format ContentItem de l'app. Leur subjectId est
 * préfixé `tmdb:<type>:<id>` : la résolution de flux (voir bridge TMDB→MovieBox)
 * détecte ce préfixe pour retrouver le flux VF par matching de titre.
 */

const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';
const POSTER = `${IMG}/w500`;
const BACKDROP = `${IMG}/w780`;

export function isTmdbEnabled(): boolean {
  return TMDB_API_KEY.length > 0;
}

export type TmdbMediaType = 'movie' | 'tv';

// ─── Cache mémoire des genres (id → nom FR), un par type ──────────────────────
const genreCache: Record<TmdbMediaType, Map<number, string> | null> = { movie: null, tv: null };

async function tmdbGet(path: string, params: Record<string, string | number | undefined> = {}): Promise<any> {
  const qs = new URLSearchParams({
    api_key: TMDB_API_KEY,
    language: 'fr-FR',
    region: 'FR',
    include_adult: 'false',
  });
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') qs.set(k, String(v));
  }
  const resp = await request(`${TMDB_BASE}${path}?${qs.toString()}`);
  if (resp.status !== 200) throw new Error(`TMDB ${path} -> HTTP ${resp.status}`);
  return resp.json();
}

async function getGenreMap(type: TmdbMediaType): Promise<Map<number, string>> {
  if (genreCache[type]) return genreCache[type]!;
  try {
    const data = await tmdbGet(`/genre/${type}/list`);
    const map = new Map<number, string>();
    for (const g of data.genres || []) map.set(g.id, g.name);
    genreCache[type] = map;
    return map;
  } catch (e) {
    logger.warn(`TMDB genre list failed (${type}): ${(e as Error).message}`);
    return new Map();
  }
}

/** Liste des genres pour l'UI (chips de filtre). */
export async function tmdbGenres(type: TmdbMediaType): Promise<{ id: number; name: string }[]> {
  const map = await getGenreMap(type);
  return [...map.entries()].map(([id, name]) => ({ id, name }));
}

// ─── Mapping TMDB → ContentItem ───────────────────────────────────────────────
function mapTmdbItem(raw: any, type: TmdbMediaType, genreMap: Map<number, string>): any | null {
  if (!raw || !raw.id) return null;
  if (!raw.poster_path && !raw.backdrop_path) return null; // sans visuel = inutile en UI

  const appType = type === 'tv' ? 'series' : 'movie';
  const date = raw.release_date || raw.first_air_date || '';
  const genresFromIds = (raw.genre_ids || [])
    .map((id: number) => genreMap.get(id))
    .filter(Boolean);
  const genresFromObjs = (raw.genres || []).map((g: any) => g.name);
  const genres = (genresFromObjs.length ? genresFromObjs : genresFromIds) as string[];

  return {
    subjectId: `tmdb:${type}:${raw.id}`,
    detailPath: null,
    tmdbId: raw.id,
    tmdbType: type,
    title: raw.title || raw.name || 'Sans titre',
    posterUrl: raw.poster_path ? `${POSTER}${raw.poster_path}` : '',
    coverUrl: raw.backdrop_path ? `${BACKDROP}${raw.backdrop_path}` : undefined,
    type: appType,
    rating: raw.vote_average ? Number(raw.vote_average).toFixed(1) : undefined,
    year: date ? date.slice(0, 4) : undefined,
    genres: genres.length ? genres : undefined,
    plot: raw.overview || undefined,
    // La VF n'est connue qu'à la résolution du flux → pas de badge ici.
    isFrench: undefined,
    language: undefined,
  };
}

async function mapList(results: any[], type: TmdbMediaType): Promise<any[]> {
  const genreMap = await getGenreMap(type);
  return results.map((r) => mapTmdbItem(r, type, genreMap)).filter(Boolean);
}

// ─── Endpoints de catalogue ───────────────────────────────────────────────────

export async function tmdbTrending(type: TmdbMediaType, page = 1): Promise<{ items: any[]; page: number; hasMore: boolean }> {
  const data = await tmdbGet(`/trending/${type}/week`, { page });
  const items = await mapList(data.results || [], type);
  return { items, page, hasMore: page < (data.total_pages || 1) };
}

export interface DiscoverParams {
  type: TmdbMediaType;
  page?: number;
  genre?: number;        // id de genre TMDB
  country?: string;      // code ISO 3166-1 (ex: FR, US)
  year?: number;
  sort?: string;         // ex: popularity.desc, vote_average.desc, primary_release_date.desc
}

/** Découverte paginée : le cœur du catalogue infini (filtrable). */
export async function tmdbDiscover(p: DiscoverParams): Promise<{ items: any[]; page: number; hasMore: boolean }> {
  const page = p.page ?? 1;
  const params: Record<string, string | number | undefined> = {
    page,
    sort_by: p.sort || 'popularity.desc',
    with_genres: p.genre,
    'vote_count.gte': 30, // évite le bruit sans votes
  };
  if (p.country) params.with_origin_country = p.country;
  if (p.year) {
    if (p.type === 'movie') params.primary_release_year = p.year;
    else params.first_air_date_year = p.year;
  }
  const data = await tmdbGet(`/discover/${p.type}`, params);
  const items = await mapList(data.results || [], p.type);
  return { items, page, hasMore: page < (data.total_pages || 1) };
}

/** Détail complet TMDB (pour la fiche + le pont vers le flux). */
export async function tmdbDetail(type: TmdbMediaType, id: number): Promise<any | null> {
  try {
    const detail = await tmdbGet(`/${type}/${id}`, { append_to_response: 'credits,external_ids,videos' });
    const genreMap = await getGenreMap(type);
    const base = mapTmdbItem(detail, type, genreMap);
    if (!base) return null;
    const cast = (detail.credits?.cast || []).slice(0, 12).map((c: any) => c.name).filter(Boolean);
    return {
      ...base,
      // Titre original (souvent anglais) : MovieBox indexe beaucoup de titres ainsi
      originalTitle: detail.original_title || detail.original_name || undefined,
      duration: detail.runtime
        ? `${Math.floor(detail.runtime / 60)}h${String(detail.runtime % 60).padStart(2, '0')}`
        : (detail.episode_run_time?.[0] ? `${detail.episode_run_time[0]}m` : undefined),
      country: (detail.origin_country || [])[0] || detail.production_countries?.[0]?.iso_3166_1,
      cast: cast.length ? cast : undefined,
      imdbId: detail.external_ids?.imdb_id,
      seasonsCount: detail.number_of_seasons,
    };
  } catch (e) {
    logger.warn(`TMDB detail failed (${type}/${id}): ${(e as Error).message}`);
    return null;
  }
}

/**
 * Accueil « Netflix » : plusieurs rails construits à partir de TMDB.
 * Bannière = tendances de la semaine ; puis populaires + rails par genre.
 */
export async function tmdbHome(): Promise<{ sections: any[]; tabs: any[] }> {
  // Genres phares pour les rails (ids TMDB communs films)
  const RAIL_GENRES: { id: number; title: string }[] = [
    { id: 28, title: 'Action' },
    { id: 35, title: 'Comédie' },
    { id: 27, title: 'Horreur' },
    { id: 10749, title: 'Romance' },
    { id: 16, title: 'Animation' },
    { id: 878, title: 'Science-fiction' },
  ];

  const [trending, popMovies, popSeries] = await Promise.all([
    tmdbTrending('movie', 1),
    tmdbDiscover({ type: 'movie', sort: 'popularity.desc', page: 1 }),
    tmdbDiscover({ type: 'tv', sort: 'popularity.desc', page: 1 }),
  ]);

  const railResults = await Promise.all(
    RAIL_GENRES.map((g) => tmdbDiscover({ type: 'movie', genre: g.id, sort: 'popularity.desc', page: 1 })
      .then((r) => ({ g, items: r.items }))
      .catch(() => ({ g, items: [] as any[] })))
  );

  const sections: any[] = [];
  if (trending.items.length) sections.push({ id: 'tmdb-banner', title: 'Tendances', type: 'banner', items: trending.items.slice(0, 8) });
  if (popMovies.items.length) sections.push({ id: 'tmdb-pop-movies', title: 'Films populaires', type: 'row', items: popMovies.items });
  if (popSeries.items.length) sections.push({ id: 'tmdb-pop-series', title: 'Séries populaires', type: 'row', items: popSeries.items });
  for (const { g, items } of railResults) {
    if (items.length) sections.push({ id: `tmdb-genre-${g.id}`, title: g.title, type: 'row', items });
  }

  const tabs = [
    { id: 'trending', title: 'Tendances' },
    { id: 'movies', title: 'Films' },
    { id: 'series', title: 'Séries' },
  ];
  return { sections, tabs };
}
