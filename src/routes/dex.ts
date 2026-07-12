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
  const firstTab = '4516404531735022304';
  const { data, source } = await scraper.category(firstTab, page);
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
 *     responses:
 *       200:
 *         description: Stream sources
 */
router.get('/stream/:subjectId', cacheMiddleware('stream'), wrapAsync(async (req, res) => {
  const subjectId = req.params.subjectId as string;
  const season = parseInt(req.query.season as string) || 1;
  const episode = parseInt(req.query.episode as string) || 1;
  if (!subjectId) throw new AppError(400, 'MISSING_ID', 'subjectId is required');
  const { data, source } = await scraper.stream(subjectId, season, episode);
  res.json({
    success: true,
    data,
    meta: { source, cached: false, timestamp: Date.now() },
  });
}));

export default router;
