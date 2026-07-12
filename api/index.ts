import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { ENV } from '../src/config/env';
import { errorHandler } from '../src/middleware/errorHandler';
import { metricsMiddleware, metricsHandler } from '../src/middleware/metrics';
import dexRouter from '../src/routes/dex';

const app = express();

app.use(compression());
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(metricsMiddleware);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: Date.now() });
});

app.get('/metrics', metricsHandler);

app.get('/', (_req, res) => {
  res.json({
    name: 'Dex Movies API',
    version: '1.0.0',
    endpoints: {
      home: 'GET /api/dex/home',
      category: 'GET /api/dex/category/:tabId?page=1',
      search: 'GET /api/dex/search?q=&page=1',
      suggest: 'GET /api/dex/suggest?q=',
      detail: 'GET /api/dex/detail/:subjectId',
      stream: 'GET /api/dex/stream/:subjectId?season=1&episode=1',
    },
  });
});

app.use('/api/dex', dexRouter);
app.use(errorHandler);

export default app;
