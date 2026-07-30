// Fonction Vercel ISOLÉE, épinglée sur la région Paris (cdg1) — voir vercel.json.
// Sert à résoudre des flux qui exigent une IP française/européenne réelle
// (vixsrc.to est géo-bloqué par Cloudflare au niveau TCP, contrairement à
// MovieBox qui fait confiance aux headers X-Forwarded-For). Séparée de
// api/index.ts pour ne PAS changer la région du reste de l'API (le spoof
// Burkina Faso pour MovieBox reste inchangé, indépendant de la région).
//
// GET /api/resolve?provider=vixsrc&tmdb=&type=movie|tv&season=&episode=

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

interface VixsrcResult {
  sources: { url: string; format: string; quality: number }[];
}

// CONSTAT (vérifié en prod, région cdg1/Paris) : vixsrc.to renvoie 403 dès le
// premier appel /api/movie, même depuis une IP française. Le blocage est basé
// sur la classe de l'IP (hébergeur cloud détecté par Cloudflare), pas sur le
// pays — épingler la fonction sur Paris ne suffit donc pas ici. Il faut une
// IP réellement résidentielle (voir pi-resolver/). Fonction conservée : la
// logique HTTP pure reste valable et utile si un jour on la relaie depuis
// une IP résidentielle (ex: via le Pi comme proxy sortant).
async function resolveVixsrc(tmdbId: string, type: 'movie' | 'tv', season?: string, episode?: string): Promise<VixsrcResult | null> {
  const apiPath = type === 'tv'
    ? `/api/tv/${tmdbId}/${season}/${episode}`
    : `/api/movie/${tmdbId}`;
  const r1 = await fetch(`https://vixsrc.to${apiPath}?lang=fr`, {
    headers: { 'User-Agent': UA, 'Referer': 'https://vixsrc.to/' },
  });
  if (r1.status !== 200) return null;
  const json: any = await r1.json().catch(() => null);
  const src = json?.src as string | undefined;
  if (!src) return null;

  const idM = /\/embed\/(\d+)/.exec(src);
  const tokenM = /[?&]token=([^&]+)/.exec(src);
  const expiresM = /[?&]expires=(\d+)/.exec(src);
  if (!idM || !tokenM || !expiresM) return null;

  const playlistUrl = `https://vixsrc.to/playlist/${idM[1]}?token=${tokenM[1]}&expires=${expiresM[1]}&h=1&lang=fr`;

  const check = await fetch(playlistUrl, { headers: { 'User-Agent': UA, 'Referer': 'https://vixsrc.to/' } });
  if (check.status !== 200) return null;
  const body = await check.text();
  if (!body.startsWith('#EXTM3U')) return null;

  return { sources: [{ url: playlistUrl, format: 'HLS', quality: 1080 }] };
}

export default async function handler(req: any, res: any) {
  const url = new URL(req.url, 'http://localhost');
  const provider = url.searchParams.get('provider') || '';

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
      if (!result || result.sources.length === 0) {
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
