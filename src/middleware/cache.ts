import NodeCache from 'node-cache';
import { Request, Response, NextFunction } from 'express';
import { ENV } from '../config/env';

// maxKeys borne la mémoire du process : sans ça, des clés générées à volonté
// (query strings arbitraires, cf. absence de rate limit historique) peuvent
// faire grossir le cache indéfiniment jusqu'à l'OOM d'une instance Vercel.
const caches: Record<string, NodeCache> = {
  home: new NodeCache({ stdTTL: ENV.CACHE_HOME_TTL, maxKeys: 2000 }),
  detail: new NodeCache({ stdTTL: ENV.CACHE_DETAIL_TTL, maxKeys: 2000 }),
  search: new NodeCache({ stdTTL: ENV.CACHE_SEARCH_TTL, maxKeys: 2000 }),
  stream: new NodeCache({ stdTTL: ENV.CACHE_STREAM_TTL, maxKeys: 2000 }),
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
        // maxKeys fait lever ECACHEFULL une fois plein : ne doit jamais casser
        // la réponse HTTP, un cache plein revient juste à un cache absent.
        try {
          caches[cacheName].set(key, body.data);
        } catch {}
      }
      return originalJson(body);
    };

    next();
  };
}

export { caches, cacheMiddleware };
