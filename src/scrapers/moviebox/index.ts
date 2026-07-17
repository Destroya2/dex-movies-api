import { Scraper, ScraperConfig, HomeResult, SearchResult, SuggestResult, DetailResult, StreamResult } from '../base';
import { fetchHomepage, fetchCategoryTabs, fetchCategoryContent } from './home';
import { search, suggest as movieboxSuggest } from './search';
import { fetchDetail } from './detail';
import { fetchStream } from './stream';
import { API_MOBILE_HOSTS } from '../../config/constants';

export class MovieBoxMobileScraper implements Scraper {
  config: ScraperConfig = {
    name: 'moviebox-hmac',
    version: '2.0.0',
    baseUrl: API_MOBILE_HOSTS[0],
    // Secondaire : api3.aoneroom.com bloque les IP datacenter (Vercel)
    priority: 3,
  };

  async isAvailable(): Promise<boolean> {
    try {
      await fetchHomepage();
      return true;
    } catch {
      return false;
    }
  }

  async home(): Promise<HomeResult> {
    const [sections, tabs] = await Promise.all([fetchHomepage(), fetchCategoryTabs()]);
    return { sections, tabs };
  }

  async search(query: string, page: number = 1): Promise<SearchResult> {
    return search(query, page);
  }

  async suggest(query: string): Promise<SuggestResult[]> {
    return movieboxSuggest(query);
  }

  async detail(subjectId: string): Promise<DetailResult> {
    const d = await fetchDetail(subjectId);
    return {
      subjectId: d.subjectId,
      title: d.title,
      posterUrl: d.posterUrl,
      coverUrl: d.backdropUrl,
      type: d.type,
      year: d.year,
      rating: d.rating,
      genres: d.genres,
      plot: d.description,
      duration: d.duration,
      country: d.country,
      cast: d.cast.map(c => c.name),
      dubs: d.dubs.map(dub => ({ subjectId: dub.subjectId, language: dub.language })),
      seasons: d.seasons,
      freeEpisodes: d.freeEpisodes,
    };
  }

  async stream(subjectId: string, season?: number, episode?: number, _detailPath?: string): Promise<StreamResult> {
    return fetchStream(subjectId, season, episode);
  }

  async category(tabId: string, page: number = 1): Promise<{ items: any[]; page: number; hasMore: boolean }> {
    const content = await fetchCategoryContent(tabId, page);
    return { items: content.items, page, hasMore: content.hasMore };
  }
}
