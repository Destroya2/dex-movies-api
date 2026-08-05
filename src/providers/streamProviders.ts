import { StreamProvider, StreamRequest, StreamOutcome } from './types';
import { piResolverStream, vidcoreStream } from '../utils/streamFallback';

/**
 * Providers de flux concrets.
 *
 * Chacun est autonome : il décide s'il sait traiter la demande (`supports`) et
 * renvoie soit des sources, soit `null`. Aucun ne connaît les autres — c'est
 * l'orchestrateur (`registry.ts`) qui gère l'ordre, la santé et le budget.
 *
 * Ordre de priorité voulu, et pourquoi :
 *  10 — MovieBox (natif ou via le pont TMDB) : **seule source VF garantie**, et
 *       la seule qui donne aussi les sous-titres et les pistes doublées.
 *  20 — Resolver Pi : navigateur headless sur IP résidentielle, couvre les
 *       titres absents de MovieBox. Coûteux (plusieurs secondes) → après.
 *  30 — vidcore : VO uniquement, dernier recours. Passé derrière un challenge
 *       JS le 05/08/2026 : il échouera, le disjoncteur l'écartera tout seul —
 *       c'est exactement le comportement attendu, on le garde branché pour le
 *       jour où il redevient exploitable.
 */

/** MovieBox : la résolution réelle est injectée (elle vit dans ScraperEngine). */
export function createMovieBoxProvider(
  resolveMovieBox: (req: StreamRequest) => Promise<StreamOutcome | null>
): StreamProvider {
  return {
    name: 'moviebox',
    priority: 10,
    // Un id natif suffit ; un id `tmdb:` n'est traitable que si le pont a pu
    // retrouver un sujet MovieBox (c'est `resolveMovieBox` qui s'en charge).
    supports: (req) => Boolean(req.subjectId),
    resolve: resolveMovieBox,
  };
}

export const piResolverProvider: StreamProvider = {
  name: 'pi-resolver',
  priority: 20,
  // Le resolver cherche par id TMDB (et affine avec titre/année).
  supports: (req) => Boolean(req.tmdbId),
  async resolve(req) {
    const r = await piResolverStream(
      req.tmdbId!,
      req.tmdbType || 'movie',
      req.season,
      req.episode,
      req.title,
      req.year
    );
    if (!r || r.sources.length === 0) return null;
    return {
      sources: r.sources,
      subtitles: r.subtitles,
      hasResource: true,
      freeEpisodes: 0,
      audioLanguage: r.audioLanguage,
    };
  },
};

export const vidcoreProvider: StreamProvider = {
  name: 'vidcore',
  priority: 30,
  supports: (req) => Boolean(req.tmdbId),
  async resolve(req) {
    const r = await vidcoreStream(
      req.tmdbId!,
      req.tmdbType || 'movie',
      req.season,
      req.episode
    );
    if (!r || r.sources.length === 0) return null;
    return {
      sources: r.sources,
      subtitles: r.subtitles,
      hasResource: true,
      freeEpisodes: 0,
      audioLanguage: r.audioLanguage,
    };
  },
};
