import { Router, Request, Response, NextFunction } from 'express';
import { cacheMiddleware } from '../middleware/cache';
import { AppError } from '../middleware/errorHandler';
import { ScraperEngine } from '../scrapers';
import {
  isTmdbEnabled, tmdbHome, tmdbTrending, tmdbDiscover, tmdbGenres, tmdbDetail, tmdbSimilar, TmdbMediaType,
} from '../utils/tmdbCatalog';

const router = Router();
const scraper = new ScraperEngine();

function appTypeToTmdb(type: string): TmdbMediaType {
  return type === 'series' || type === 'tv' ? 'tv' : 'movie';
}

function wrapAsync(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

// Plafond de longueur sur les params passés aux scrapers/au cache : évite les
// payloads excessifs (gonflement des clés de cache, ralentissement du matching).
const MAX_PARAM_LEN = 200;
function checkLen(value: string | undefined, name: string): void {
  if (value && value.length > MAX_PARAM_LEN) {
    throw new AppError(400, 'INVALID_PARAM', `${name} too long`);
  }
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
  checkLen(query, 'q');
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
  checkLen(query, 'q');
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
  checkLen(subjectId, 'subjectId');
  if (!subjectId) throw new AppError(400, 'MISSING_ID', 'subjectId is required');
  let result;
  try {
    result = await scraper.detail(subjectId);
  } catch (e: any) {
    // Certains titres disparaissent du catalogue upstream : la fiche répond en
    // erreur sur tous les miroirs. Ce n'est PAS un bug de notre API — on renvoie
    // donc 404 (titre indisponible) plutôt qu'un 500 « Internal server error »,
    // qui polluait les métriques et masquait les vraies pannes.
    // Côté clients rien ne change : Android garde les infos de la liste (détail
    // résilient) et la PWA affiche son état d'erreur — tous deux traitent déjà
    // n'importe quel statut non-2xx de la même façon.
    throw new AppError(404, 'UPSTREAM_UNAVAILABLE',
      "Ce titre n'est plus disponible chez la source.");
  }
  res.json({
    success: true,
    data: result.data,
    meta: { source: result.source, cached: false, timestamp: Date.now() },
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

// ─── Catalogue TMDB (navigation quasi-infinie) ───────────────────────────────

/**
 * @openapi
 * /api/dex/catalog/home:
 *   get:
 *     tags: [Catalog]
 *     summary: Accueil catalogue TMDB (rails façon Netflix)
 */
router.get('/catalog/home', cacheMiddleware('home'), wrapAsync(async (_req, res) => {
  if (!isTmdbEnabled()) throw new AppError(503, 'TMDB_DISABLED', 'Catalogue TMDB non configuré (TMDB_API_KEY manquante)');
  const data = await tmdbHome();
  res.json({ success: true, data, meta: { source: 'tmdb', cached: false, timestamp: Date.now() } });
}));

/**
 * @openapi
 * /api/dex/catalog/genres:
 *   get:
 *     tags: [Catalog]
 *     summary: Liste des genres TMDB (chips de filtre)
 */
router.get('/catalog/genres', cacheMiddleware('home'), wrapAsync(async (req, res) => {
  if (!isTmdbEnabled()) throw new AppError(503, 'TMDB_DISABLED', 'Catalogue TMDB non configuré');
  const type = appTypeToTmdb((req.query.type as string) || 'movie');
  const data = await tmdbGenres(type);
  res.json({ success: true, data, meta: { source: 'tmdb', cached: false, timestamp: Date.now() } });
}));

/**
 * @openapi
 * /api/dex/catalog/discover:
 *   get:
 *     tags: [Catalog]
 *     summary: Découverte paginée (catalogue infini filtrable)
 *     parameters:
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [movie, series] }
 *       - in: query
 *         name: genre
 *         schema: { type: integer }
 *       - in: query
 *         name: country
 *         schema: { type: string }
 *       - in: query
 *         name: year
 *         schema: { type: integer }
 *       - in: query
 *         name: sort
 *         schema: { type: string }
 *       - in: query
 *         name: language
 *         schema: { type: string }
 *         description: Filtre optionnel sur la langue ORIGINALE (ISO 639-1) — pas une garantie VF
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 */
router.get('/catalog/discover', cacheMiddleware('home'), wrapAsync(async (req, res) => {
  if (!isTmdbEnabled()) throw new AppError(503, 'TMDB_DISABLED', 'Catalogue TMDB non configuré');
  const type = appTypeToTmdb((req.query.type as string) || 'movie');
  const page = parseInt(req.query.page as string) || 1;
  const genre = req.query.genre ? parseInt(req.query.genre as string) : undefined;
  const year = req.query.year ? parseInt(req.query.year as string) : undefined;
  const country = (req.query.country as string) || undefined;
  const sort = (req.query.sort as string) || undefined;
  const language = (req.query.language as string) || undefined;

  const data = req.query.trending !== undefined
    ? await tmdbTrending(type, page)
    : await tmdbDiscover({ type, page, genre, year, country, sort, language });

  res.json({
    success: true,
    data: { tabId: type, title: '', items: data.items, page: data.page, hasMore: data.hasMore },
    meta: { source: 'tmdb', cached: false, timestamp: Date.now() },
  });
}));

/**
 * @openapi
 * /api/dex/catalog/detail/{tmdbType}/{tmdbId}:
 *   get:
 *     tags: [Catalog]
 *     summary: Détail d'un titre TMDB
 */
router.get('/catalog/detail/:tmdbType/:tmdbId', cacheMiddleware('detail'), wrapAsync(async (req, res) => {
  if (!isTmdbEnabled()) throw new AppError(503, 'TMDB_DISABLED', 'Catalogue TMDB non configuré');
  const type = appTypeToTmdb(req.params.tmdbType as string);
  const id = parseInt(req.params.tmdbId as string);
  if (!id) throw new AppError(400, 'MISSING_ID', 'tmdbId invalide');
  const data = await tmdbDetail(type, id);
  if (!data) throw new AppError(404, 'NOT_FOUND', 'Titre introuvable');
  res.json({ success: true, data, meta: { source: 'tmdb', cached: false, timestamp: Date.now() } });
}));

/**
 * @openapi
 * /api/dex/catalog/similar/{tmdbType}/{tmdbId}:
 *   get:
 *     tags: [Catalog]
 *     summary: Titres similaires (TMDB natif, marche même sans bridge MovieBox)
 */
router.get('/catalog/similar/:tmdbType/:tmdbId', cacheMiddleware('home'), wrapAsync(async (req, res) => {
  if (!isTmdbEnabled()) throw new AppError(503, 'TMDB_DISABLED', 'Catalogue TMDB non configuré');
  const type = appTypeToTmdb(req.params.tmdbType as string);
  const id = parseInt(req.params.tmdbId as string);
  if (!id) throw new AppError(400, 'MISSING_ID', 'tmdbId invalide');
  const page = parseInt(req.query.page as string) || 1;
  const data = await tmdbSimilar(type, id, page);
  res.json({ success: true, data, meta: { source: 'tmdb', cached: false, timestamp: Date.now() } });
}));

/**
 * @openapi
 * /api/dex/recommend/{subjectId}:
 *   get:
 *     tags: [Content]
 *     summary: Recommandations « Pour vous » pour un titre
 *     parameters:
 *       - in: path
 *         name: subjectId
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
 *         description: Recommended items
 */
router.get('/recommend/:subjectId', cacheMiddleware('home'), wrapAsync(async (req, res) => {
  const subjectId = req.params.subjectId as string;
  checkLen(subjectId, 'subjectId');
  const page = parseInt(req.query.page as string) || 1;
  if (!subjectId) throw new AppError(400, 'MISSING_ID', 'subjectId is required');
  const { data, source } = await scraper.recommendations(subjectId, page);
  res.json({
    success: true,
    data: { items: data.items, page, hasMore: data.hasMore },
    meta: { source, cached: false, timestamp: Date.now() },
  });
}));

/**
 * @openapi
 * /api/dex/episodes/{subjectId}:
 *   get:
 *     tags: [Content]
 *     summary: Épisodes d'une saison (titres/synopsis/vignettes via TMDB)
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
 *     responses:
 *       200:
 *         description: Episode list (empty if the title cannot be matched on TMDB)
 */
// Métadonnées d'épisodes = stables dans le temps → cache long, contrairement
// aux URLs de flux. Jamais d'erreur : liste vide si TMDB ne connaît pas le titre.
router.get('/episodes/:subjectId', cacheMiddleware('detail'), wrapAsync(async (req, res) => {
  const subjectId = req.params.subjectId as string;
  checkLen(subjectId, 'subjectId');
  if (!subjectId) throw new AppError(400, 'MISSING_ID', 'subjectId is required');
  const season = parseInt((req.query.season ?? req.query.se) as string) || 1;
  const { data, source } = await scraper.episodes(subjectId, season);
  res.json({
    success: true,
    data,
    meta: { source, cached: false, timestamp: Date.now() },
  });
}));

/**
 * @openapi
 * /api/dex/download/{subjectId}:
 *   get:
 *     tags: [Stream]
 *     summary: Fichiers téléchargeables (MP4 par qualité + taille)
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
 *       - in: query
 *         name: episode
 *         schema:
 *           type: integer
 *       - in: query
 *         name: detailPath
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Downloadable files
 */
// Pas de cache : les URLs de téléchargement sont signées et expirent (comme /stream)
router.get('/download/:subjectId', wrapAsync(async (req, res) => {
  const subjectId = req.params.subjectId as string;
  checkLen(subjectId, 'subjectId');
  const season = parseInt((req.query.season ?? req.query.se) as string) || undefined;
  const episode = parseInt((req.query.episode ?? req.query.ep) as string) || undefined;
  const detailPath = (req.query.detailPath as string) || undefined;
  checkLen(detailPath, 'detailPath');
  if (!subjectId) throw new AppError(400, 'MISSING_ID', 'subjectId is required');
  const { data, source } = await scraper.downloads(subjectId, season, episode, detailPath);
  res.json({
    success: true,
    data,
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
  checkLen(subjectId, 'subjectId');
  // Alias se/ep acceptés pour compatibilité avec les anciens clients
  const season = parseInt((req.query.season ?? req.query.se) as string) || 1;
  const episode = parseInt((req.query.episode ?? req.query.ep) as string) || 1;
  const detailPath = (req.query.detailPath as string) || undefined;
  checkLen(detailPath, 'detailPath');
  if (!subjectId) throw new AppError(400, 'MISSING_ID', 'subjectId is required');
  const { data, source } = await scraper.stream(subjectId, season, episode, detailPath);
  res.json({
    success: true,
    data,
    meta: { source, cached: false, timestamp: Date.now() },
  });
}));

export default router;
