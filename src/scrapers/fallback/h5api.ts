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

// IP d'une région autorisée (Nigeria). Le CDN player (netfilm.world) géo-bloque
// les IP datacenter (ex: Vercel US) via X-Forwarded-For et répond
// "403 invalid region" — ce spoof rétablit l'accès aux flux depuis n'importe où.
const ALLOWED_REGION_IP = process.env.SPOOF_IP || '41.58.0.1';

const GEO_SPOOF_HEADERS = {
  'X-Forwarded-For': ALLOWED_REGION_IP,
  'CF-Connecting-IP': ALLOWED_REGION_IP,
  'X-Real-IP': ALLOWED_REGION_IP,
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
  ...GEO_SPOOF_HEADERS,
};

// Onglets exposés par notre API. Les IDs sont stables et résolus dans category().
const CATEGORY_TABS: { id: string; title: string }[] = [
  { id: 'trending', title: 'Trending' },
  { id: 'movies', title: 'Movies' },
  { id: 'series', title: 'TV Series' },
];

// tabIds upstream de /subject/trending (validés en live) :
// 2 = films (subjectType 1), 5 = séries/anime (subjectType 2), absent = mixte
const TRENDING_TAB_MAP: Record<string, string | null> = {
  trending: null,
  movies: '2',
  series: '5',
};

function mapSubject(sub: any, fallbackDetailPath?: string): any | null {
  if (!sub) return null;
  const subjectId = sub.subjectId;
  if (!subjectId) return null;
  return {
    subjectId: String(subjectId),
    detailPath: sub.detailPath || fallbackDetailPath || '',
    title: sub.title || 'Unknown',
    posterUrl: sub.cover?.url || sub.poster?.url || '',
    type: sub.subjectType === 2 ? 'series' : 'movie',
    year: sub.releaseDate?.substring(0, 4),
    rating: sub.imdbRatingValue || undefined,
    badge: sub.corner || undefined,
    genres: sub.genre ? String(sub.genre).split(',').map((g: string) => g.trim()) : undefined,
  };
}

export class MovieBoxH5Scraper implements Scraper {
  config: ScraperConfig = {
    name: 'moviebox-h5api',
    version: '2.0.0',
    baseUrl: API_H5_URL,
    priority: 0,
  };

  private bearerToken: string | null = null;
  private lastTokenFetch = 0;
  private readonly TOKEN_TTL = 25 * 60 * 1000;
  // Cache subjectId -> detailPath pour résoudre le slug des streams
  private slugCache = new Map<string, string>();

  private rememberSlug(subjectId: string, detailPath?: string): void {
    if (subjectId && detailPath) {
      if (this.slugCache.size > 500) this.slugCache.clear();
      this.slugCache.set(subjectId, detailPath);
    }
  }

  private async acquireBearerToken(force: boolean = false): Promise<string> {
    if (!force && this.bearerToken && Date.now() - this.lastTokenFetch < this.TOKEN_TTL) {
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

  private updateTokenFromResponse(headers: Record<string, string>): void {
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

  // GET/POST authentifié avec un retry sur 401/403 (token invité expiré)
  private async authedRequest(url: string, opts: { method?: string; body?: string } = {}): Promise<any> {
    let headers = await this.authHeaders();
    let response = await request(url, { ...opts, headers });

    if (response.status === 401 || response.status === 403) {
      await this.acquireBearerToken(true);
      headers = await this.authHeaders();
      response = await request(url, { ...opts, headers });
    }

    if (response.status !== 200) {
      throw new Error(`H5 request failed (${response.status}): ${url}`);
    }

    this.updateTokenFromResponse(response.headers);
    return response.json();
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
    const json = await this.authedRequest(`${API_H5_URL}${ENDPOINTS.h5Home}?host=moviebox.ph`);
    const operatingList = json?.data?.operatingList || [];

    const sections: any[] = [];

    for (const op of operatingList) {
      const opType = op.type;
      const title = op.title || 'Featured';

      if (opType === 'BANNER') {
        const items = (op.banner?.items || [])
          .map((item: any) => {
            const mapped = mapSubject(item.subject, item.detailPath);
            if (!mapped) return null;
            // L'image du banner est en paysage, prioritaire sur le poster
            if (item.image?.url) mapped.coverUrl = item.image.url;
            if (item.title) mapped.title = item.title;
            return mapped;
          })
          .filter(Boolean);
        if (items.length > 0) {
          sections.push({ id: 'banner', title: 'Featured', type: 'banner', items });
        }
      } else if (['SUBJECTS_MOVIE', 'SUBJECTS_TV', 'SUBJECTS_ANIMATION'].includes(opType)) {
        const items = (op.subjects || []).map((sub: any) => mapSubject(sub)).filter(Boolean);
        if (items.length > 0) {
          sections.push({ id: op.opId || opType, title, type: 'row', items });
        }
      }
    }

    for (const section of sections) {
      for (const item of section.items) this.rememberSlug(item.subjectId, item.detailPath);
    }

    return { sections, tabs: CATEGORY_TABS };
  }

  async search(query: string, page: number = 1): Promise<SearchResult> {
    const body = JSON.stringify({ keyword: query, page, perPage: 20 });
    const json = await this.authedRequest(`${API_H5_URL}${ENDPOINTS.h5Search}`, { method: 'POST', body });
    const inner = json?.data || {};
    const raw = inner.items || inner.list || [];

    const items = raw
      .map((item: any) => mapSubject(item.subject || item, item.detailPath))
      .filter(Boolean);

    for (const item of items) this.rememberSlug(item.subjectId, item.detailPath);

    const total = inner.pager?.totalCount || inner.total || items.length;
    return { items, total, page };
  }

  async suggest(query: string): Promise<SuggestResult[]> {
    if (query.length < 2) return [];

    const body = JSON.stringify({ keyword: query, perPage: 10 });
    let json: any;
    try {
      json = await this.authedRequest(`${API_H5_URL}${ENDPOINTS.h5SearchSuggest}`, { method: 'POST', body });
    } catch {
      return [];
    }
    const inner = json?.data || {};
    const raw = inner.items || inner.list || [];

    return raw.map((item: any) => {
      const sub = item.subject || item;
      return {
        title: sub.title || item.word || '',
        subjectId: String(sub.subjectId || item.subjectId || ''),
        detailPath: sub.detailPath || item.detailPath || '',
      };
    }).filter((s: { title: string }) => s.title);
  }

  async detail(subjectId: string): Promise<DetailResult> {
    const json = await this.authedRequest(`${API_H5_URL}${ENDPOINTS.h5Detail}?subjectId=${subjectId}`);
    const data = json?.data || {};
    const sub = data.subject || data;
    const resource = data.resource || {};

    const detailPath = sub.detailPath || '';
    this.rememberSlug(String(sub.subjectId || subjectId), detailPath);

    const seasons = (resource.seasons || []).map((s: any) => ({
      season: s.se ?? 0,
      maxEpisodes: s.maxEp ?? 0,
    }));

    const dubs = (sub.dubs || []).map((d: any) => ({
      subjectId: String(d.subjectId || ''),
      language: d.lanName || d.language || d.lan || 'Unknown',
    })).filter((d: any) => d.subjectId);

    const castList = (data.stars || sub.castList || sub.staffList || [])
      .map((c: any) => c.name || c.staffName || (typeof c === 'string' ? c : ''))
      .filter(Boolean);

    return {
      subjectId: String(sub.subjectId || subjectId),
      detailPath,
      title: sub.title || '',
      posterUrl: sub.cover?.url || '',
      coverUrl: sub.cover?.url || sub.poster?.url,
      type: sub.subjectType === 2 ? 'series' : 'movie',
      year: sub.releaseDate?.substring(0, 4),
      rating: sub.imdbRatingValue || undefined,
      genres: sub.genre ? String(sub.genre).split(',').map((g: string) => g.trim()) : undefined,
      plot: sub.description || sub.introduction,
      duration: sub.duration ? `${Math.floor(Number(sub.duration) / 60)}m` : undefined,
      country: sub.countryName,
      cast: castList.length > 0 ? castList : undefined,
      dubs,
      seasons: seasons.length > 0 ? seasons : undefined,
      freeEpisodes: sub.freeNum || data.watchTimeLimit?.freeNum || 0,
    };
  }

  private async resolveSlug(subjectId: string, detailPath?: string): Promise<string> {
    if (detailPath) return detailPath;
    const cached = this.slugCache.get(subjectId);
    if (cached) return cached;
    const d = await this.detail(subjectId);
    if (!d.detailPath) {
      throw new Error(`Cannot resolve detailPath slug for subject ${subjectId}`);
    }
    return d.detailPath;
  }

  private hasAnyStream(playData: any): boolean {
    return (playData?.streams?.length || 0) + (playData?.dash?.length || 0) + (playData?.hls?.length || 0) > 0;
  }

  private async fetchPlay(domain: string, subjectId: string, slug: string, se: number, ep: number): Promise<any> {
    const playerReferer = `${domain}/spa/videoPlayPage/movies/${slug}?id=${subjectId}&type=/movie/detail&detailSe=${se}&detailEp=${ep}&lang=en`;
    const playUrl = `${domain}${ENDPOINTS.h5Play}?subjectId=${subjectId}&se=${se}&ep=${ep}&detailPath=${slug}`;

    const playResponse = await request(playUrl, {
      headers: { ...PLAYER_HEADERS, 'Referer': playerReferer },
    });

    if (playResponse.status !== 200) {
      throw new Error(`H5 play failed: ${playResponse.status}`);
    }

    const playJson = await playResponse.json();
    return playJson?.data || {};
  }

  async stream(subjectId: string, season?: number, episode?: number, detailPath?: string): Promise<StreamResult> {
    const se = season ?? 1;
    const ep = episode ?? 1;

    // Le slug detailPath est OBLIGATOIRE : sans lui l'upstream renvoie streams:[]
    const slug = await this.resolveSlug(subjectId, detailPath);

    const domJson = await this.authedRequest(`${API_H5_URL}${ENDPOINTS.h5PlayDomain}`);
    const domain = String(domJson?.data || 'https://netfilm.world').replace(/\/$/, '');

    let playData = await this.fetchPlay(domain, subjectId, slug, se, ep);

    // Convention upstream : les films utilisent se=0&ep=0. Si un client demande
    // S1E1 (défaut) et n'obtient rien, on retente en mode film.
    if (!this.hasAnyStream(playData) && se === 1 && ep === 1) {
      playData = await this.fetchPlay(domain, subjectId, slug, 0, 0);
    }
    const rawStreams = [...(playData.streams || []), ...(playData.dash || []), ...(playData.hls || [])];


    const seen = new Set<string>();
    const sources = rawStreams.map((s: any) => ({
      id: s.id || undefined,
      url: s.url || '',
      format: s.format === 'HLS' ? 'HLS' : s.format === 'DASH' ? 'DASH' : 'MP4',
      quality: parseInt(String(s.resolutions || '0').replace(/\D/g, '')) || 0,
      size: s.size ? Number(s.size) : undefined,
      duration: s.duration ? Number(s.duration) : undefined,
      codec: s.codecName || 'h264',
    })).filter((s: any) => {
      if (!s.url || seen.has(s.url)) return false;
      seen.add(s.url);
      return true;
    });

    const subtitles = await this.fetchCaptions(subjectId, slug, sources[0]);

    return {
      sources,
      dubs: [],
      subtitles,
      hasResource: sources.length > 0,
      freeEpisodes: playData.freeNum || 0,
    };
  }

  private async fetchCaptions(
    subjectId: string,
    slug: string,
    firstSource?: { id?: string; format?: string }
  ): Promise<{ url: string; language: string }[]> {
    if (!firstSource?.id) return [];
    try {
      const url = `${API_H5_URL}${ENDPOINTS.h5Caption}?format=${firstSource.format || 'MP4'}&id=${firstSource.id}&subjectId=${subjectId}&detailPath=${slug}`;
      const json = await this.authedRequest(url);
      const inner = json?.data || {};
      const captions = Array.isArray(inner) ? inner : (inner.captions || []);
      return captions.map((c: any) => ({
        url: c.url || '',
        language: c.lanName || c.language || c.lan || 'Unknown',
      })).filter((c: any) => c.url);
    } catch {
      return [];
    }
  }

  async category(tabId: string, page: number = 1): Promise<{ items: any[]; page: number; hasMore: boolean }> {
    // Onglets connus -> /subject/trending (validé en live) ; IDs legacy -> trending mixte
    const upstreamTab = TRENDING_TAB_MAP[tabId] !== undefined ? TRENDING_TAB_MAP[tabId] : null;
    const tabParam = upstreamTab ? `tabId=${upstreamTab}&` : '';
    const url = `${API_H5_URL}${ENDPOINTS.h5Trending}?${tabParam}page=${page}&perPage=18`;

    const json = await this.authedRequest(url);
    const inner = json?.data || {};
    const raw = inner.subjectList || inner.items || [];

    const items = raw
      .map((sub: any) => mapSubject(sub.subject || sub))
      .filter(Boolean);

    for (const item of items) this.rememberSlug(item.subjectId, item.detailPath);

    const pager = inner.pager || {};
    const hasMore = pager.hasMore === true || (typeof pager.nextPage === 'string' && pager.nextPage !== '');

    return { items, page, hasMore };
  }
}
