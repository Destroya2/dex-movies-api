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

/**
 * Tente les providers de secours dans l'ordre jusqu'à obtenir des sources.
 * Retourne { sources: [] } si tout échoue (bloqué / titre absent).
 */
export async function fallbackStream(
  tmdbId: string,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number,
): Promise<FallbackStream> {
  const providers: [string, () => Promise<FallbackStream>][] = [
    ['vixsrc', () => vixsrc(tmdbId, type, season, episode)],
  ];
  for (const [name, fn] of providers) {
    try {
      const r = await fn();
      if (r.sources.length > 0) {
        logger.info(`Fallback ${name} → ${r.sources.length} source(s) pour tmdb ${tmdbId}`);
        return r;
      }
    } catch (e: any) {
      logger.warn(`Fallback ${name} échec (tmdb ${tmdbId}): ${e?.message || e}`);
    }
  }
  return { sources: [], subtitles: [] };
}
