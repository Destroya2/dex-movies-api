import express from 'express';
import cors from 'cors';
import compression from 'compression';
import swaggerUi from 'swagger-ui-express';
import { ENV } from './config/env';
import { logger } from './middleware/logger';
import { errorHandler } from './middleware/errorHandler';
import { swaggerSpec } from './config/swagger';
import { metricsMiddleware, metricsHandler, metricsSnapshot } from './middleware/metrics';
import { apiRateLimiter } from './middleware/rateLimit';
import { cacheStats } from './middleware/cache';
import { persistentPing } from './middleware/persistentCache';
import { breakerSnapshot } from './utils/resilience';
import dexRouter from './routes/dex';
import proxyRouter from './routes/proxy';

const app = express();

app.use(compression());
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(metricsMiddleware);
app.use(apiRateLimiter);

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Dex Movies API Docs',
}));

/**
 * Health check qui TESTE ses dépendances au lieu de répondre « ok » à l'aveugle.
 * `status` vaut `degraded` quand une dépendance non vitale est tombée (cache L2,
 * relais Pi) : l'API répond toujours, mais on veut le voir avant les utilisateurs.
 */
app.get('/health', async (_req, res) => {
  const [redis] = await Promise.all([persistentPing()]);
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
      // Un disjoncteur ouvert = un upstream écarté : c'est la panne partielle
      // qui était invisible jusqu'ici (metrics.ts remis à zéro à chaque cold start).
      openCircuits: breakers,
    },
    cache: cacheStats(),
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

if (!process.env.TEST_MODE) {
  app.listen(ENV.PORT, '0.0.0.0', () => {
    logger.info(`Dex Movies API running on http://0.0.0.0:${ENV.PORT}`);
  });
}

export default app;
