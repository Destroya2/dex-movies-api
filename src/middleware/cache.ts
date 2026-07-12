import NodeCache from 'node-cache';
import { Request, Response, NextFunction } from 'express';
import { ENV } from '../config/env';

const caches: Record<string, NodeCache> = {
  home: new NodeCache({ stdTTL: ENV.CACHE_HOME_TTL }),
  detail: new NodeCache({ stdTTL: ENV.CACHE_DETAIL_TTL }),
  search: new NodeCache({ stdTTL: ENV.CACHE_SEARCH_TTL }),
  stream: new NodeCache({ stdTTL: ENV.CACHE_STREAM_TTL }),
};

function cacheMiddleware(cacheName: keyof typeof caches) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.originalUrl;
    const cached = caches[cacheName].get(key);

    if (cached) {
      res.json({
        success: true,
        data: cached,
        meta: { source: 'cache', cached: true, timestamp: Date.now() },
      });
      return;
    }

    const originalJson = res.json.bind(res);
    res.json = (body: any) => {
      if (body?.success && body?.data) {
        caches[cacheName].set(key, body.data);
      }
      return originalJson(body);
    };

    next();
  };
}

export { caches, cacheMiddleware };
