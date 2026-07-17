import { request } from '../utils/http';
import { Scraper, ScraperConfig, HomeResult, SearchResult, SuggestResult, DetailResult, StreamResult } from './base';

const VIDLINK_BASE = 'https://vidlink.pro';

const VIDLINK_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  'Accept': 'application/json,text/html,*/*',
  'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
  'Origin': VIDLINK_BASE,
  'Referer': VIDLINK_BASE + '/',
};

export class VidLinkScraper implements Scraper {
  config: ScraperConfig = {
    name: 'vidlink',
    version: '1.0.0',
    baseUrl: VIDLINK_BASE,
    priority: 1,
  };

  async isAvailable(): Promise<boolean> {
    try {
      const resp = await request(VIDLINK_BASE, { headers: VIDLINK_HEADERS, timeout: 10000 });
      return resp.status === 200;
    } catch {
      return false;
    }
  }

  async home(): Promise<HomeResult> {
    return { sections: [], tabs: [] };
  }

  async search(_query: string, _page?: number): Promise<SearchResult> {
    return { items: [], total: 0, page: 1 };
  }

  async suggest(_query: string): Promise<SuggestResult[]> {
    return [];
  }

  async detail(_subjectId: string): Promise<DetailResult> {
    return { subjectId: '', detailPath: '', title: '', posterUrl: '', type: 'movie', dubs: [], freeEpisodes: 0 };
  }

  async category(_tabId: string, _page?: number): Promise<{ items: any[]; page: number; hasMore: boolean }> {
    return { items: [], page: 1, hasMore: false };
  }

  async stream(subjectId: string, season?: number, episode?: number, _detailPath?: string): Promise<StreamResult> {
    const sources: any[] = [];
    const subtitles: any[] = [];

    const isTv = !!(season && episode);
    const tmdbId = subjectId.replace(/^tmdb-/, '').replace(/^flixhq-/, '');

    if (!tmdbId || tmdbId === subjectId) {
      return { sources: [], dubs: [], subtitles: [], hasResource: false, freeEpisodes: 0 };
    }

    try {
      let url: string;
      if (isTv) {
        url = `${VIDLINK_BASE}/tv/${tmdbId}/${season}/${episode}`;
      } else {
        url = `${VIDLINK_BASE}/movie/${tmdbId}`;
      }
      url += '?fallback=true';

      const resp = await request(url, { headers: VIDLINK_HEADERS, timeout: 15000 });

      if (resp.status === 200) {
        const html = resp.body;
        const m3u8Match = html.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/);
        if (m3u8Match) {
          sources.push({
            url: m3u8Match[0],
            format: 'HLS',
            quality: 1080,
            codec: 'h264',
          });
        }
        const mp4Matches = html.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/g);
        if (mp4Matches) {
          for (const mp4 of mp4Matches) {
            if (!sources.some(s => s.url === mp4)) {
              sources.push({ url: mp4, format: 'MP4', quality: 720, codec: 'h264' });
            }
          }
        }
        const vttMatches = html.matchAll(/https?:\/\/[^"'\s]+\.vtt[^"'\s]*/g);
        for (const vtt of vttMatches) {
          subtitles.push({ url: vtt[0], language: 'Unknown' });
        }
      }
    } catch {}

    return {
      sources,
      dubs: [],
      subtitles,
      hasResource: sources.length > 0,
      freeEpisodes: 0,
    };
  }
}
