// Fonction Vercel ISOLÉE, épinglée sur la région Paris (cdg1) — voir vercel.json.
// Sert d'outil de diagnostic pour tester de nouveaux providers candidats
// depuis une IP européenne avant de les intégrer à la chaîne active
// (src/utils/streamFallback.ts). Séparée de api/index.ts pour ne PAS changer
// la région du reste de l'API (le spoof Burkina Faso pour MovieBox reste
// inchangé, indépendant de la région).
//
// vixsrc.to a été retiré (30/07/2026) : renvoie 403 dès le premier appel même
// depuis Paris — blocage par classe d'IP (hébergeur cloud détecté par
// Cloudflare), pas par pays. Seule une IP réellement résidentielle passe
// (voir pi-resolver/). Voir git log pour l'extracteur si besoin de le tester
// à nouveau un jour depuis une IP résidentielle.
//
// GET /api/resolve?provider=vidcore&tmdb=&type=movie|tv&season=&episode=

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

interface VixsrcResult {
  sources: { url: string; format: string; quality: number }[];
}

async function resolveVidcore(tmdbId: string, type: 'movie' | 'tv', season?: string, episode?: string): Promise<VixsrcResult | null> {
  const qs = type === 'tv'
    ? `id=${tmdbId}&type=tv&mediaType=tv&season=${season}&episode=${episode}`
    : `id=${tmdbId}&type=movie&mediaType=movie`;
  const r = await fetch(`https://www.vidcore.org/api/sources?${qs}`, { headers: { 'User-Agent': UA } });
  if (r.status !== 200) return null;
  const text = await r.text();
  const sources: { url: string; format: string; quality: number }[] = [];
  for (const line of text.trim().split('\n')) {
    try {
      const obj = JSON.parse(line);
      const s = obj?.data?.sources?.[0];
      if (s?.url) sources.push({ url: s.url, format: 'HLS', quality: 1080 });
    } catch {}
  }
  return sources.length ? { sources } : null;
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
    if (provider === 'vidcore') {
      const result = await resolveVidcore(tmdb, type, season, episode);
      if (!result || result.sources.length === 0) {
        res.status(200).json({ success: false, data: { sources: [] } });
        return;
      }
      res.status(200).json({ success: true, provider: 'vidcore', data: { sources: result.sources, subtitles: [] } });
      return;
    }
    res.status(404).json({ success: false, error: 'provider inconnu' });
  } catch (e: any) {
    res.status(200).json({ success: false, error: e?.message || 'erreur', data: { sources: [] } });
  }
}
