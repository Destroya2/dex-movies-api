import NodeCache from 'node-cache';
import { Request, Response, NextFunction } from 'express';
import { ENV } from '../config/env';

const caches: Record<string, NodeCache> = {
  home: new NodeCache({ stdTTL: ENV.CACHE_HOME_TTL }),
  detail: new NodeCache({ stdTTL: ENV.CACHE_DETAIL_TTL }),
  search: new NodeCache({ stdTTL: ENV.CACHE_SEARCH_TTL }),
  stream: new NodeCache({ stdTTL: ENV.CACHE_STREAM_TTL }),
};

// Une réponse "vide" ne doit jamais être mise en cache : elle correspond
// presque toujours à un échec silencieux upstream, pas à un état durable.
function isEmptyPayload(data: any): boolean {
  if (data == null) return true;
  if (Array.isArray(data)) return data.length === 0;
  if (typeof data === 'object') {
    for (const key of ['sections', 'items', 'sources']) {
      if (Array.isArray(data[key])) return data[key].length === 0;
    }
  }
  return false;
}

function cacheMiddleware(cacheName: keyof typeof caches) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // La clé ignore nocache pour que le refresh forcé réécrive la même entrée
    const key = req.originalUrl.replace(/[?&]nocache=[^&]*/g, '');
    const bypass = req.query.nocache !== undefined;

    if (!bypass) {
      const cached = caches[cacheName].get(key);
      if (cached) {
        res.json({
          success: true,
          data: cached,
          meta: { source: 'cache', cached: true, timestamp: Date.now() },
        });
        return;
      }
    }

    const originalJson = res.json.bind(res);
    res.json = (body: any) => {
      if (body?.success && body?.data && !isEmptyPayload(body.data)) {
        caches[cacheName].set(key, body.data);
      }
      return originalJson(body);
    };

    next();
  };
}

export { caches, cacheMiddleware };
