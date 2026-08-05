import { canAttempt, recordSuccess, recordFailure } from '../utils/resilience';
import { recordProviderResult } from '../middleware/metrics';
import { logger } from '../middleware/logger';

/**
 * Orchestrateur des sources de CATALOGUE (recherche, listes).
 *
 * Différence essentielle avec l'orchestrateur de flux : ici les sources sont
 * **complémentaires**, pas alternatives. Pour un flux on veut LE premier qui
 * marche ; pour une recherche on veut TOUT ce que chacun sait, fusionné. Donc :
 *  - exécution **en parallèle** (avant, MovieBox puis TMDB en séquentiel :
 *    la latence des deux s'additionnait sur la route déjà la plus lente) ;
 *  - une source en panne n'empêche pas les autres de répondre — la recherche
 *    se dégrade au lieu de tomber ;
 *  - ordre de fusion par priorité, dédoublonnage par `subjectId`.
 */

export interface CatalogItem {
  subjectId: string;
  [k: string]: any;
}

export interface CatalogProvider {
  name: string;
  /** Petit = ses résultats apparaissent en tête après fusion. */
  priority: number;
  /** `false` = source non applicable à cette requête (ex: TMDB hors page 1). */
  supports(query: string, page: number): boolean;
  search(query: string, page: number): Promise<CatalogItem[]>;
}

export interface CatalogSearchResult {
  items: CatalogItem[];
  /** Sources réellement interrogées et ce qu'elles ont rendu — sert au diagnostic. */
  contributions: Record<string, number>;
  /** Sources indisponibles au moment de l'appel (disjoncteur ouvert ou erreur). */
  degraded: string[];
}

/**
 * Interroge toutes les sources applicables en parallèle, sous disjoncteur et
 * budget de temps, puis fusionne. Une source lente ne bloque jamais les autres :
 * elle est simplement absente du résultat.
 */
export async function searchCatalog(
  query: string,
  page: number,
  providers: CatalogProvider[],
  budgetMs = 12_000
): Promise<CatalogSearchResult> {
  const applicable = providers
    .filter((p) => p.supports(query, page))
    .sort((a, b) => a.priority - b.priority);

  const degraded: string[] = [];
  const contributions: Record<string, number> = {};

  const runs = applicable.map(async (p) => {
    const breakerKey = `catalog:${p.name}`;
    if (!canAttempt(breakerKey)) {
      recordProviderResult(p.name, 'skipped', 0);
      degraded.push(p.name);
      return { provider: p, items: [] as CatalogItem[] };
    }

    const started = Date.now();
    try {
      // Chaque source a le même budget : au-delà on l'abandonne plutôt que de
      // faire attendre l'utilisateur pour une source qui traîne.
      const items = await withTimeout(p.search(query, page), budgetMs, p.name);
      const ms = Date.now() - started;
      recordSuccess(breakerKey);
      recordProviderResult(p.name, items.length ? 'hit' : 'empty', ms);
      contributions[p.name] = items.length;
      return { provider: p, items };
    } catch (e: any) {
      const ms = Date.now() - started;
      recordFailure(breakerKey);
      recordProviderResult(p.name, 'error', ms);
      degraded.push(p.name);
      logger.warn(`Catalogue ${p.name} en échec (${ms}ms) : ${e?.message || e}`);
      return { provider: p, items: [] as CatalogItem[] };
    }
  });

  const results = await Promise.all(runs);

  // Fusion : ordre de priorité, dédoublonnage par subjectId. Le premier
  // provider à fournir un id gagne — c'est pour ça que MovieBox (badges VF
  // fiables) passe avant TMDB (métadonnées seules).
  const merged: CatalogItem[] = [];
  const seen = new Set<string>();
  for (const { provider, items } of results.sort((a, b) => a.provider.priority - b.provider.priority)) {
    for (const item of items) {
      if (!item?.subjectId || seen.has(item.subjectId)) continue;
      seen.add(item.subjectId);
      merged.push({ ...item, source: item.source || provider.name });
    }
  }

  if (degraded.length) {
    logger.warn(`Recherche "${query}" servie en mode dégradé — sources absentes : ${degraded.join(', ')}`);
  }
  return { items: merged, contributions, degraded };
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} : délai dépassé (${ms}ms)`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}
