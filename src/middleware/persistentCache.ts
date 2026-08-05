import NodeCache from 'node-cache';
import { logger } from './logger';

/**
 * Résolution des identifiants Redis, tolérante aux conventions de nommage.
 *
 * L'intégration Upstash du Marketplace Vercel provisionne `KV_REST_API_URL` /
 * `KV_REST_API_TOKEN`, alors que le code lisait `UPSTASH_REDIS_URL` /
 * `UPSTASH_REDIS_TOKEN` : la base était bien créée, mais le cache L2 restait
 * silencieusement désactivé (`/health` → `cacheL2: {enabled:false}`). On accepte
 * donc les trois conventions rencontrées.
 */
const UPSTASH_URL =
  process.env.KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.UPSTASH_REDIS_URL ||
  '';
const UPSTASH_TOKEN =
  process.env.KV_REST_API_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.UPSTASH_REDIS_TOKEN ||
  '';

let redis: any = null;

if (UPSTASH_URL && UPSTASH_TOKEN) {
  try {
    const { Redis } = require('@upstash/redis/cloudflare');
    redis = new Redis({ url: UPSTASH_URL, token: UPSTASH_TOKEN });
    logger.info('Upstash Redis connected for persistent cache');
  } catch {
    try {
      const { Redis } = require('@upstash/redis');
      redis = new Redis({ url: UPSTASH_URL, token: UPSTASH_TOKEN });
      logger.info('Upstash Redis (node) connected for persistent cache');
    } catch (e) {
      logger.warn('Redis unavailable, using in-memory fallback: ' + (e as Error).message);
      redis = null;
    }
  }
}

const memFallback = new NodeCache({ stdTTL: 1800 });

/**
 * Cloisonnement par environnement.
 *
 * Les déploiements de PRÉVISUALISATION Vercel partagent la même base Redis que
 * la PRODUCTION (mêmes variables `KV_REST_API_*`, portée « Production, Preview »).
 * Sans préfixe, une branche expérimentale écrit dans les clés de la prod : une
 * réponse erronée testée en preview serait servie aux vrais utilisateurs, et les
 * deux environnements s'évincent mutuellement du cache.
 *
 * `VERCEL_ENV` vaut `production`, `preview` ou `development`.
 */
const ENV_NAMESPACE = process.env.VERCEL_ENV || process.env.NODE_ENV || 'development';

function scoped(key: string): string {
  return `${ENV_NAMESPACE}:${key}`;
}

export async function persistentGet<T>(key: string): Promise<T | undefined> {
  const k = scoped(key);
  if (redis) {
    try {
      const val = await redis.get(k);
      if (val != null) return val as T;
    } catch { /* fallback */ }
  }
  return memFallback.get<T>(k);
}

export async function persistentSet<T>(key: string, val: T, ttlSec = 1800): Promise<void> {
  const k = scoped(key);
  if (redis) {
    try {
      await redis.set(k, val, { ex: ttlSec });
      return;
    } catch { /* fallback */ }
  }
  memFallback.set(k, val, ttlSec);
}

export async function persistentDel(key: string): Promise<void> {
  const k = scoped(key);
  if (redis) {
    try { await redis.del(k); } catch { /* ignore */ }
  }
  memFallback.del(k);
}

export async function persistentKeys(pattern: string): Promise<string[]> {
  const p = scoped(pattern);
  if (redis) {
    try { return await redis.keys(p); } catch { /* fallback */ }
  }
  return memFallback.keys().filter((k) => k.startsWith(p.replace('*', '')));
}

/** Redis est-il configuré (et le client instancié) ? Exposé par /health. */
export function isPersistentCacheEnabled(): boolean {
  return redis !== null;
}

/** Environnement dont ce process lit et écrit les clés (exposé par /health). */
export function cacheNamespace(): string {
  return ENV_NAMESPACE;
}

/**
 * Vérifie que le L2 répond RÉELLEMENT (pas juste qu'il est configuré) :
 * aller-retour set/get sur une clé jetable. Utilisé par /health — sans ça, une
 * panne Redis restait invisible jusqu'à ce que le taux de hit s'effondre.
 */
export async function persistentPing(): Promise<{ enabled: boolean; reachable: boolean; latencyMs?: number }> {
  if (!redis) return { enabled: false, reachable: false };
  const started = Date.now();
  try {
    const key = scoped('health:ping');
    await redis.set(key, started, { ex: 30 });
    const back = await redis.get(key);
    return { enabled: true, reachable: back != null, latencyMs: Date.now() - started };
  } catch {
    return { enabled: true, reachable: false, latencyMs: Date.now() - started };
  }
}
