import { request } from './http';
import { logger } from '../middleware/logger';
import { pickTrailerKey } from './tmdb';

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

// ─── Langue audio d'origine (ISO 639-1 → libellé FR) ──────────────────────────
// TMDB fournit original_language sur chaque item sans appel supplémentaire.
// Contrairement au badge VF/VOSTFR (MovieBox natif, connu seulement à la
// résolution du flux), ceci reflète la langue d'origine du contenu, toujours
// disponible dès le catalogue.
const LANGUAGE_LABELS: Record<string, string> = {
  fr: 'Français', en: 'Anglais', hi: 'Hindi', ja: 'Japonais', ko: 'Coréen',
  es: 'Espagnol', de: 'Allemand', it: 'Italien', zh: 'Chinois', cn: 'Chinois',
  pt: 'Portugais', ru: 'Russe', ar: 'Arabe', th: 'Thaï', tr: 'Turc',
  nl: 'Néerlandais', sv: 'Suédois', pl: 'Polonais', da: 'Danois', fi: 'Finnois',
  no: 'Norvégien', id: 'Indonésien', ta: 'Tamoul', te: 'Télougou', ur: 'Ourdou',
  fa: 'Persan', he: 'Hébreu', pa: 'Pendjabi', vi: 'Vietnamien', uk: 'Ukrainien',
};

function languageLabel(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  return LANGUAGE_LABELS[iso.toLowerCase()] || iso.toUpperCase();
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
    // La disponibilité VF (MovieBox) n'est connue qu'à la résolution du flux ;
    // ce badge montre la langue d'ORIGINE du contenu (toujours dispo via TMDB),
    // pas une garantie de doublage français.
    isFrench: raw.original_language === 'fr' ? true : undefined,
    language: languageLabel(raw.original_language),
  };
}

async function mapList(results: any[], type: TmdbMediaType): Promise<any[]> {
  const genreMap = await getGenreMap(type);
  return results.map((r) => mapTmdbItem(r, type, genreMap)).filter(Boolean);
}

// ─── Endpoints de catalogue ───────────────────────────────────────────────────

// TMDB n'accepte que les pages 1..500 → on borne pour éviter un 500 upstream.
function clampPage(page?: number): number {
  const p = Number(page);
  if (!Number.isFinite(p) || p < 1) return 1;
  return Math.min(Math.floor(p), 500);
}

export async function tmdbTrending(type: TmdbMediaType, page = 1): Promise<{ items: any[]; page: number; hasMore: boolean }> {
  const pg = clampPage(page);
  const data = await tmdbGet(`/trending/${type}/week`, { page: pg });
  const items = await mapList(data.results || [], type);
  return { items, page: pg, hasMore: pg < Math.min(data.total_pages || 1, 500) };
}

export interface DiscoverParams {
  type: TmdbMediaType;
  page?: number;
  genre?: number;        // id de genre TMDB
  country?: string;      // code ISO 3166-1 (ex: FR, US)
  year?: number;
  sort?: string;         // ex: popularity.desc, vote_average.desc, primary_release_date.desc
  // Langue ORIGINALE (ISO 639-1, ex: fr/en/hi) — PAS une garantie de doublage VF,
  // juste un filtre optionnel pour parcourir le catalogue par langue de tournage.
  // Ne jamais appliquer par défaut : un film hollywoodien doublé en VF a
  // original_language=en, un filtre auto sur "fr" masquerait tout le contenu
  // VF doublé, contraire au but de l'app.
  language?: string;
}

/** Découverte paginée : le cœur du catalogue infini (filtrable). */
export async function tmdbDiscover(p: DiscoverParams): Promise<{ items: any[]; page: number; hasMore: boolean }> {
  const page = clampPage(p.page);
  const genre = Number.isFinite(Number(p.genre)) ? p.genre : undefined;
  const year = Number.isFinite(Number(p.year)) ? p.year : undefined;
  const params: Record<string, string | number | undefined> = {
    page,
    sort_by: p.sort || 'popularity.desc',
    with_genres: genre,
    'vote_count.gte': 30, // évite le bruit sans votes
  };
  if (p.country) params.with_origin_country = p.country;
  if (p.language) params.with_original_language = p.language;
  if (year) {
    if (p.type === 'movie') params.primary_release_year = year;
    else params.first_air_date_year = year;
  }
  const data = await tmdbGet(`/discover/${p.type}`, params);
  const items = await mapList(data.results || [], p.type);
  return { items, page, hasMore: page < Math.min(data.total_pages || 1, 500) };
}

/**
 * Recherche plein texte TMDB (multi : films + séries). Utilisée comme
 * COMPLÉMENT de la recherche MovieBox : fournit le catalogue quasi-infini
 * (TMDB) pour les requêtes où MovieBox n'a rien ou presque rien.
 */
export async function tmdbSearch(query: string, page = 1): Promise<{ items: any[]; page: number; hasMore: boolean }> {
  const pg = clampPage(page);
  const q = query.trim();
  if (q.length < 2) return { items: [], page: pg, hasMore: false };
  try {
    const data = await tmdbGet('/search/multi', { query: q, page: pg });
    const results = (data.results || []).filter(
      (r: any) => r.media_type === 'movie' || r.media_type === 'tv'
    );
    const movies = await mapList(results.filter((r: any) => r.media_type === 'movie'), 'movie');
    const series = await mapList(results.filter((r: any) => r.media_type === 'tv'), 'tv');
    return {
      items: [...movies, ...series],
      page: pg,
      hasMore: pg < Math.min(data.total_pages || 1, 500),
    };
  } catch (e) {
    logger.warn(`TMDB search failed ("${query}"): ${(e as Error).message}`);
    return { items: [], page: pg, hasMore: false };
  }
}

/** Détail complet TMDB (pour la fiche + le pont vers le flux). */
export async function tmdbDetail(type: TmdbMediaType, id: number): Promise<any | null> {
  try {
    // include_video_language : sans lui, `language=fr-FR` ne rend que les vidéos
    // FRANÇAISES — vide sur la majorité du catalogue, donc pas de bande-annonce.
    const detail = await tmdbGet(`/${type}/${id}`, {
      append_to_response: 'credits,external_ids,videos',
      include_video_language: 'fr,en,null',
    });
    const genreMap = await getGenreMap(type);
    const base = mapTmdbItem(detail, type, genreMap);
    if (!base) return null;
    const cast = (detail.credits?.cast || []).slice(0, 12).map((c: any) => c.name).filter(Boolean);
    // Déjà dans la réponse (credits demandé via append_to_response) : juste jamais extrait avant.
    const director = (detail.credits?.crew || []).find((c: any) => c.job === 'Director')?.name;
    const studio = detail.production_companies?.[0]?.name;
    // videos.results est déjà dans la réponse (append_to_response) : on choisit la
    // meilleure bande-annonce YouTube (VF officielle en priorité, anglaise sinon).
    const trailerKey = pickTrailerKey(detail.videos?.results || []);
    return {
      ...base,
      // Titre original (souvent anglais) : MovieBox indexe beaucoup de titres ainsi
      originalTitle: detail.original_title || detail.original_name || undefined,
      duration: detail.runtime
        ? `${Math.floor(detail.runtime / 60)}h${String(detail.runtime % 60).padStart(2, '0')}`
        : (detail.episode_run_time?.[0] ? `${detail.episode_run_time[0]}m` : undefined),
      country: (detail.origin_country || [])[0] || detail.production_countries?.[0]?.iso_3166_1,
      cast: cast.length ? cast : undefined,
      director,
      studio,
      trailerKey,
      imdbId: detail.external_ids?.imdb_id,
      seasonsCount: detail.number_of_seasons,
    };
  } catch (e) {
    logger.warn(`TMDB detail failed (${type}/${id}): ${(e as Error).message}`);
    return null;
  }
}

// ─── Épisodes d'une saison ────────────────────────────────────────────────────

export interface TmdbEpisodeInfo {
  episode: number;
  title?: string;
  plot?: string;
  stillUrl?: string;
  airDate?: string;
  runtime?: number;
}

/**
 * Titres/synopsis/vignettes des épisodes d'une saison.
 *
 * L'upstream MovieBox n'expose QUE le numéro d'épisode (`maxEp` par saison) —
 * c'est pour ça que la roadmap notait les titres d'épisodes comme impossibles.
 * TMDB les fournit, et le pont TMDB↔MovieBox existe déjà : cet appel est le
 * chaînon manquant.
 */
export async function tmdbSeasonEpisodes(id: number, season: number): Promise<TmdbEpisodeInfo[]> {
  try {
    const data = await tmdbGet(`/tv/${id}/season/${season}`);
    return (data.episodes || [])
      .map((e: any) => ({
        episode: e.episode_number,
        // TMDB retourne « Épisode 3 » quand le vrai titre est inconnu : inutile
        // à afficher, l'app le compose déjà elle-même.
        title: e.name && !/^épisode\s*\d+$/i.test(e.name) && !/^episode\s*\d+$/i.test(e.name)
          ? e.name : undefined,
        plot: e.overview || undefined,
        stillUrl: e.still_path ? `${IMG}/w300${e.still_path}` : undefined,
        airDate: e.air_date || undefined,
        runtime: e.runtime || undefined,
      }))
      .filter((e: TmdbEpisodeInfo) => Number.isFinite(e.episode));
  } catch (e) {
    logger.warn(`TMDB season failed (tv/${id}/season/${season}): ${(e as Error).message}`);
    return [];
  }
}

/**
 * Retrouve l'id TMDB d'une série à partir de son titre MovieBox (pont inverse,
 * pour les fiches natives qui n'ont pas d'id `tmdb:`). Best-effort : null si
 * aucun résultat.
 */
export async function tmdbFindTvId(title: string, expectedEpisodes?: number): Promise<number | null> {
  const q = title
    .replace(/\[.*?\]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/\bS\d{1,2}(-S?\d{1,2})?\b/gi, '')
    .replace(/\bSaisons?\s*\d+\s*(-\s*\d+)?\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (q.length < 2) return null;
  try {
    // ⚠️ On N'UTILISE PAS l'année MovieBox comme filtre : c'est celle de la
    // dernière mise en ligne, pas de la première diffusion (One Piece = 2024
    // côté MovieBox, 1999 côté TMDB). Filtrer dessus élimine les séries longues,
    // ou pire, fait tomber sur un remake récent (le live-action One Piece 2023
    // au lieu de l'animé) et on afficherait des titres d'épisodes faux.
    const data = await tmdbGet('/search/tv', { query: q });
    const results = (data.results || []) as any[];
    if (!results.length) return null;
    const norm = (s: string) =>
      s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
    const target = norm(q);
    // Titre exactement identique en priorité (TMDB trie déjà par pertinence /
    // popularité, donc le premier de ces candidats est le plus connu).
    const exact = results.filter(
      (r) => norm(r.name || '') === target || norm(r.original_name || '') === target
    );
    const shortlist = (exact.length ? exact : results).slice(0, 3);

    // Homonymes exacts (l'animé « One Piece » et son live-action portent le même
    // nom) : on départage par le NOMBRE D'ÉPISODES annoncé par MovieBox. Sans ce
    // garde-fou on afficherait les titres du remake sur la série d'origine.
    if (shortlist.length > 1 && expectedEpisodes && expectedEpisodes > 0) {
      const counts = await Promise.all(
        shortlist.map(async (r) => {
          try {
            const d = await tmdbGet(`/tv/${r.id}`);
            return { id: r.id, episodes: d.number_of_episodes || 0 };
          } catch {
            return { id: r.id, episodes: 0 };
          }
        })
      );
      const best = counts
        .filter((c) => c.episodes > 0)
        .sort((a, b) =>
          Math.abs(a.episodes - expectedEpisodes) - Math.abs(b.episodes - expectedEpisodes)
        )[0];
      if (best) return best.id;
    }
    return shortlist[0]?.id ?? null;
  } catch (e) {
    logger.warn(`TMDB find tv failed ("${title}"): ${(e as Error).message}`);
    return null;
  }
}

/**
 * Titres similaires (TMDB natif, /similar) — distinct des recommandations
 * MovieBox (ScraperEngine.recommendations, qui ne marche que pour un
 * subjectId déjà bridgé). Disponible pour n'importe quel id TMDB, bridgé ou non.
 */
export async function tmdbSimilar(type: TmdbMediaType, id: number, page = 1): Promise<{ items: any[]; page: number; hasMore: boolean }> {
  const pg = clampPage(page);
  try {
    const data = await tmdbGet(`/${type}/${id}/similar`, { page: pg });
    const items = await mapList(data.results || [], type);
    return { items, page: pg, hasMore: pg < Math.min(data.total_pages || 1, 500) };
  } catch (e) {
    logger.warn(`TMDB similar failed (${type}/${id}): ${(e as Error).message}`);
    return { items: [], page: pg, hasMore: false };
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

  const emptyPage = { items: [] as any[], page: 1, hasMore: false };
  const [trending, popMovies, popSeries] = await Promise.all([
    tmdbTrending('movie', 1).catch(() => emptyPage),
    tmdbDiscover({ type: 'movie', sort: 'popularity.desc', page: 1 }).catch(() => emptyPage),
    tmdbDiscover({ type: 'tv', sort: 'popularity.desc', page: 1 }).catch(() => emptyPage),
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
