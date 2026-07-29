import { Scraper, HomeResult, SearchResult, SuggestResult, DetailResult, StreamResult, RecommendResult, DownloadResult } from './base';
import { MovieBoxMobileScraper } from './moviebox/index';
import { MovieBoxH5Scraper } from './fallback/h5api';
import { FlixHQScraper } from './flixhq';
import { VidLinkScraper } from './vidlink';
import { tmdbDetail, TmdbMediaType } from '../utils/tmdbCatalog';
import { bestMatch } from '../utils/titleMatch';
import { fallbackStream } from '../utils/streamFallback';
import { logger } from '../middleware/logger';

type ScraperMethod = 'home' | 'search' | 'suggest' | 'detail' | 'stream' | 'category';

/** Un id de catalogue TMDB, ex: "tmdb:movie:12345". */
interface ResolvedTmdb {
  subjectId: string;      // subjectId MovieBox réel
  detailPath?: string;    // slug MovieBox
}

// Un scraper peut répondre 200 avec des données vides (échec silencieux upstream).
// Dans ce cas on tente le scraper suivant au lieu de retourner du vide.
function isEmptyResult(method: ScraperMethod, data: any): boolean {
  switch (method) {
    case 'home': return !data?.sections?.length;
    case 'search': return !data?.items?.length;
    case 'suggest': return !Array.isArray(data) || data.length === 0;
    case 'detail': return !data?.title;
    case 'stream': return !data?.sources?.length;
    case 'category': return !data?.items?.length;
  }
}

export class ScraperEngine {
  private scrapers: Scraper[] = [];

  constructor() {
    // H5 en premier : le scraper HMAC (api3.aoneroom.com) est bloqué depuis les IP Vercel
    this.register(new MovieBoxH5Scraper());
    // VidLink : fournit des streams quand on a un TMDB ID
    this.register(new VidLinkScraper());
    // FlixHQ (Consumet) : découverte de contenu. Bloqué par Cloudflare depuis Vercel
    // mais fonctionne en local / IP résidentielle
    this.register(new FlixHQScraper());
    this.register(new MovieBoxMobileScraper());
  }

  register(scraper: Scraper): void {
    this.scrapers.push(scraper);
    this.scrapers.sort((a, b) => a.config.priority - b.config.priority);
  }

  private async execute<T>(
    method: ScraperMethod,
    fn: (scraper: Scraper) => Promise<T>,
    context: string
  ): Promise<{ data: T; source: string }> {
    const errors: { name: string; error: any }[] = [];
    let emptyResult: { data: T; source: string } | null = null;

    for (const scraper of this.scrapers) {
      try {
        const data = await fn(scraper);
        if (isEmptyResult(method, data)) {
          if (!emptyResult) emptyResult = { data, source: scraper.config.name };
          continue;
        }
        return { data, source: scraper.config.name };
      } catch (error: any) {
        errors.push({ name: scraper.config.name, error });
      }
    }

    // Tous vides mais aucun n'a levé d'erreur : résultat légitimement vide
    // (ex: recherche sans résultat, épisode sans stream)
    if (emptyResult) return emptyResult;

    throw new Error(
      `All scrapers failed for ${context}: ${errors.map(e => `${e.name}=${e.error?.message || String(e.error)}`).join(', ')}`
    );
  }

  // ─── Pont catalogue TMDB → sujet MovieBox ──────────────────────────────────
  // Cache des résolutions (tmdb:type:id → subjectId MovieBox) pour éviter de
  // re-chercher à chaque appel (stream/detail/download du même titre).
  private tmdbBridgeCache = new Map<string, ResolvedTmdb | null>();

  private isTmdbId(subjectId: string): boolean {
    return subjectId.startsWith('tmdb:');
  }

  /**
   * Résout un id catalogue `tmdb:type:id` vers un vrai sujet MovieBox :
   * TMDB detail (titre+année) → recherche MovieBox → matching de titre.
   * Retourne null si aucun sujet MovieBox ne correspond (→ contenu non VF/dispo).
   */
  private async resolveTmdb(subjectId: string): Promise<ResolvedTmdb | null> {
    if (this.tmdbBridgeCache.has(subjectId)) return this.tmdbBridgeCache.get(subjectId)!;

    const [, type, idStr] = subjectId.split(':');
    const id = parseInt(idStr);
    let resolved: ResolvedTmdb | null = null;
    try {
      const detail = await tmdbDetail((type as TmdbMediaType) || 'movie', id);
      if (detail?.title) {
        // Cherche MovieBox avec le titre FR ET le titre original (anglais souvent) :
        // MovieBox indexe selon l'un ou l'autre. On agrège les candidats et on
        // matche contre les deux titres pour maximiser la couverture.
        const queries = [detail.title];
        if (detail.originalTitle && detail.originalTitle !== detail.title) {
          queries.push(detail.originalTitle);
        }
        const candidates: any[] = [];
        const seen = new Set<string>();
        for (const q of queries) {
          try {
            const { data } = await this.search(q, 1);
            for (const it of data.items || []) {
              if (!seen.has(it.subjectId)) { seen.add(it.subjectId); candidates.push(it); }
            }
          } catch {}
        }
        // Meilleur match sur le titre FR, puis sur le titre original
        const match = bestMatch(detail.title, detail.year, candidates)
          || (detail.originalTitle ? bestMatch(detail.originalTitle, detail.year, candidates) : null);
        if (match) {
          resolved = { subjectId: match.item.subjectId, detailPath: match.item.detailPath };
          logger.info(`Bridge TMDB ${subjectId} ("${detail.title}") → MovieBox ${match.item.subjectId} (score ${match.score.toFixed(2)})`);
        } else {
          logger.warn(`Bridge TMDB ${subjectId} ("${detail.title}"/"${detail.originalTitle || ''}") : aucun match MovieBox (${candidates.length} candidats)`);
        }
      }
    } catch (e: any) {
      logger.warn(`Bridge TMDB ${subjectId} échec: ${e?.message || e}`);
    }
    this.tmdbBridgeCache.set(subjectId, resolved);
    if (this.tmdbBridgeCache.size > 500) this.tmdbBridgeCache.clear();
    return resolved;
  }

  async home(): Promise<{ data: HomeResult; source: string }> {
    return this.execute('home', (s) => s.home(), 'home');
  }

  async search(query: string, page: number = 1): Promise<{ data: SearchResult; source: string }> {
    return this.execute('search', (s) => s.search(query, page), `search(${query})`);
  }

  async suggest(query: string): Promise<{ data: SuggestResult[]; source: string }> {
    return this.execute('suggest', (s) => s.suggest(query), `suggest(${query})`);
  }

  async detail(subjectId: string): Promise<{ data: DetailResult; source: string }> {
    // Les fiches TMDB sont déjà servies par /catalog/detail ; ici on ne traite
    // que les subjectId MovieBox natifs. Un id tmdb: est résolu par sécurité.
    if (this.isTmdbId(subjectId)) {
      const r = await this.resolveTmdb(subjectId);
      if (!r) throw new Error(`Aucun flux MovieBox pour ${subjectId}`);
      return this.execute('detail', (s) => s.detail(r.subjectId), `detail(${r.subjectId})`);
    }
    return this.execute('detail', (s) => s.detail(subjectId), `detail(${subjectId})`);
  }

  async stream(subjectId: string, season?: number, episode?: number, detailPath?: string): Promise<{ data: StreamResult; source: string }> {
    if (this.isTmdbId(subjectId)) {
      const [, tType, tId] = subjectId.split(':');
      // 1) MovieBox via le pont (VF prioritaire)
      const r = await this.resolveTmdb(subjectId);
      if (r) {
        try {
          const mb = await this.execute('stream', (s) => s.stream(r.subjectId, season, episode, r.detailPath), `stream(${r.subjectId})`);
          if (mb.data.sources.length > 0) return mb;
        } catch {}
      }
      // 2) Fallback (resolver Pi / vixsrc) par TMDB id quand MovieBox n'a pas le
      //    titre. On récupère titre+année (utiles à coflix côté Pi).
      let fbTitle: string | undefined, fbYear: string | undefined;
      try {
        const det = await tmdbDetail((tType as TmdbMediaType) || 'movie', parseInt(tId));
        fbTitle = det?.title; fbYear = det?.year;
      } catch {}
      const fb = await fallbackStream(tId, (tType as 'movie' | 'tv') || 'movie', season, episode, fbTitle, fbYear);
      if (fb.sources.length > 0) {
        return {
          data: { sources: fb.sources, dubs: [], subtitles: fb.subtitles, hasResource: true, freeEpisodes: 0 },
          source: 'fallback',
        };
      }
      return { data: { sources: [], dubs: [], subtitles: [], hasResource: false, freeEpisodes: 0 }, source: 'none' };
    }
    return this.execute('stream', (s) => s.stream(subjectId, season, episode, detailPath), `stream(${subjectId})`);
  }

  async category(tabId: string, page: number = 1): Promise<{ data: { items: any[]; page: number; hasMore: boolean }; source: string }> {
    return this.execute('category', (s) => s.category(tabId, page), `category(${tabId})`);
  }

  /** Recommandations « Pour vous » — premier scraper qui implémente la méthode. */
  async recommendations(subjectId: string, page: number = 1): Promise<{ data: RecommendResult; source: string }> {
    if (this.isTmdbId(subjectId)) {
      const r = await this.resolveTmdb(subjectId);
      if (!r) return { data: { items: [], page, hasMore: false }, source: 'none' };
      subjectId = r.subjectId;
    }
    for (const scraper of this.scrapers) {
      if (!scraper.recommendations) continue;
      try {
        const data = await scraper.recommendations(subjectId, page);
        if (data.items.length > 0) return { data, source: scraper.config.name };
      } catch {}
    }
    return { data: { items: [], page, hasMore: false }, source: 'none' };
  }

  /** Fichiers téléchargeables — premier scraper qui implémente la méthode. */
  async downloads(subjectId: string, season?: number, episode?: number, detailPath?: string): Promise<{ data: DownloadResult; source: string }> {
    if (this.isTmdbId(subjectId)) {
      const r = await this.resolveTmdb(subjectId);
      if (!r) return { data: { files: [], captions: [], hasResource: false }, source: 'none' };
      subjectId = r.subjectId;
      detailPath = r.detailPath;
    }
    const errors: string[] = [];
    for (const scraper of this.scrapers) {
      if (!scraper.downloads) continue;
      try {
        const data = await scraper.downloads(subjectId, season, episode, detailPath);
        if (data.files.length > 0) return { data, source: scraper.config.name };
      } catch (e: any) {
        errors.push(`${scraper.config.name}=${e?.message || e}`);
      }
    }
    // Aucun fichier : réponse vide légitime (contenu en direct uniquement)
    return { data: { files: [], captions: [], hasResource: false }, source: 'none' };
  }
}
