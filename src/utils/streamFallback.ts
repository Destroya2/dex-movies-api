import { request } from './http';
import { logger } from '../middleware/logger';

/**
 * Providers de secours par TMDB id, pour les titres absents du catalogue VF
 * MovieBox (blockbusters hollywoodiens récents surtout). Flux souvent en VO
 * avec sous-titres. Purs HTTP (compatibles Vercel), best-effort : renvoient []
 * si le site est géo/CF-bloqué depuis l'IP appelante.
 *
 * vixsrc.to a été retiré (30/07/2026) : bloqué par IP/ASN Cloudflare même
 * depuis Vercel Paris (403 dès le premier appel), jamais appelé dans la
 * chaîne active. Voir git log pour l'extracteur si besoin de le réactiver
 * un jour depuis une IP résidentielle.
 *
 * Recherche de providers additionnels (29/07/2026) — candidats testés et
 * écartés, pour éviter de refaire cette recherche :
 * - mp4hydra.org : en maintenance ("Back soon") au moment du test, endpoint
 *   POST /info2 renvoie 405. Extracteur HTTP pur déjà porté dans
 *   repos/NuvioStreamsAddon/providers/MP4Hydra.js, à réessayer périodiquement.
 * - player.vidzee.wtf/api/server : 404, endpoint probablement déplacé depuis
 *   l'écriture de repos/NuvioStreamsAddon/providers/VidZee.js.
 * - rivestream.app, autoembed.cc, api.hexa.watch : NXDOMAIN (domaines morts
 *   ou en rotation — fréquent sur ce type de site).
 * - vidbinge.to (MoviesAPI) : domaine actif mais pattern d'embed deviné
 *   (/embed/movie/:id) renvoie 404 ; pattern réel non documenté publiquement.
 * - vidnest.fun : renvoie une page Next.js, mais l'appel API réel (fetch côté
 *   client) n'apparaît dans aucun des chunks JS statiquement chargés —
 *   nécessiterait une rétro-ingénierie type navigateur headless (comme le Pi)
 *   pour un catalogue dont la taille (115k+ films revendiqués) n'est pas
 *   vérifiée indépendamment.
 * - videasy.to/player.videasy.net : appelle un domaine backend obfusqué
 *   (db.speedracelight.com) dont le protocole n'est pas documenté.
 * Conclusion : aucun n'est intégrable sans effort de rétro-ingénierie
 * comparable à celui déjà investi sur le resolver Pi, pour un gain incertain.
 *
 * CinePro Core (30/07/2026, github.com/cinepro-org/core) — agrégateur
 * auto-hébergeable de 14 providers (FshareTV, Icefy, VixSrc, VidZee...) sous
 * une API HTTP unique. Testé en LOCAL avec succès réel : source MP4 valide de
 * 963 Mo, Range requests OK, lecture confirmée (`/v1/movies/414906`). Mais
 * uniquement VO sur ce test (org/eng/ita, pas de FR), et le déploiement
 * Vercel a échoué : FUNCTION_INVOCATION_FAILED — le serveur (OMSS framework)
 * appelle `server.start()` façon process Node persistant (`.listen()`), pas
 * un handler serverless exportable, donc incompatible avec le modèle Vercel
 * malgré le bouton "Deploy with Vercel" de leur README. Cible plus adaptée :
 * Render (process persistant supporté) ou le Pi une fois l'accès SSH rétabli.
 * Code laissé de côté pour l'instant — pas intégré, projet de test Vercel
 * supprimé après l'échec.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

export interface FallbackStream {
  sources: { url: string; format: string; quality: number; codec?: string }[];
  subtitles: { url: string; language: string }[];
  // 'fr' seulement quand la source est connue pour être en VF (coflix). Absent
  // si inconnu/probablement VO (vixsrc, vidcore) — jamais une estimation optimiste.
  audioLanguage?: string;
}

// ─── vidcore.org (hébergé, pré-proxifié) ──────────────────────────────────────
// vidcore.org relaie déjà les flux via SES PROPRES proxies Cloudflare Workers
// (vidrift.pages.dev, embed.anicine.workers.dev) : c'est LEUR infrastructure
// qui absorbe le géo/ASN-blocking, pas la nôtre. Vérifié fonctionnel depuis
// Vercel (Paris) ET depuis une IP résidentielle. Limite connue : VO uniquement
// (aucun paramètre de langue n'a d'effet, pas de VF) — sous-titres wyzie.ru
// ajoutés en complément pour au moins proposer du VOSTFR.
async function vidcore(tmdbId: string, type: 'movie' | 'tv', season?: number, episode?: number): Promise<FallbackStream> {
  try {
    const qs = type === 'tv'
      ? `id=${tmdbId}&type=tv&mediaType=tv&season=${season ?? 1}&episode=${episode ?? 1}`
      : `id=${tmdbId}&type=movie&mediaType=movie`;
    const resp = await request(`https://www.vidcore.org/api/sources?${qs}`, {
      headers: { 'User-Agent': UA },
      timeout: 12000,
    });
    if (resp.status !== 200) return { sources: [], subtitles: [] };

    const sources: FallbackStream['sources'] = [];
    for (const line of resp.body.trim().split('\n')) {
      try {
        const obj = JSON.parse(line);
        const s = obj?.data?.sources?.[0];
        if (s?.url) sources.push({ url: s.url, format: 'HLS', quality: 1080 });
      } catch {}
    }
    if (sources.length === 0) return { sources: [], subtitles: [] };

    const subtitles = await wyzieSubs(tmdbId, season, episode);
    // Confirmé VO (jamais de VF sur ce provider, voir commentaire plus haut).
    return { sources, subtitles, audioLanguage: 'vo' };
  } catch {
    return { sources: [], subtitles: [] };
  }
}

// ─── Sous-titres wyzie (par TMDB id) ─────────────────────────────────────────
async function wyzieSubs(tmdbId: string, season?: number, episode?: number): Promise<{ url: string; language: string }[]> {
  try {
    const url = season
      ? `https://sub.wyzie.ru/search?id=${tmdbId}&season=${season}&episode=${episode}`
      : `https://sub.wyzie.ru/search?id=${tmdbId}`;
    const resp = await request(url, { headers: { 'User-Agent': UA }, timeout: 8000 });
    if (resp.status !== 200) return [];
    const arr = JSON.parse(resp.body);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((s: any) => ({ url: s.url || '', language: s.display || s.language || 'Unknown' }))
      .filter((s: any) => s.url)
      // Français en tête
      .sort((a: any, b: any) => {
        const fa = /fran|fr/i.test(a.language) ? 0 : 1;
        const fb = /fran|fr/i.test(b.language) ? 0 : 1;
        return fa - fb;
      })
      .slice(0, 12);
  } catch {
    return [];
  }
}

// ─── Resolver Pi (navigateur headless, IP résidentielle) ─────────────────────
// Service tournant sur le Raspberry Pi (voir pi-resolver/), exposé via un
// tunnel Cloudflare nommé (resolver.iafr-ahd.com). Capture le flux par
// interception réseau → débloque les titres que ni MovieBox ni le HTTP simple
// ne donnent. Best-effort : si le Pi est hors-ligne, on dégrade proprement.
async function piResolver(
  tmdbId: string,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number,
  title?: string,
  year?: string,
): Promise<FallbackStream> {
  const base = process.env.FALLBACK_RESOLVER_URL;
  if (!base) return { sources: [], subtitles: [] };
  const token = process.env.RESOLVER_TOKEN || '';
  const qs = new URLSearchParams({ tmdb: tmdbId, type });
  if (season) qs.set('season', String(season));
  if (episode) qs.set('episode', String(episode));
  if (title) qs.set('title', title);
  if (year) qs.set('year', year);
  if (token) qs.set('key', token);

  try {
    // IMPORTANT : Vercel coupe la fonction à 30 s (maxDuration). Le pont TMDB a
    // déjà consommé quelques secondes avant d'arriver ici → on plafonne l'appel
    // resolver à 20 s pour renvoyer une réponse propre (sources vides) avant le
    // 504 Vercel. Surchargeable via RESOLVER_TIMEOUT_MS.
    const timeout = parseInt(process.env.RESOLVER_TIMEOUT_MS || '20000', 10);
    const resp = await request(`${base.replace(/\/$/, '')}/resolve?${qs.toString()}`, {
      headers: { 'User-Agent': UA },
      timeout,
    });
    if (resp.status !== 200) return { sources: [], subtitles: [] };
    const json = JSON.parse(resp.body);
    if (!json?.success || !json?.data?.sources?.length) return { sources: [], subtitles: [] };
    logger.info(`Resolver Pi (${json.provider}) → ${json.data.sources.length} source(s) pour tmdb ${tmdbId}`);
    return {
      sources: json.data.sources.map((s: any) => ({
        url: s.url, format: s.format || 'HLS', quality: s.quality || 1080,
      })),
      subtitles: (json.data.subtitles || []).map((c: any) => ({ url: c.url, language: c.language || 'Unknown' })),
      // coflix = site FR, VF par construction. vixsrc = VO la plupart du temps,
      // jamais garanti même avec le paramètre lang=fr → on ne prétend rien.
      audioLanguage: json.provider === 'coflix' ? 'fr' : undefined,
    };
  } catch (e: any) {
    logger.warn(`Resolver Pi injoignable (tmdb ${tmdbId}): ${e?.message || e}`);
    return { sources: [], subtitles: [] };
  }
}

/**
 * Tente les providers de secours jusqu'à obtenir des sources, VF avant VO :
 * 1) le resolver Pi (Frembed VF via navigateur) si Bastien est en ligne,
 * 2) vidcore.org (VO, hébergé et fiable, ne dépend d'aucune IP à nous).
 * Retourne { sources: [] } si tout échoue.
 */
/**
 * Chaîne de repli historique, conservée pour compatibilité. La sélection des
 * sources passe désormais par `providers/registry.ts` : l'ordre, la santé et le
 * budget de temps y sont gérés au même endroit pour TOUTES les sources, au lieu
 * d'être codés en dur ici.
 */
export async function fallbackStream(
  tmdbId: string,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number,
  title?: string,
  year?: string,
): Promise<FallbackStream> {
  const pi = await piResolver(tmdbId, type, season, episode, title, year);
  if (pi.sources.length > 0) return pi;

  const vc = await vidcore(tmdbId, type, season, episode);
  if (vc.sources.length > 0) {
    logger.info(`Fallback vidcore → ${vc.sources.length} source(s) pour tmdb ${tmdbId}`);
    return vc;
  }

  return { sources: [], subtitles: [] };
}

// Exposés individuellement pour que chaque source devienne un provider
// autonome (voir providers/streamProviders.ts).
export const piResolverStream = piResolver;
export const vidcoreStream = vidcore;
