import { Scraper, HomeResult, SearchResult, SuggestResult, DetailResult, StreamResult, RecommendResult, DownloadResult } from './base';
import { MovieBoxMobileScraper } from './moviebox/index';
import { MovieBoxH5Scraper } from './fallback/h5api';
import { FlixHQScraper } from './flixhq';
import { VidLinkScraper } from './vidlink';

type ScraperMethod = 'home' | 'search' | 'suggest' | 'detail' | 'stream' | 'category';

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
    return this.execute('detail', (s) => s.detail(subjectId), `detail(${subjectId})`);
  }

  async stream(subjectId: string, season?: number, episode?: number, detailPath?: string): Promise<{ data: StreamResult; source: string }> {
    return this.execute('stream', (s) => s.stream(subjectId, season, episode, detailPath), `stream(${subjectId})`);
  }

  async category(tabId: string, page: number = 1): Promise<{ data: { items: any[]; page: number; hasMore: boolean }; source: string }> {
    return this.execute('category', (s) => s.category(tabId, page), `category(${tabId})`);
  }

  /** Recommandations « Pour vous » — premier scraper qui implémente la méthode. */
  async recommendations(subjectId: string, page: number = 1): Promise<{ data: RecommendResult; source: string }> {
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
