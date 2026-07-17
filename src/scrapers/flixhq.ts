import { MOVIES } from '@consumet/extensions';
import { Scraper, ScraperConfig, HomeResult, SearchResult, SuggestResult, DetailResult, StreamResult } from './base';

const CONSUMET_FLIXHQ_BASE = 'https://flixhq.to';

export class FlixHQScraper implements Scraper {
  config: ScraperConfig = {
    name: 'flixhq-consumet',
    version: '1.0.0',
    baseUrl: CONSUMET_FLIXHQ_BASE,
    priority: 2,
  };

  private provider: any | null = null;

  private async getProvider(): Promise<any> {
    if (!this.provider) {
      this.provider = new MOVIES.FlixHQ();
    }
    return this.provider;
  }

  private mapConsumetItem(item: any): any {
    const id = String(item.id || '');
    const title = String(item.title || 'Unknown');
    const isTv = item.type === 'TVSeries' || item.type === 'TV' || String(item.url || '').includes('/watch-tv/');
    return {
      subjectId: `flixhq-${id}`,
      detailPath: item.url || item.id || '',
      title,
      posterUrl: item.image || item.poster || '',
      type: isTv ? 'series' : 'movie',
      rating: item.rating ? String(item.rating) : undefined,
      isFrench: false,
      language: 'VO',
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const p = await this.getProvider();
      await p.fetchHomeSection('Latest Movies');
      return true;
    } catch {
      return false;
    }
  }

  async home(): Promise<HomeResult> {
    const p = await this.getProvider();
    const sections: any[] = [];
    try {
      const trendingMovies = await p.fetchHomeSectionById('trending-movies');
      if (trendingMovies?.length > 0) {
        sections.push({ id: 'flixhq-trending', title: 'FlixHQ Trending Movies', type: 'row', items: trendingMovies.map((i: any) => this.mapConsumetItem(i)) });
      }
    } catch {}
    try {
      const trendingTv = await p.fetchHomeSectionById('trending-tv', true);
      if (trendingTv?.length > 0) {
        sections.push({ id: 'flixhq-trending-tv', title: 'FlixHQ Trending Series', type: 'row', items: trendingTv.map((i: any) => this.mapConsumetItem(i)) });
      }
    } catch {}
    try {
      const latestMovies = await p.fetchHomeSection('Latest Movies');
      if (latestMovies?.length > 0) {
        sections.push({ id: 'flixhq-latest', title: 'FlixHQ Latest Movies', type: 'row', items: latestMovies.map((i: any) => this.mapConsumetItem(i)) });
      }
    } catch {}
    try {
      const latestTv = await p.fetchHomeSection('Latest TV Shows', true);
      if (latestTv?.length > 0) {
        sections.push({ id: 'flixhq-latest-tv', title: 'FlixHQ Latest Series', type: 'row', items: latestTv.map((i: any) => this.mapConsumetItem(i)) });
      }
    } catch {}
    return { sections, tabs: [] };
  }

  async search(query: string, page: number = 1): Promise<SearchResult> {
    const p = await this.getProvider();
    const results = await p.fetchByFilter('search', query, page);
    const raw = results?.results || results || [];
    const items = raw.map((i: any) => this.mapConsumetItem(i));
    return { items, total: items.length, page };
  }

  async suggest(_query: string): Promise<SuggestResult[]> {
    return [];
  }

  async detail(subjectId: string): Promise<DetailResult> {
    const id = subjectId.replace('flixhq-', '');
    const p = await this.getProvider();
    let item: any;
    try {
      const results = await p.fetchByFilter('search', id, 1);
      const raw = results?.results || results || [];
      item = raw.find((i: any) => String(i.id) === id || String(i.title).toLowerCase().replace(/\s+/g, '-') === id);
    } catch {}
    if (!item) {
      return {
        subjectId, detailPath: '', title: '', posterUrl: '', type: 'movie',
        dubs: [], freeEpisodes: 0,
      };
    }
    const isTv = item.type === 'TVSeries' || item.type === 'TV';
    return {
      subjectId,
      detailPath: item.url || item.id || '',
      title: item.title || '',
      posterUrl: item.image || '',
      type: isTv ? 'series' : 'movie',
      rating: item.rating ? String(item.rating) : undefined,
      dubs: [],
      freeEpisodes: 0,
      isFrench: false,
      language: 'VO',
    };
  }

  async stream(_subjectId: string, _season?: number, _episode?: number, _detailPath?: string): Promise<StreamResult> {
    return { sources: [], dubs: [], subtitles: [], hasResource: false, freeEpisodes: 0 };
  }

  async category(tabId: string, page: number = 1): Promise<{ items: any[]; page: number; hasMore: boolean }> {
    const p = await this.getProvider();
    const filterType = tabId === 'series' ? 'genre' : 'genre';
    const filterValue = tabId === 'series' ? 'action' : 'action';
    try {
      const results = await p.fetchByFilter(filterType, filterValue, page);
      const raw = results?.results || results || [];
      const items = raw.map((i: any) => this.mapConsumetItem(i));
      return { items, page, hasMore: items.length >= 20 };
    } catch {
      return { items: [], page, hasMore: false };
    }
  }
}
