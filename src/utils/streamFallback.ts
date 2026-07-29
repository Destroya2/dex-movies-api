import { request } from './http';
import { logger } from '../middleware/logger';

/**
 * Providers de secours par TMDB id, pour les titres absents du catalogue VF
 * MovieBox (blockbusters hollywoodiens récents surtout). Flux souvent en VO
 * avec sous-titres. Purs HTTP (compatibles Vercel), best-effort : renvoient []
 * si le site est géo/CF-bloqué depuis l'IP appelante.
 *
 * Extracteurs portés de repos/NuvioStreamsAddon/providers (vixsrc.js).
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

export interface FallbackStream {
  sources: { url: string; format: string; quality: number; codec?: string }[];
  subtitles: { url: string; language: string }[];
}

// ─── vixsrc.to ────────────────────────────────────────────────────────────────
async function vixsrc(tmdbId: string, type: 'movie' | 'tv', season?: number, episode?: number): Promise<FallbackStream> {
  const page = type === 'movie'
    ? `https://vixsrc.to/movie/${tmdbId}`
    : `https://vixsrc.to/tv/${tmdbId}/${season}/${episode}`;
  try {
    const resp = await request(page, {
      headers: { 'User-Agent': UA, 'Referer': 'https://vixsrc.to/', 'Accept': 'text/html,application/xhtml+xml' },
      timeout: 15000,
    });
    if (resp.status !== 200) return { sources: [], subtitles: [] };
    const html = resp.body;

    let master: string | null = null;
    // Méthode 1 : window.masterPlaylist { url, token, expires }
    if (html.includes('masterPlaylist')) {
      const urlM = html.match(/url:\s*['"]([^'"]+)['"]/);
      const tokM = html.match(/['"]?token['"]?\s*:\s*['"]([^'"]+)['"]/);
      const expM = html.match(/['"]?expires['"]?\s*:\s*['"]?(\d+)/);
      if (urlM && tokM && expM) {
        const base = urlM[1];
        const sep = base.includes('?') ? '&' : '?';
        master = `${base}${sep}token=${tokM[1]}&expires=${expM[1]}&h=1&lang=fr`;
      }
    }
    // Méthode 2 : .m3u8 direct
    if (!master) {
      const m = html.match(/https?:\/\/[^'"\s]+\.m3u8[^'"\s]*/);
      if (m) master = m[0];
    }
    if (!master) return { sources: [], subtitles: [] };

    // Sous-titres via wyzie (multi-langue, dont français quand dispo)
    const subtitles = await wyzieSubs(tmdbId, season, episode);
    return {
      sources: [{ url: master, format: 'HLS', quality: 1080, codec: 'h264' }],
      subtitles,
    };
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
// Service tournant sur le Raspberry Pi (voir pi-resolver/), exposé via Tailscale
// Funnel. Capture le flux par interception réseau → débloque les titres que ni
// MovieBox ni le HTTP simple ne donnent. Best-effort : si le Pi est hors-ligne,
// on dégrade proprement.
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
    };
  } catch (e: any) {
    logger.warn(`Resolver Pi injoignable (tmdb ${tmdbId}): ${e?.message || e}`);
    return { sources: [], subtitles: [] };
  }
}

/**
 * Tente les providers de secours jusqu'à obtenir des sources :
 * 1) le resolver Pi (navigateur, débloque le plus de titres) si configuré,
 * 2) vixsrc en HTTP direct (best-effort, souvent bloqué depuis un datacenter).
 * Retourne { sources: [] } si tout échoue.
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

  try {
    const r = await vixsrc(tmdbId, type, season, episode);
    if (r.sources.length > 0) {
      logger.info(`Fallback vixsrc(http) → ${r.sources.length} source(s) pour tmdb ${tmdbId}`);
      return r;
    }
  } catch (e: any) {
    logger.warn(`Fallback vixsrc(http) échec (tmdb ${tmdbId}): ${e?.message || e}`);
  }
  return { sources: [], subtitles: [] };
}
