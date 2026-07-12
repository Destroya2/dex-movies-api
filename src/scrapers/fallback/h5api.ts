import { request } from '../../utils/http';
import { API_H5_URL, ENDPOINTS } from '../../config/constants';
import { Scraper, ScraperConfig, HomeResult, SearchResult, SuggestResult, DetailResult, StreamResult } from '../base';

const H5_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  'Referer': 'https://moviebox.ph/',
  'Origin': 'https://moviebox.ph',
  'X-Client-Info': '{"timezone":"Asia/Dhaka"}',
  'X-Request-Lang': 'en',
  'Accept': 'application/json',
  'Content-Type': 'application/json',
  'sec-ch-ua': '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
};

const PLAYER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'X-Client-Info': '{"timezone":"Asia/Dhaka"}',
  'X-Source': '',
  'sec-ch-ua': '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
};

export class MovieBoxH5Scraper implements Scraper {
  config: ScraperConfig = {
    name: 'moviebox-h5api',
    version: '1.0.0',
    baseUrl: API_H5_URL,
    priority: 1,
  };

  private bearerToken: string | null = null;
  private lastTokenFetch = 0;
  private readonly TOKEN_TTL = 25 * 60 * 1000;

  private async acquireBearerToken(): Promise<string> {
    if (this.bearerToken && Date.now() - this.lastTokenFetch < this.TOKEN_TTL) {
      return this.bearerToken;
    }

    const response = await request(`${API_H5_URL}${ENDPOINTS.h5Home}?host=moviebox.ph`, { headers: H5_HEADERS });

    if (response.status === 200) {
      const xUser = response.headers['x-user'];
      if (xUser) {
        const parsed = JSON.parse(xUser);
        if (parsed.token) {
          this.bearerToken = parsed.token;
          this.lastTokenFetch = Date.now();
          return this.bearerToken!;
        }
      }

      const setCookie = response.headers['set-cookie'] || '';
      const match = setCookie.match(/token=([^;]+)/);
      if (match) {
        this.bearerToken = match[1];
        this.lastTokenFetch = Date.now();
        return this.bearerToken!;
      }
    }

    throw new Error('Failed to acquire H5 guest bearer token');
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.acquireBearerToken();
    return { ...H5_HEADERS, 'Authorization': `Bearer ${token}` };
  }

  private async updateTokenFromResponse(headers: Record<string, string>): Promise<void> {
    const xUser = headers['x-user'];
    if (xUser) {
      try {
        const parsed = JSON.parse(xUser);
        if (parsed.token) {
          this.bearerToken = parsed.token;
          this.lastTokenFetch = Date.now();
        }
      } catch { }
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.acquireBearerToken();
      return true;
    } catch {
      return false;
    }
  }

  async home(): Promise<HomeResult> {
    const headers = await this.authHeaders();
    const response = await request(`${API_H5_URL}${ENDPOINTS.h5Home}?host=moviebox.ph`, { headers });

    if (response.status !== 200) {
      throw new Error(`H5 home failed: ${response.status}`);
    }

    await this.updateTokenFromResponse(response.headers);
    const json = await response.json();
    const operatingList = json?.data?.operatingList || [];

    const tabs: { id: string; title: string }[] = [];
    const sections: any[] = [];

    for (const op of operatingList) {
      const opType = op.type;
      const title = op.title || 'Featured';

      if (opType === 'BANNER') {
        const items = (op.banner?.items || [])
          .filter((item: any) => item.title && !item.title.includes('Communities'))
          .map((item: any) => ({
            subjectId: String(item.subject?.subjectId || ''),
            title: item.title || item.subject?.title || '',
            posterUrl: item.image?.url || item.subject?.cover?.url || '',
            type: item.subject?.subjectType === 2 ? 'series' : 'movie',
            rating: item.subject?.imdbRatingValue || undefined,
            badge: item.subject?.corner || undefined,
          }));
        sections.push({ id: 'banner', title: 'Featured', type: 'banner', items });
      } else if (['SUBJECTS_MOVIE', 'SUBJECTS_TV', 'SUBJECTS_ANIMATION'].includes(opType)) {
        const items = (op.subjects || []).map((sub: any) => ({
          subjectId: String(sub.subjectId || ''),
          title: sub.title || '',
          posterUrl: sub.cover?.url || '',
          type: sub.subjectType === 2 ? 'series' : 'movie',
          rating: sub.imdbRatingValue || undefined,
          year: sub.releaseDate?.substring(0, 4),
          badge: sub.corner || undefined,
        }));
        sections.push({ id: opType, title, type: 'row', items });
      }
    }

    return { sections, tabs };
  }

  async search(query: string, page: number = 1): Promise<SearchResult> {
    const headers = await this.authHeaders();
    const body = JSON.stringify({ keyword: query, page, perPage: 20 });
    const response = await request(`${API_H5_URL}${ENDPOINTS.h5Search}`, { method: 'POST', headers, body });

    if (response.status !== 200) {
      throw new Error(`H5 search failed: ${response.status}`);
    }

    await this.updateTokenFromResponse(response.headers);
    const json = await response.json();
    const inner = json?.data || {};
    const raw = inner.items || inner.list || [];

    const items = raw.map((item: any) => {
      const sub = item.subject || item;
      return {
        subjectId: String(sub.subjectId || ''),
        title: sub.title || 'Unknown',
        posterUrl: sub.cover?.url || '',
        type: sub.subjectType === 2 ? 'series' : 'movie',
        year: sub.releaseDate?.substring(0, 4),
        rating: sub.imdbRatingValue || undefined,
      };
    }).filter((r: any) => r.subjectId);

    const total = inner.pager?.totalCount || inner.total || items.length;
    return { items, total, page };
  }

  async suggest(query: string): Promise<SuggestResult[]> {
    if (query.length < 2) return [];

    const headers = await this.authHeaders();
    const body = JSON.stringify({ keyword: query, perPage: 10 });
    const response = await request(`${API_H5_URL}${ENDPOINTS.h5SearchSuggest}`, { method: 'POST', headers, body });

    if (response.status !== 200) return [];

    await this.updateTokenFromResponse(response.headers);
    const json = await response.json();
    const inner = json?.data || {};
    const raw = inner.items || inner.list || [];

    return raw.map((item: any) => {
      const sub = item.subject || item;
      return {
        title: sub.title || item.word || '',
        subjectId: String(sub.subjectId || item.subjectId || ''),
      };
    }).filter((s: { title: string }) => s.title);
  }

  async detail(subjectId: string): Promise<DetailResult> {
    const headers = await this.authHeaders();
    const response = await request(`${API_H5_URL}${ENDPOINTS.h5Detail}?subjectId=${subjectId}`, { headers });

    if (response.status !== 200) {
      throw new Error(`H5 detail failed: ${response.status}`);
    }

    await this.updateTokenFromResponse(response.headers);
    const json = await response.json();
    const data = json?.data || {};
    const sub = data.subject || data;

    return {
      subjectId: String(sub.subjectId || ''),
      title: sub.title || '',
      posterUrl: sub.cover?.url || '',
      coverUrl: sub.cover?.url || sub.poster?.url,
      type: sub.subjectType === 2 ? 'series' : 'movie',
      year: sub.releaseDate?.substring(0, 4),
      rating: sub.imdbRatingValue || undefined,
      genres: sub.genreNames ? (Array.isArray(sub.genreNames) ? sub.genreNames : [sub.genreNames]) : undefined,
      plot: sub.introduction || sub.description,
      duration: sub.duration ? `${Math.floor(Number(sub.duration) / 60)}m` : undefined,
      country: sub.countryName,
      cast: sub.castList?.map((c: any) => c.name || c) || undefined,
      dubs: [],
      seasons: undefined,
      freeEpisodes: sub.freeNum || 0,
    };
  }

  async stream(subjectId: string, season?: number, episode?: number): Promise<StreamResult> {
    const se = season || 1;
    const ep = episode || 1;

    const domHeaders = await this.authHeaders();
    const domResponse = await request(`${API_H5_URL}${ENDPOINTS.h5PlayDomain}`, { headers: domHeaders });

    if (domResponse.status !== 200) {
      throw new Error(`H5 get-domain failed: ${domResponse.status}`);
    }

    await this.updateTokenFromResponse(domResponse.headers);
    const domJson = await domResponse.json();
    const domain = (domJson?.data || 'https://netfilm.world').replace(/\/$/, '');

    const detailPath = subjectId;
    const playerReferer = `${domain}/spa/videoPlayPage/movies/${detailPath}?id=${subjectId}&type=/movie/detail&detailSe=${se}&detailEp=${ep}&lang=en`;

    const playUrl = `${domain}${ENDPOINTS.h5Play}?subjectId=${subjectId}&se=${se}&ep=${ep}&detailPath=${detailPath}`;
    const playResponse = await request(playUrl, {
      headers: { ...PLAYER_HEADERS, 'Referer': playerReferer },
    });

    if (playResponse.status !== 200) {
      return { sources: [], dubs: [], subtitles: [], hasResource: false, freeEpisodes: 0 };
    }

    const playJson = await playResponse.json();
    const playData = playJson?.data || {};
    const streams = playData.streams || [];

    const sources = streams.map((s: any) => ({
      url: s.url || '',
      format: s.format === 'HLS' ? 'HLS' : s.format === 'DASH' ? 'DASH' : 'MP4',
      quality: parseInt(String(s.resolutions || '0').replace(/\D/g, '')) || 0,
      size: s.size ? Number(s.size) : undefined,
      duration: s.duration ? Number(s.duration) : undefined,
      codec: s.codecName || 'h264',
    })).filter((s: any) => s.url);

    return {
      sources,
      dubs: [],
      subtitles: [],
      hasResource: sources.length > 0 || (playData.dash?.length || 0) > 0 || (playData.hls?.length || 0) > 0,
      freeEpisodes: playData.freeNum || 0,
    };
  }

  async category(tabId: string, page: number = 1): Promise<{ items: any[]; page: number; hasMore: boolean }> {
    const headers = await this.authHeaders();
    const body = JSON.stringify({
      tabId: Number(tabId),
      filter: { sort: 'RECOMMEND', genre: 'ALL', country: 'ALL', year: 'ALL', language: 'ALL' },
      page,
      perPage: 24,
    });

    const response = await request(`${API_H5_URL}${ENDPOINTS.h5Search}`, { method: 'POST', headers, body });

    if (response.status !== 200) {
      throw new Error(`H5 category failed: ${response.status}`);
    }

    await this.updateTokenFromResponse(response.headers);
    const json = await response.json();
    const inner = json?.data || {};
    const raw = inner.items || inner.subjects || [];

    const items = raw.map((sub: any) => ({
      subjectId: String(sub.subjectId || ''),
      title: sub.title || '',
      posterUrl: sub.cover?.url || '',
      type: sub.subjectType === 2 ? 'series' : 'movie',
      rating: sub.imdbRatingValue || undefined,
      year: sub.releaseDate?.substring(0, 4),
      badge: sub.corner || undefined,
    })).filter((i: any) => i.subjectId);

    const totalCount = inner.pager?.totalCount || inner.total || items.length;
    const perPage = 24;
    const totalPages = Math.ceil(totalCount / perPage);

    return { items, page, hasMore: page < totalPages };
  }
}
