import NodeCache from 'node-cache';
import { Request, Response, NextFunction } from 'express';
import { ENV } from '../config/env';
import { persistentGet, persistentSet, isPersistentCacheEnabled } from './persistentCache';
import { recordCacheEvent } from './metrics';
import { logger } from './logger';
import { geoCacheSuffix } from './geoContext';

/**
 * Cache de réponses à DEUX NIVEAUX.
 *
 * L1 = mémoire du process (NodeCache) : latence nulle, mais sur Vercel chaque
 * instance a la sienne et elles sont éphémères et nombreuses — à l'échelle le
 * taux de hit s'effondre et presque chaque requête repart vers l'upstream.
 * L2 = Redis partagé (Upstash) : survit aux cold starts et se partage entre
 * toutes les instances. C'est lui qui protège réellement l'IP de géo-spoof
 * unique contre le rate-limit upstream.
 *
 * Lecture : L1 → L2 → upstream. Un hit L2 réchauffe L1 pour les requêtes
 * suivantes de la même instance. Écriture : L1 immédiat, L2 en tâche de fond
 * (jamais dans le chemin critique de la réponse).
 * Redis absent ou en panne → tout continue en L1 seul, état visible dans /health.
 */

// maxKeys borne la mémoire du process : sans ça, des clés générées à volonté
// (query strings arbitraires) peuvent faire grossir le cache jusqu'à l'OOM.
const caches: Record<string, NodeCache> = {
  home: new NodeCache({ stdTTL: ENV.CACHE_HOME_TTL, maxKeys: 2000 }),
  detail: new NodeCache({ stdTTL: ENV.CACHE_DETAIL_TTL, maxKeys: 2000 }),
  search: new NodeCache({ stdTTL: ENV.CACHE_SEARCH_TTL, maxKeys: 2000 }),
  stream: new NodeCache({ stdTTL: ENV.CACHE_STREAM_TTL, maxKeys: 2000 }),
};

const TTL: Record<string, number> = {
  home: ENV.CACHE_HOME_TTL,
  detail: ENV.CACHE_DETAIL_TTL,
  search: ENV.CACHE_SEARCH_TTL,
  stream: ENV.CACHE_STREAM_TTL,
};

export type CacheName = keyof typeof caches;

/**
 * Une réponse "vide" ne doit JAMAIS être mise en cache : elle correspond presque
 * toujours à un échec silencieux upstream, pas à un état durable. La retirer
 * ferait apparaître des écrans vides persistants pendant tout le TTL.
 */
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

/**
 * Clé de cache. Trois composantes, toutes nécessaires :
 *  - la **famille** : le L2 est partagé entre toutes les instances ET toutes les
 *    routes, une collision servirait la réponse d'une autre route ;
 *  - le **profil géographique** : MovieBox sert un catalogue DIFFÉRENT selon le
 *    pays de l'IP. Sans cette composante, le premier appel d'un utilisateur
 *    anglophone empoisonnerait le cache et les francophones recevraient un
 *    catalogue sans aucune VF (et réciproquement) ;
 *  - l'**URL** sans `nocache`, pour qu'un refresh forcé réécrive la MÊME entrée.
 */
function buildKey(cacheName: string, req: Request): string {
  const url = req.originalUrl.replace(/[?&]nocache=[^&]*/g, '');
  return `resp:${cacheName}:${geoCacheSuffix()}:${url}`;
}

function cacheMiddleware(cacheName: CacheName) {
  const l1 = caches[cacheName];
  const ttl = TTL[cacheName];

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = buildKey(cacheName, req);
    const bypass = req.query.nocache !== undefined;

    const serve = (data: any, layer: 'L1' | 'L2') => {
      recordCacheEvent(cacheName, layer === 'L1' ? 'hitL1' : 'hitL2');
      res.json({
        success: true,
        data,
        meta: { source: 'cache', cached: true, cacheLayer: layer, timestamp: Date.now() },
      });
    };

    // Intercepte la réponse pour la stocker dans les deux niveaux.
    const captureThenContinue = () => {
      const originalJson = res.json.bind(res);
      res.json = (body: any) => {
        const usable = body?.success && body?.data !== undefined && !isEmptyPayload(body.data);

        if (usable) {
          // maxKeys fait lever ECACHEFULL une fois plein : un cache plein revient
          // à un cache absent, ça ne doit jamais casser la réponse HTTP.
          try {
            l1.set(key, body.data, ttl);
          } catch { /* L1 plein */ }
          // L2 + copie de secours, en tâche de fond : jamais dans le chemin
          // critique de la réponse.
          void persistentSet(key, body.data, ttl).catch(() => {});
          void persistentSet(`stale:${key}`, body.data, STALE_TTL_SEC).catch(() => {});
          return originalJson(body);
        }

        // ── Réponse inutilisable : on tente la copie de secours ──────────────
        // C'est le filet contre une panne d'upstream (le Raspberry Pi est resté
        // injoignable 2 jours en août 2026 : l'onglet VF se vidait purement et
        // simplement). Servir un catalogue de quelques heures vaut infiniment
        // mieux qu'un écran vide, à condition de le DIRE (`meta.stale`).
        persistentGet<any>(`stale:${key}`)
          .then((fallback) => {
            if (fallback && !isEmptyPayload(fallback)) {
              recordCacheEvent(cacheName, 'stale');
              logger.warn(`Réponse dégradée servie depuis le cache de secours : ${key}`);
              originalJson({
                success: true,
                data: fallback,
                meta: {
                  source: 'cache-stale',
                  cached: true,
                  stale: true,
                  timestamp: Date.now(),
                },
              });
              return;
            }
            originalJson(body);
          })
          .catch(() => originalJson(body));
        return res;
      };
      next();
    };

    if (bypass) {
      captureThenContinue();
      return;
    }

    const hitL1 = l1.get(key);
    if (hitL1 !== undefined) {
      serve(hitL1, 'L1');
      return;
    }

    // L2 : jamais bloquant — en cas de panne Redis on part vers l'upstream
    // plutôt que de faire échouer la requête.
    persistentGet<any>(key)
      .then((hitL2) => {
        if (hitL2 !== undefined && hitL2 !== null && !isEmptyPayload(hitL2)) {
          try {
            l1.set(key, hitL2, ttl); // réchauffe L1 pour cette instance
          } catch { /* L1 plein */ }
          serve(hitL2, 'L2');
          return;
        }
        recordCacheEvent(cacheName, 'miss');
        captureThenContinue();
      })
      .catch((e) => {
        logger.warn(`Cache L2 indisponible (${cacheName}) : ${e?.message || e}`);
        recordCacheEvent(cacheName, 'miss');
        captureThenContinue();
      });
  };
}

/**
 * Durée de conservation de la copie « de secours ». Bien plus longue que le TTL
 * normal : elle ne sert JAMAIS tant que l'upstream répond, uniquement quand il
 * tombe. Un catalogue vieux de quelques heures reste infiniment préférable à un
 * écran vide.
 */
const STALE_TTL_SEC = 24 * 3600;

/** État du cache pour /health et /metrics. */
export function cacheStats() {
  return {
    l2Enabled: isPersistentCacheEnabled(),
    layers: Object.fromEntries(
      Object.entries(caches).map(([name, c]) => [
        name,
        { keys: c.keys().length, hits: c.getStats().hits, misses: c.getStats().misses },
      ])
    ),
  };
}

export { caches, cacheMiddleware };
