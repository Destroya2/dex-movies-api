import NodeCache from 'node-cache';
import { logger } from './logger';

const UPSTASH_URL = process.env.UPSTASH_REDIS_URL || '';
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_TOKEN || '';

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

export async function persistentGet<T>(key: string): Promise<T | undefined> {
  if (redis) {
    try {
      const val = await redis.get(key);
      if (val != null) return val as T;
    } catch { /* fallback */ }
  }
  return memFallback.get<T>(key);
}

export async function persistentSet<T>(key: string, val: T, ttlSec = 1800): Promise<void> {
  if (redis) {
    try {
      await redis.set(key, val, { ex: ttlSec });
      return;
    } catch { /* fallback */ }
  }
  memFallback.set(key, val, ttlSec);
}

export async function persistentDel(key: string): Promise<void> {
  if (redis) {
    try { await redis.del(key); } catch { /* ignore */ }
  }
  memFallback.del(key);
}

export async function persistentKeys(pattern: string): Promise<string[]> {
  if (redis) {
    try { return await redis.keys(pattern); } catch { /* fallback */ }
  }
  return memFallback.keys().filter(k => k.startsWith(pattern.replace('*', '')));
}
