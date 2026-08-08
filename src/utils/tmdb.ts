import { request } from './http';
import { logger } from '../middleware/logger';

const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p';

export interface TmdbResult {
  title: string;
  overview: string;
  posterPath?: string;
  backdropPath?: string;
  releaseDate?: string;
  voteAverage?: number;
  genres?: string[];
  cast?: string[];
  runtime?: number;
  imdbId?: string;
  // Clé vidéo YouTube de la bande-annonce (best-effort, sinon undefined).
  trailerKey?: string;
}

/**
 * Choisit la meilleure bande-annonce YouTube d'une réponse TMDB `videos`.
 *
 * ⚠️ TMDB filtre `videos.results` sur le `language` de la requête. Toutes nos
 * requêtes partent en `fr-FR` : pour un blockbuster une bande-annonce VF existe
 * et tout allait bien, mais pour tout le reste du catalogue la liste revenait
 * VIDE — donc `trailerKey` absent, donc la fiche affichait un poster figé au
 * lieu du lecteur. Les appelants demandent désormais
 * `include_video_language=fr,en,null` ; on préfère ici le français quand il
 * existe, l'anglais sinon.
 */
export function pickTrailerKey(videos: any[]): string | undefined {
  const yt = (videos || []).filter((v: any) => v?.site === 'YouTube' && v?.key);
  const trailers = yt.filter((v: any) => v.type === 'Trailer');
  const fr = (list: any[]) => list.filter((v: any) => v.iso_639_1 === 'fr');
  const officiel = (list: any[]) => list.filter((v: any) => v.official);

  const choix =
    officiel(fr(trailers))[0] ||
    fr(trailers)[0] ||
    officiel(trailers)[0] ||
    trailers[0] ||
    fr(yt)[0] ||
    yt[0];
  return choix?.key;
}

function searchQuery(title: string): string {
  return title
    .replace(/\[.*?\]/g, '')
    .replace(/\(.*?\)/g, '')
    // ⚠️ `[VF]` était une CLASSE de caractères : elle supprimait chaque « V » et
    // chaque « F » du titre. « Venom » partait chez TMDB en « enom », « Frozen »
    // en « rozen » → aucun match, donc ni synopsis, ni casting, ni bande-annonce
    // sur ces fiches. Il fallait un mot entier.
    .replace(/\bVF\b|\bVOSTFR\b|Version\s*[Ff]ran[cç]aise/gi, '')
    // Plages de saisons que MovieBox ajoute au titre ("S1-S3", "S01-S03",
    // "Saison 1", "Saison 1-3") : sans elles, le matching TMDB échoue
    // ("Spider-Man S1-S3" → 0 résultat TMDB, vérifié).
    .replace(/\bS\d{1,2}(-S?\d{1,2})?\b/gi, '')
    .replace(/\bSaisons?\s*\d+\s*(-\s*\d+)?\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export async function enrichWithTmdb(
  title: string,
  type: 'movie' | 'series' = 'movie',
  year?: string
): Promise<Partial<TmdbResult> | null> {
  if (!TMDB_API_KEY) return null;

  try {
    const query = encodeURIComponent(searchQuery(title));
    const searchUrl = `${TMDB_BASE}/search/${type === 'series' ? 'tv' : 'movie'}?api_key=${TMDB_API_KEY}&query=${query}&language=fr-FR&page=1${year ? `&year=${year}` : ''}`;

    const resp = await request(searchUrl);
    if (resp.status !== 200) return null;

    const data = await resp.json();
    const results = data.results || [];
    if (results.length === 0) return null;

    const first = results[0];
    const id = first.id;

    const detailUrl = `${TMDB_BASE}/${type === 'series' ? 'tv' : 'movie'}/${id}?api_key=${TMDB_API_KEY}&language=fr-FR&append_to_response=credits,external_ids,videos&include_video_language=fr,en,null`;
    const detailResp = await request(detailUrl);
    if (detailResp.status !== 200) return null;

    const detail = await detailResp.json();

    const cast = (detail.credits?.cast || []).slice(0, 10).map((c: any) => c.name).filter(Boolean);

    // Bande-annonce YouTube : VF officielle en priorité, sinon anglaise.
    const trailerKey = pickTrailerKey(detail.videos?.results || []);

    return {
      title: detail.title || detail.name || first.title,
      overview: detail.overview || first.overview || '',
      posterPath: first.poster_path ? `${TMDB_IMG}/w500${first.poster_path}` : undefined,
      backdropPath: detail.backdrop_path ? `${TMDB_IMG}/original${detail.backdrop_path}` : undefined,
      releaseDate: detail.release_date || detail.first_air_date || first.release_date,
      voteAverage: detail.vote_average || first.vote_average,
      genres: (detail.genres || []).map((g: any) => g.name),
      cast: cast.length > 0 ? cast : undefined,
      runtime: detail.runtime || detail.episode_run_time?.[0],
      imdbId: detail.external_ids?.imdb_id,
      trailerKey,
    };
  } catch (err) {
    logger.warn(`TMDB enrichment failed for "${title}": ${(err as Error).message}`);
    return null;
  }
}
