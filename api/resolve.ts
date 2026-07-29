// Fonction Vercel ISOLÉE, épinglée sur la région Paris (cdg1) — voir vercel.json.
// Sert à résoudre des flux qui exigent une IP française/européenne réelle
// (vixsrc.to est géo-bloqué par Cloudflare au niveau TCP, contrairement à
// MovieBox qui fait confiance aux headers X-Forwarded-For). Séparée de
// api/index.ts pour ne PAS changer la région du reste de l'API (le spoof
// Burkina Faso pour MovieBox reste inchangé, indépendant de la région).
//
// GET /api/resolve/vixsrc?tmdb=&type=movie|tv&season=&episode=

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

interface VixsrcResult {
  sources: { url: string; format: string; quality: number }[];
}

async function resolveVixsrc(tmdbId: string, type: 'movie' | 'tv', season?: string, episode?: string): Promise<VixsrcResult | null> {
  const apiPath = type === 'tv'
    ? `/api/tv/${tmdbId}/${season}/${episode}`
    : `/api/movie/${tmdbId}`;
  const r1 = await fetch(`https://vixsrc.to${apiPath}?lang=fr`, {
    headers: { 'User-Agent': UA, 'Referer': 'https://vixsrc.to/' },
  });
  if (r1.status !== 200) return null;
  const json = await r1.json().catch(() => null);
  const src = json?.src as string | undefined;
  if (!src) return null;

  const idM = /\/embed\/(\d+)/.exec(src);
  const tokenM = /[?&]token=([^&]+)/.exec(src);
  const expiresM = /[?&]expires=(\d+)/.exec(src);
  if (!idM || !tokenM || !expiresM) return null;

  const playlistUrl = `https://vixsrc.to/playlist/${idM[1]}?token=${tokenM[1]}&expires=${expiresM[1]}&h=1&lang=fr`;

  // Vérifie que le flux répond vraiment (évite de renvoyer une URL morte)
  const check = await fetch(playlistUrl, { headers: { 'User-Agent': UA, 'Referer': 'https://vixsrc.to/' } });
  if (check.status !== 200) return null;
  const body = await check.text();
  if (!body.startsWith('#EXTM3U')) return null;

  return { sources: [{ url: playlistUrl, format: 'HLS', quality: 1080 }] };
}

export default async function handler(req: any, res: any) {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean); // ["api","resolve","vixsrc"]
  const provider = parts[parts.length - 1];

  const tmdb = url.searchParams.get('tmdb') || '';
  const type = (url.searchParams.get('type') === 'tv' ? 'tv' : 'movie') as 'movie' | 'tv';
  const season = url.searchParams.get('season') || undefined;
  const episode = url.searchParams.get('episode') || undefined;

  if (!tmdb) {
    res.status(400).json({ success: false, error: 'tmdb requis' });
    return;
  }

  try {
    if (provider === 'vixsrc') {
      const result = await resolveVixsrc(tmdb, type, season, episode);
      if (!result) {
        res.status(200).json({ success: false, data: { sources: [] } });
        return;
      }
      res.status(200).json({ success: true, provider: 'vixsrc-paris', data: { sources: result.sources, subtitles: [] } });
      return;
    }
    res.status(404).json({ success: false, error: 'provider inconnu' });
  } catch (e: any) {
    res.status(200).json({ success: false, error: e?.message || 'erreur', data: { sources: [] } });
  }
}
