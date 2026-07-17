import { request } from '../../utils/http';
import { API_H5_URL, ENDPOINTS } from '../../config/constants';
import { Scraper, ScraperConfig, HomeResult, SearchResult, SuggestResult, DetailResult, StreamResult } from '../base';

// MovieBox sert un catalogue DIFFÉRENT selon la région de l'IP appelante :
// une IP US (Vercel) reçoit le catalogue anglophone (0 VF, sous-titres gérés
// autrement), une IP d'Afrique de l'Ouest francophone reçoit le catalogue VF
// (~190 titres "En français"). On présente donc une IP du Burkina Faso sur TOUS
// les appels (contenu + lecteur + sous-titres) pour obtenir le flux francophone
// et débloquer le CDN player. Surchargeable via SPOOF_IP.
const ALLOWED_REGION_IP = process.env.SPOOF_IP || '196.28.244.1';

const GEO_SPOOF_HEADERS = {
  'X-Forwarded-For': ALLOWED_REGION_IP,
  'CF-Connecting-IP': ALLOWED_REGION_IP,
  'X-Real-IP': ALLOWED_REGION_IP,
};

const H5_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  'Referer': 'https://moviebox.ph/',
  'Origin': 'https://moviebox.ph',
  'X-Client-Info': '{"timezone":"Africa/Ouagadougou"}',
  'X-Request-Lang': 'fr',
  'Accept': 'application/json',
  'Content-Type': 'application/json',
  'sec-ch-ua': '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  ...GEO_SPOOF_HEADERS,
};

const PLAYER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'X-Client-Info': '{"timezone":"Africa/Ouagadougou"}',
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

// Détecte si un contenu est en version française (VF/VOSTFR) à partir de son
// titre, de son slug ou de ses genres. Sert à remonter la VF en priorité.
const FRENCH_RE = /version\s*fran[cç]ais|fran[cç]ais|\bvf\b|\bvostfr\b|\bfrench\b|-vf-|-vf$/i;

export function isFrenchContent(item: {
  title?: string;
  detailPath?: string;
  genres?: string[];
  badge?: string;
}): boolean {
  const haystack = [
    item.title || '',
    item.detailPath || '',
    item.badge || '',
    ...(item.genres || []),
  ].join(' ');
  return FRENCH_RE.test(haystack);
}

// Tri stable qui remonte les versions françaises en tête, sans retirer le reste.
export function prioritizeFrench<T extends Record<string, any>>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index, fr: isFrenchContent(item) }))
    .sort((a, b) => (a.fr === b.fr ? a.index - b.index : a.fr ? -1 : 1))
    .map((x) => x.item);
}

// "En français" / "VF" → "VF" ; "VOSTFR" → "VOSTFR" ; sinon null.
function languageLabel(corner: string, isFrench: boolean): string | undefined {
  if (/vostfr/i.test(corner)) return 'VOSTFR';
  if (isFrench || /fran[cç]ais/i.test(corner)) return 'VF';
  return undefined;
}

function mapSubject(sub: any, fallbackDetailPath?: string): any | null {
  if (!sub) return null;
  const subjectId = sub.subjectId;
  if (!subjectId) return null;
  const corner = sub.corner ? String(sub.corner) : '';
  const item: any = {
    subjectId: String(subjectId),
    detailPath: sub.detailPath || fallbackDetailPath || '',
    title: sub.title || 'Unknown',
    posterUrl: sub.cover?.url || sub.poster?.url || '',
    type: sub.subjectType === 2 ? 'series' : 'movie',
    year: sub.releaseDate?.substring(0, 4),
    rating: sub.imdbRatingValue || undefined,
    genres: sub.genre ? String(sub.genre).split(',').map((g: string) => g.trim()) : undefined,
    // Langues de sous-titres disponibles (chaîne CSV côté upstream)
    subtitleLangs: sub.subtitles ? String(sub.subtitles) : undefined,
    // Métadonnées enrichies : permettent un écran détail complet même quand
    // l'API /detail renvoie 404 (titres récents), via le repli côté app.
    plot: sub.description || sub.introduction || undefined,
    duration: sub.duration ? `${Math.floor(Number(sub.duration) / 60)}m` : undefined,
    country: sub.countryName || undefined,
  };
  item.isFrench = isFrenchContent({ ...item, badge: corner });
  item.language = languageLabel(corner, item.isFrench);
  // On garde le "corner" comme badge seulement s'il ne sert pas à indiquer la langue
  item.badge = corner && !/fran[cç]ais|vostfr/i.test(corner) ? corner : undefined;
  return item;
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
        const items = prioritizeFrench((op.subjects || []).map((sub: any) => mapSubject(sub)).filter(Boolean));
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

    const items = prioritizeFrench(
      raw
        .map((item: any) => mapSubject(item.subject || item, item.detailPath))
        .filter(Boolean)
    );

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

    const suggestions = raw.map((item: any) => {
      const sub = item.subject || item;
      return {
        title: sub.title || item.word || '',
        subjectId: String(sub.subjectId || item.subjectId || ''),
        detailPath: sub.detailPath || item.detailPath || '',
      };
    }).filter((s: { title: string }) => s.title);

    return prioritizeFrench(suggestions);
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

    const corner = sub.corner ? String(sub.corner) : '';
    const isFrench = isFrenchContent({ title: sub.title, detailPath, badge: corner });

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
      language: languageLabel(corner, isFrench),
      isFrench,
      subtitleLangs: sub.subtitles ? String(sub.subtitles) : undefined,
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

  // Le endpoint /subject/trending renvoie un catalogue GLOBAL (anglophone) même
  // depuis la région FR. Pour un Explorer francophone, on agrège plutôt les
  // sections du home (riche en VF) et on pagine côté serveur.
  private homeItemsCache: { at: number; movies: any[]; series: any[]; all: any[] } | null = null;
  private readonly HOME_ITEMS_TTL = 5 * 60 * 1000;

  private async getHomeItems(): Promise<{ movies: any[]; series: any[]; all: any[] }> {
    if (this.homeItemsCache && Date.now() - this.homeItemsCache.at < this.HOME_ITEMS_TTL) {
      return this.homeItemsCache;
    }
    const json = await this.authedRequest(`${API_H5_URL}${ENDPOINTS.h5Home}?host=moviebox.ph`);
    const ops = json?.data?.operatingList || [];
    const seen = new Set<string>();
    const all: any[] = [];
    for (const op of ops) {
      if (!['SUBJECTS_MOVIE', 'SUBJECTS_TV', 'SUBJECTS_ANIMATION'].includes(op.type)) continue;
      for (const sub of op.subjects || []) {
        const item = mapSubject(sub);
        if (!item || seen.has(item.subjectId)) continue;
        seen.add(item.subjectId);
        all.push(item);
        this.rememberSlug(item.subjectId, item.detailPath);
      }
    }
    const cache = {
      at: Date.now(),
      movies: prioritizeFrench(all.filter((i) => i.type === 'movie')),
      series: prioritizeFrench(all.filter((i) => i.type === 'series')),
      all: prioritizeFrench(all),
    };
    this.homeItemsCache = cache;
    return cache;
  }

  async category(tabId: string, page: number = 1): Promise<{ items: any[]; page: number; hasMore: boolean }> {
    const home = await this.getHomeItems();
    const list = tabId === 'movies' ? home.movies : tabId === 'series' ? home.series : home.all;

    const perPage = 24;
    const start = (page - 1) * perPage;
    const slice = list.slice(start, start + perPage);

    return { items: slice, page, hasMore: start + perPage < list.length };
  }
}
