import express, { Express } from 'express';
import cors from 'cors';
import compression from 'compression';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger';
import { errorHandler } from './middleware/errorHandler';
import { metricsMiddleware, metricsHandler, metricsSnapshot } from './middleware/metrics';
import { apiRateLimiter } from './middleware/rateLimit';
import { cacheStats } from './middleware/cache';
import { persistentPing } from './middleware/persistentCache';
import { breakerSnapshot } from './utils/resilience';
import { geoContextMiddleware } from './middleware/geoContext';
import { GEO_PROFILES } from './config/geo';
import dexRouter from './routes/dex';
import proxyRouter from './routes/proxy';

/**
 * Fabrique UNIQUE de l'application Express.
 *
 * ⚠️ Pourquoi ce fichier existe : il y avait DEUX bootstraps divergents —
 * `src/index.ts` (dev local) et `api/index.ts` (fonction Vercel, donc la
 * production). Tout ce qu'on ajoutait dans l'un ne partait jamais dans l'autre :
 * au moment de l'extraction, la PROD n'avait ni les routes `/api/proxy`, ni le
 * health check enrichi, et le dev n'avait pas `trust proxy`. Un middleware
 * ajouté au mauvais endroit était silencieusement absent en ligne.
 *
 * Désormais les deux entrées appellent `createApp()`. Toute nouvelle route ou
 * middleware s'ajoute ICI, une seule fois.
 */
export function createApp(options: { trustProxy?: boolean } = {}): Express {
  const app = express();

  if (options.trustProxy) {
    // Derrière le proxy Vercel : sans ça, express-rate-limit et req.ip voient
    // l'IP du proxy au lieu du vrai client.
    app.set('trust proxy', 1);
  }

  app.use(compression());
  app.use(cors({ origin: '*' }));
  app.use(express.json());
  app.use(metricsMiddleware);
  app.use(apiRateLimiter);
  // Doit venir AVANT toute route : le cache et les scrapers lisent le profil
  // géographique depuis le contexte de la requête.
  app.use(geoContextMiddleware);

  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Dex Movies API Docs',
  }));

  /**
   * Health check qui TESTE ses dépendances au lieu de répondre « ok » à
   * l'aveugle. `degraded` = l'API répond mais une dépendance non vitale est
   * tombée (cache L2 injoignable, upstream écarté par un disjoncteur) — on veut
   * le voir avant les utilisateurs.
   */
  app.get('/health', async (_req, res) => {
    const redis = await persistentPing();
    const breakers = breakerSnapshot();

    const degraded =
      (redis.enabled && !redis.reachable) ||
      Object.values(breakers).some((b) => b.state === 'open');

    res.json({
      status: degraded ? 'degraded' : 'ok',
      uptime: process.uptime(),
      timestamp: Date.now(),
      memory: process.memoryUsage(),
      dependencies: {
        cacheL2: redis,
        openCircuits: breakers,
      },
      cache: cacheStats(),
      geo: {
        profiles: Object.values(GEO_PROFILES).map((p) => ({
          code: p.code, label: p.label, ips: p.ips.length, languages: p.languages,
        })),
      },
      metrics: metricsSnapshot(),
    });
  });

  app.get('/metrics', metricsHandler);

  app.get('/', (_req, res) => {
    res.json({
      name: 'Dex Movies API',
      version: '1.0.0',
      docs: '/api-docs',
      endpoints: {
        home: 'GET /api/dex/home',
        category: 'GET /api/dex/category/:tabId?page=1',
        search: 'GET /api/dex/search?q=&page=1',
        suggest: 'GET /api/dex/suggest?q=',
        detail: 'GET /api/dex/detail/:subjectId',
        stream: 'GET /api/dex/stream/:subjectId?season=1&episode=1',
        episodes: 'GET /api/dex/episodes/:subjectId?season=1',
        vf: 'GET /api/dex/vf/list?category=&page=1',
        'proxy.stream': 'GET /api/proxy/stream?url=',
        'proxy.captions': 'GET /api/proxy/captions?url=',
      },
    });
  });

  app.use('/api/dex', dexRouter);
  app.use('/api/proxy', proxyRouter);

  // Route inconnue → 404 JSON propre (jamais du HTML brut Express)
  app.use((_req, res) => {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Route inexistante' },
      meta: { timestamp: Date.now() },
    });
  });

  app.use(errorHandler);

  return app;
}
