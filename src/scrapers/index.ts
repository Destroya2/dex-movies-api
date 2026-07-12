import { Scraper, HomeResult, SearchResult, SuggestResult, DetailResult, StreamResult } from './base';
import { MovieBoxMobileScraper } from './moviebox/index';
import { MovieBoxH5Scraper } from './fallback/h5api';

type ScraperMethod = 'home' | 'search' | 'suggest' | 'detail' | 'stream' | 'category';

export class ScraperEngine {
  private scrapers: Scraper[] = [];
  private unavailable = new Set<string>();

  constructor() {
    this.register(new MovieBoxMobileScraper());
    this.register(new MovieBoxH5Scraper());
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

    for (const scraper of this.scrapers) {
      if (this.unavailable.has(scraper.config.name)) continue;

      try {
        const data = await fn(scraper);
        return { data, source: scraper.config.name };
      } catch (error: any) {
        errors.push({ name: scraper.config.name, error });
        if (scraper.config.priority === 0) {
          this.unavailable.add(scraper.config.name);
        }
      }
    }

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

  async stream(subjectId: string, season?: number, episode?: number): Promise<{ data: StreamResult; source: string }> {
    return this.execute('stream', (s) => s.stream(subjectId, season, episode), `stream(${subjectId})`);
  }

  async category(tabId: string, page: number = 1): Promise<{ data: { items: any[]; page: number; hasMore: boolean }; source: string }> {
    return this.execute('category', (s) => s.category(tabId, page), `category(${tabId})`);
  }
}
