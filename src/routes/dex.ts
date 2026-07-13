import { Router, Request, Response, NextFunction } from 'express';
import { cacheMiddleware } from '../middleware/cache';
import { AppError } from '../middleware/errorHandler';
import { ScraperEngine } from '../scrapers';

const router = Router();
const scraper = new ScraperEngine();

function wrapAsync(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

/**
 * @openapi
 * /api/dex/home:
 *   get:
 *     tags: [Content]
 *     summary: Récupère la page d'accueil (sections + tabs)
 *     responses:
 *       200:
 *         description: Home data with sections and tabs
 */
router.get('/home', cacheMiddleware('home'), wrapAsync(async (_req, res) => {
  const { data, source } = await scraper.home();
  res.json({
    success: true,
    data: { sections: data.sections, tabs: data.tabs },
    meta: { source, cached: false, timestamp: Date.now() },
  });
}));

/**
 * @openapi
 * /api/dex/category/{tabId}:
 *   get:
 *     tags: [Content]
 *     summary: Contenu d'une catégorie (onglet)
 *     parameters:
 *       - in: path
 *         name: tabId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *     responses:
 *       200:
 *         description: Category content
 */
router.get('/category/:tabId', cacheMiddleware('home'), wrapAsync(async (req, res) => {
  const tabId = req.params.tabId as string;
  const page = parseInt(req.query.page as string) || 1;
  const { data, source } = await scraper.category(tabId, page);
  res.json({
    success: true,
    data: { tabId, title: '', items: data.items, page, hasMore: data.hasMore },
    meta: { source, cached: false, timestamp: Date.now() },
  });
}));

/**
 * @openapi
 * /api/dex/search:
 *   get:
 *     tags: [Content]
 *     summary: Recherche plein texte
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *     responses:
 *       200:
 *         description: Search results
 *       400:
 *         description: Query too short
 */
router.get('/search', cacheMiddleware('search'), wrapAsync(async (req, res) => {
  const query = req.query.q as string;
  const page = parseInt(req.query.page as string) || 1;
  if (!query || query.length < 2) {
    throw new AppError(400, 'INVALID_QUERY', 'Search query must be at least 2 characters');
  }
  const { data, source } = await scraper.search(query, page);
  res.json({
    success: true,
    data,
    meta: { source, cached: false, timestamp: Date.now() },
  });
}));

/**
 * @openapi
 * /api/dex/suggest:
 *   get:
 *     tags: [Content]
 *     summary: Suggestions autocomplete
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Suggestions list
 */
router.get('/suggest', wrapAsync(async (req, res) => {
  const query = req.query.q as string;
  if (!query || query.length < 2) {
    res.json({ success: true, data: [] });
    return;
  }
  const { data, source } = await scraper.suggest(query);
  res.json({
    success: true,
    data,
    meta: { source, cached: false, timestamp: Date.now() },
  });
}));

/**
 * @openapi
 * /api/dex/detail/{subjectId}:
 *   get:
 *     tags: [Content]
 *     summary: Détail d'un contenu (film/série)
 *     parameters:
 *       - in: path
 *         name: subjectId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Content detail
 */
router.get('/detail/:subjectId', cacheMiddleware('detail'), wrapAsync(async (req, res) => {
  const subjectId = req.params.subjectId as string;
  if (!subjectId) throw new AppError(400, 'MISSING_ID', 'subjectId is required');
  const { data, source } = await scraper.detail(subjectId);
  res.json({
    success: true,
    data,
    meta: { source, cached: false, timestamp: Date.now() },
  });
}));

/**
 * @openapi
 * /api/dex/trending:
 *   get:
 *     tags: [Content]
 *     summary: Contenu tendance (première catégorie)
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *     responses:
 *       200:
 *         description: Trending items
 */
router.get('/trending', cacheMiddleware('home'), wrapAsync(async (req, res) => {
  const page = parseInt(req.query.page as string) || 1;
  const { data, source } = await scraper.category('trending', page);
  res.json({
    success: true,
    data: { items: data.items, page, hasMore: data.hasMore },
    meta: { source, cached: false, timestamp: Date.now() },
  });
}));

/**
 * @openapi
 * /api/dex/stream/{subjectId}:
 *   get:
 *     tags: [Stream]
 *     summary: URLs de streaming pour un contenu
 *     parameters:
 *       - in: path
 *         name: subjectId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: season
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: episode
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: detailPath
 *         description: Slug du contenu (recommandé, évite un aller-retour detail)
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Stream sources
 */
router.get('/stream/:subjectId', cacheMiddleware('stream'), wrapAsync(async (req, res) => {
  const subjectId = req.params.subjectId as string;
  // Alias se/ep acceptés pour compatibilité avec les anciens clients
  const season = parseInt((req.query.season ?? req.query.se) as string) || 1;
  const episode = parseInt((req.query.episode ?? req.query.ep) as string) || 1;
  const detailPath = (req.query.detailPath as string) || undefined;
  if (!subjectId) throw new AppError(400, 'MISSING_ID', 'subjectId is required');
  const { data, source } = await scraper.stream(subjectId, season, episode, detailPath);
  res.json({
    success: true,
    data,
    meta: { source, cached: false, timestamp: Date.now() },
  });
}));

/**
 * Diagnostic temporaire : exécute le flux stream étape par étape et rapporte
 * où ça casse depuis l'environnement d'exécution (Vercel vs local).
 */
router.get('/_debug/stream', wrapAsync(async (req, res) => {
  const { request } = await import('../utils/http');
  const { API_H5_URL, ENDPOINTS } = await import('../config/constants');

  const subjectId = (req.query.subjectId as string) || '2226969025052033872';
  const slug = (req.query.detailPath as string) || 'batman-caped-crusader-Sxx7RwAxvE2';
  const steps: any[] = [];

  const H5: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/148.0.0.0 Safari/537.36',
    'Referer': 'https://moviebox.ph/',
    'Origin': 'https://moviebox.ph',
    'X-Client-Info': '{"timezone":"Asia/Dhaka"}',
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };

  let token = '';
  try {
    const r = await request(`${API_H5_URL}${ENDPOINTS.h5Home}?host=moviebox.ph`, { headers: H5 });
    token = JSON.parse(r.headers['x-user'] || '{}').token || '';
    steps.push({ step: 'token', status: r.status, ok: !!token });
  } catch (e: any) {
    steps.push({ step: 'token', error: e.message });
    res.json({ steps });
    return;
  }

  const auth = { ...H5, Authorization: `Bearer ${token}` };

  let domain = 'https://netfilm.world';
  try {
    const r = await request(`${API_H5_URL}${ENDPOINTS.h5PlayDomain}`, { headers: auth });
    const j = await r.json();
    domain = String(j?.data || domain).replace(/\/$/, '');
    steps.push({ step: 'get-domain', status: r.status, domain });
  } catch (e: any) {
    steps.push({ step: 'get-domain', error: e.message });
  }

  // netfilm.world répond 403 "invalid region" depuis les IP Vercel :
  // on teste plusieurs IP de spoof + le domaine h5api direct pour trouver une voie qui passe.
  const spoofCandidates: Record<string, Record<string, string>> = {
    'no-spoof': {},
    'ip-NG': { 'X-Forwarded-For': '41.58.0.1', 'CF-Connecting-IP': '41.58.0.1', 'X-Real-IP': '41.58.0.1' },
    'ip-BD': { 'X-Forwarded-For': '103.108.144.1', 'CF-Connecting-IP': '103.108.144.1', 'X-Real-IP': '103.108.144.1' },
    'ip-1.1.1.1': { 'X-Forwarded-For': '1.1.1.1', 'CF-Connecting-IP': '1.1.1.1', 'X-Real-IP': '1.1.1.1' },
  };

  const bases = [domain, API_H5_URL];
  for (const base of bases) {
    const playUrl = `${base}${ENDPOINTS.h5Play}?subjectId=${subjectId}&se=1&ep=1&detailPath=${slug}`;
    const referer = `${base}/spa/videoPlayPage/movies/${slug}?id=${subjectId}&type=/movie/detail&detailSe=1&detailEp=1&lang=en`;
    for (const [label, spoof] of Object.entries(spoofCandidates)) {
      try {
        const r = await request(playUrl, { headers: { ...auth, Referer: referer, ...spoof } });
        let streams = -1;
        try { streams = (JSON.parse(r.body)?.data?.streams || []).length; } catch { }
        steps.push({ step: `play ${base}[${label}]`, status: r.status, streams, body: r.body.substring(0, 120) });
      } catch (e: any) {
        steps.push({ step: `play ${base}[${label}]`, error: e.message });
      }
    }
  }

  res.json({ steps });
}));

export default router;
