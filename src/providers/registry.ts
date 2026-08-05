import { StreamProvider, StreamRequest, StreamOutcome, isUsable } from './types';
import { canAttempt, recordSuccess, recordFailure } from '../utils/resilience';
import { recordProviderResult } from '../middleware/metrics';
import { logger } from '../middleware/logger';

/**
 * Orchestrateur des providers de flux.
 *
 * Règles, dans l'ordre :
 *  1. **Priorité** — la VF garantie (MovieBox) passe avant les sources VO.
 *  2. **Capacité** — un provider qui ne sait pas traiter la demande est sauté
 *     sans consommer de budget.
 *  3. **Disjoncteur** — un provider en panne est écarté immédiatement (voir
 *     utils/resilience) au lieu de coûter son timeout à chaque utilisateur.
 *  4. **Budget de temps** — on s'arrête net si l'échéance approche, pour rendre
 *     une réponse (même vide) plutôt que de tomber en 504 côté Vercel.
 *  5. **Premier utilisable gagne** — un résultat sans source ne vaut rien.
 *
 * Un provider qui renvoie « rien » n'est PAS une panne : c'est « je n'ai pas ce
 * titre ». Seule une exception ouvre son disjoncteur. Confondre les deux ferait
 * écarter à tort un provider sain qui a simplement un catalogue partiel.
 */

/** Marge conservée avant l'échéance : inutile de lancer un appel qui n'a pas le temps d'aboutir. */
const MIN_SLICE_MS = 1_500;

export interface ResolveResult {
  outcome: StreamOutcome;
  provider: string;
}

export async function resolveStream(
  req: StreamRequest,
  providers: StreamProvider[]
): Promise<ResolveResult | null> {
  const ordered = [...providers].sort((a, b) => a.priority - b.priority);
  const attempted: string[] = [];

  for (const provider of ordered) {
    const remaining = req.deadline - Date.now();
    if (remaining < MIN_SLICE_MS) {
      logger.warn(
        `Providers : budget épuisé (${remaining}ms restants) après [${attempted.join(', ')}] — arrêt`
      );
      break;
    }

    if (!provider.supports(req)) continue;

    const breakerKey = `provider:${provider.name}`;
    if (!canAttempt(breakerKey)) {
      logger.info(`Provider ${provider.name} écarté (disjoncteur ouvert)`);
      recordProviderResult(provider.name, 'skipped', 0);
      continue;
    }

    attempted.push(provider.name);
    const started = Date.now();
    try {
      const outcome = await provider.resolve(req);
      const ms = Date.now() - started;
      // Le provider a répondu : il est vivant, même s'il n'a pas le titre.
      recordSuccess(breakerKey);

      if (isUsable(outcome)) {
        recordProviderResult(provider.name, 'hit', ms);
        logger.info(`Flux résolu par ${provider.name} en ${ms}ms (${outcome.sources.length} source(s))`);
        return { outcome, provider: provider.name };
      }
      recordProviderResult(provider.name, 'empty', ms);
    } catch (e: any) {
      const ms = Date.now() - started;
      recordFailure(breakerKey);
      recordProviderResult(provider.name, 'error', ms);
      logger.warn(`Provider ${provider.name} en échec après ${ms}ms : ${e?.message || e}`);
    }
  }

  if (attempted.length) {
    logger.warn(`Aucun flux trouvé pour ${req.subjectId} — providers essayés : ${attempted.join(', ')}`);
  }
  return null;
}

/** Échéance par défaut, calée sous le `maxDuration` Vercel (30 s). */
export function defaultDeadline(budgetMs = 22_000): number {
  return Date.now() + budgetMs;
}
