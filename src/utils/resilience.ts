import { logger } from '../middleware/logger';
import { recordBreakerState } from '../middleware/metrics';

/**
 * Résilience réseau : disjoncteur (circuit breaker) + retry avec backoff.
 *
 * Pourquoi c'est nécessaire ici : tous nos upstreams sont des sites tiers
 * instables par nature (domaines en rotation, Cloudflare, hôtes qui passent en
 * 404 du jour au lendemain — `api3.aoneroom.com` en est l'exemple vécu).
 * Sans disjoncteur, chaque requête utilisateur repayait le timeout complet d'un
 * hôte mort : sur une route qui essaie 5 hôtes à 12 s, c'est une minute perdue
 * et un risque de dépassement du `maxDuration` Vercel (30 s).
 *
 * Le disjoncteur mémorise les échecs PAR HÔTE :
 *  - CLOSED  : tout passe ;
 *  - OPEN    : après `failureThreshold` échecs consécutifs, on refuse
 *              immédiatement pendant `openMs` (échec instantané, pas de timeout) ;
 *  - HALF_OPEN : après ce délai, une seule requête test est laissée passer.
 *                Succès → refermé ; échec → ré-ouvert.
 *
 * L'état vit en mémoire du process. Sur serverless chaque instance a le sien :
 * c'est assumé — il protège la latence d'une instance donnée, pas la flotte.
 * Un état partagé via Redis serait plus fort mais ajouterait un aller-retour
 * réseau sur le chemin critique de chaque appel.
 */

export type BreakerState = 'closed' | 'open' | 'halfOpen';

interface BreakerOptions {
  /** Échecs consécutifs avant ouverture. */
  failureThreshold: number;
  /** Durée d'ouverture avant de retenter une requête test (ms). */
  openMs: number;
}

const DEFAULTS: BreakerOptions = { failureThreshold: 3, openMs: 60_000 };

interface BreakerEntry {
  failures: number;
  state: BreakerState;
  openedAt: number;
}

const breakers = new Map<string, BreakerEntry>();

function entryFor(key: string): BreakerEntry {
  let e = breakers.get(key);
  if (!e) {
    e = { failures: 0, state: 'closed', openedAt: 0 };
    breakers.set(key, e);
  }
  return e;
}

/** Le circuit autorise-t-il un appel vers cette cible ? */
export function canAttempt(key: string, opts: Partial<BreakerOptions> = {}): boolean {
  const o = { ...DEFAULTS, ...opts };
  const e = entryFor(key);
  if (e.state === 'open') {
    if (Date.now() - e.openedAt >= o.openMs) {
      e.state = 'halfOpen';
      recordBreakerState(key, 'halfOpen');
      logger.info(`Disjoncteur ${key} : half-open (requête test autorisée)`);
      return true;
    }
    return false;
  }
  return true;
}

export function recordSuccess(key: string): void {
  const e = entryFor(key);
  if (e.state !== 'closed') {
    logger.info(`Disjoncteur ${key} : refermé`);
    recordBreakerState(key, 'closed');
  }
  e.failures = 0;
  e.state = 'closed';
}

export function recordFailure(key: string, opts: Partial<BreakerOptions> = {}): void {
  const o = { ...DEFAULTS, ...opts };
  const e = entryFor(key);
  e.failures += 1;
  if (e.state === 'halfOpen' || e.failures >= o.failureThreshold) {
    if (e.state !== 'open') {
      logger.warn(`Disjoncteur ${key} : OUVERT après ${e.failures} échec(s) — écarté ${o.openMs / 1000}s`);
      recordBreakerState(key, 'open');
    }
    e.state = 'open';
    e.openedAt = Date.now();
  }
}

/** Instantané de tous les disjoncteurs (exposé par /health et /metrics). */
export function breakerSnapshot(): Record<string, { state: BreakerState; failures: number }> {
  const out: Record<string, { state: BreakerState; failures: number }> = {};
  for (const [k, v] of breakers.entries()) {
    // On ne remonte que ce qui est anormal : un `closed` à 0 échec est du bruit.
    if (v.state !== 'closed' || v.failures > 0) out[k] = { state: v.state, failures: v.failures };
  }
  return out;
}

/** Remet tout à zéro — réservé aux tests. */
export function resetBreakers(): void {
  breakers.clear();
}

export class CircuitOpenError extends Error {
  constructor(key: string) {
    super(`Circuit ouvert pour ${key}`);
    this.name = 'CircuitOpenError';
  }
}

interface RunOptions extends Partial<BreakerOptions> {
  /** Nombre total de tentatives (1 = pas de retry). */
  attempts?: number;
  /** Délai avant la 1re nouvelle tentative (ms), doublé ensuite. */
  backoffMs?: number;
  /**
   * Certaines erreurs ne valent pas un retry ni un point de disjoncteur :
   * un 404 « ce titre n'existe pas » est une réponse, pas une panne d'hôte.
   */
  isExpectedFailure?: (error: unknown) => boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Exécute `fn` sous protection du disjoncteur `key`, avec retry exponentiel.
 * Lève `CircuitOpenError` immédiatement si le circuit est ouvert : l'appelant
 * doit alors passer à la cible suivante (hôte miroir, provider suivant…).
 */
export async function runResilient<T>(
  key: string,
  fn: () => Promise<T>,
  options: RunOptions = {}
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 2);
  const backoffMs = options.backoffMs ?? 300;

  if (!canAttempt(key, options)) throw new CircuitOpenError(key);

  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const result = await fn();
      recordSuccess(key);
      return result;
    } catch (e) {
      lastError = e;
      // Échec « attendu » : on remonte tel quel sans pénaliser l'hôte.
      if (options.isExpectedFailure?.(e)) throw e;
      if (i < attempts - 1) await sleep(backoffMs * 2 ** i);
    }
  }
  recordFailure(key, options);
  throw lastError;
}

/** Clé de disjoncteur lisible à partir d'une URL (hôte seul). */
export function hostKey(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
