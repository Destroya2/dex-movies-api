import { request } from '../../utils/http';
import { API_H5_URL, API_H5_MIRRORS, API_WEB_URL, API_WEB_MIRRORS, ENDPOINTS } from '../../config/constants';
import { Scraper, ScraperConfig, HomeResult, SearchResult, SuggestResult, DetailResult, StreamResult } from '../base';
import { persistentGet, persistentSet } from '../../middleware/persistentCache';
import { logger } from '../../middleware/logger';

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
  'X-Client-Type': 'h5',
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

const CATEGORY_TABS: { id: string; title: string }[] = [
  { id: 'trending', title: 'Trending' },
  { id: 'movies', title: 'Movies' },
  { id: 'series', title: 'TV Series' },
];

function getCornerLanguage(corner: string, title?: string, detailPath?: string, subtitleLangs?: string): { isFrench: boolean; language?: string } {
  // PRIMAIRE : champ corner upstream (fiable à 100%)
  if (corner) {
    const c = String(corner).trim();
    if (/vostfr/i.test(c)) return { isFrench: true, language: 'VOSTFR' };
    if (/fran[cç]ais|\bvf\b/i.test(c)) return { isFrench: true, language: 'VF' };
    return { isFrench: false };
  }

  // FALLBACK : l'upstream n'a pas fourni de corner → on vérifie le titre et le slug
  // pour des marqueurs explicites de langue. Ex: "Naruto [Version française]",
  // "Godzilla [VF]", detailPath contenant "-version-francaise-".
  // Ne pas utiliser de heuristiques larges (le titre "Kiss the French Girl"
  // n'est pas VF), cibler uniquement les motifs entre crochets/ parenthèses.
  const haystack = [title || '', detailPath || '', subtitleLangs || ''].join(' ');
  if (/vostfr/i.test(haystack)) return { isFrench: true, language: 'VOSTFR' };
  if (/\[version\s*fran[cç]ais\]|\(version\s*fran[cç]ais\)|-version-francaise-|\bvf\b|\[vf\]|\(vf\)|\[french\]|\(french\)|-vf-|-vf$/i.test(haystack)) {
    return { isFrench: true, language: 'VF' };
  }
  return { isFrench: false };
}

function mapSubject(sub: any, sectionTitle?: string): any | null {
  if (!sub) return null;
  const subjectId = sub.subjectId;
  if (!subjectId) return null;
  const corner = sub.corner ? String(sub.corner) : '';
  const detailPath = sub.detailPath || '';
  const title = sub.title || 'Unknown';
  const subtitleLangs = sub.subtitles ? String(sub.subtitles) : undefined;
  const lang = getCornerLanguage(corner, title, detailPath, subtitleLangs);
  const item: any = {
    subjectId: String(subjectId),
    detailPath,
    title,
    posterUrl: sub.cover?.url || sub.poster?.url || '',
    type: sub.subjectType === 2 ? 'series' : 'movie',
    year: sub.releaseDate?.substring(0, 4),
    rating: sub.imdbRatingValue || undefined,
    genres: sub.genre ? String(sub.genre).split(',').map((g: string) => g.trim()) : undefined,
    subtitleLangs,
    plot: sub.description || sub.introduction || undefined,
    duration: sub.duration ? `${Math.floor(Number(sub.duration) / 60)}m` : undefined,
    country: sub.countryName || undefined,
  };
  item.isFrench = lang.isFrench;
  item.language = lang.language;
  item.badge = corner || undefined;
  return item;
}

function prioritizeFrench<T extends Record<string, any>>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index, fr: item.isFrench === true }))
    .sort((a, b) => (a.fr === b.fr ? a.index - b.index : a.fr ? -1 : 1))
    .map((x) => x.item);
}

export class MovieBoxH5Scraper implements Scraper {
  config: ScraperConfig = {
    name: 'moviebox-h5api',
    version: '2.2.0',
    baseUrl: API_H5_URL,
    priority: 0,
  };

  private bearerToken: string | null = null;
  private lastTokenFetch = 0;
  private readonly TOKEN_TTL = 25 * 60 * 1000;
  private slugCache = new Map<string, string>();
  private homeFrenchCache = new Map<string, { isFrench: boolean; language?: string; badge?: string }>();
  private homeAggCache: { items: any[]; fetchedAt: number } | null = null;
  private readonly HOME_AGG_TTL = 5 * 60 * 1000;

  // Permet de générer un UUID stable par session pour les cookies lecteur
  private readonly SESSION_UUID = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

  constructor() {
    // Restaure le cache des slugs depuis Redis au démarrage
    this.restoreCaches();
  }

  private async restoreCaches(): Promise<void> {
    try {
      const slugData = await persistentGet<Record<string, string>>('slugCache');
      if (slugData) {
        for (const [k, v] of Object.entries(slugData)) this.slugCache.set(k, v);
      }
    } catch { /* premier démarrage */ }
  }

  private async persistSlugCache(): Promise<void> {
    if (this.slugCache.size > 0) {
      await persistentSet('slugCache', Object.fromEntries(this.slugCache), 86400);
    }
  }

  private rememberSlug(subjectId: string, detailPath?: string): void {
    if (subjectId && detailPath) {
      if (this.slugCache.size > 1000) this.slugCache.clear();
      this.slugCache.set(subjectId, detailPath);
      this.persistSlugCache();
    }
  }

  private async acquireBearerToken(force: boolean = false): Promise<string> {
    if (!force && this.bearerToken && Date.now() - this.lastTokenFetch < this.TOKEN_TTL) {
      return this.bearerToken;
    }

    const hosts = [...new Set([API_H5_URL, ...API_H5_MIRRORS])];
    for (const baseUrl of hosts) {
      try {
        const response = await request(`${baseUrl}${ENDPOINTS.h5Home}?host=moviebox.ph`, { headers: H5_HEADERS });
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
      } catch {}
    }

    throw new Error('Failed to acquire H5 guest bearer token from any mirror');
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

  private async authedRequest(url: string, opts: { method?: string; body?: string } = {}): Promise<any> {
    const path = url.replace(/^https?:\/\/[^\/]+/, '');
    const hosts = [...new Set([API_H5_URL, ...API_H5_MIRRORS])];

    for (const baseUrl of hosts) {
      const targetUrl = baseUrl + path;
      try {
        let headers = await this.authHeaders();
        let response = await request(targetUrl, { ...opts, headers });

        if (response.status === 401 || response.status === 403) {
          await this.acquireBearerToken(true);
          headers = await this.authHeaders();
          response = await request(targetUrl, { ...opts, headers });
        }

        if (response.status === 200) {
          this.updateTokenFromResponse(response.headers);
          return response.json();
        }
      } catch {}
    }

    throw new Error(`H5 request failed (all mirrors): ${path}`);
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
      } else {
        // SPORT_LIVE, FILTER, CUSTOM — pass-through natif
        sections.push({
          id: op.opId || opType,
          title,
          type: opType === 'SPORT_LIVE' ? 'sport' : opType === 'FILTER' ? 'filter' : 'custom',
          nativeType: opType,
          items: [],
        });
      }
    }

    for (const section of sections) {
      for (const item of section.items) {
        this.rememberSlug(item.subjectId, item.detailPath);
        if (item.isFrench || item.language || item.badge) {
          this.homeFrenchCache.set(item.subjectId, {
            isFrench: item.isFrench,
            language: item.language,
            badge: item.badge,
          });
        }
      }
    }

    // Persiste le cache VF pour survie aux cold starts Vercel
    if (this.homeFrenchCache.size > 0) {
      persistentSet('homeFrenchCache', Object.fromEntries(this.homeFrenchCache), 3600);
    }

    return { sections, tabs: CATEGORY_TABS };
  }

  async search(query: string, page: number = 1): Promise<SearchResult> {
    let items: any[] = [];
    let total = 0;

    // Essai 1 : endpoint de recherche standard
    try {
      const body = JSON.stringify({ keyword: query, page, perPage: 20 });
      const json = await this.authedRequest(`${API_H5_URL}${ENDPOINTS.h5Search}`, { method: 'POST', body });
      const inner = json?.data || {};
      const raw = inner.items || inner.list || [];
      total = inner.pager?.totalCount || inner.total || raw.length;

      items = raw
        .map((item: any) => {
          const mapped = mapSubject(item.subject || item, item.detailPath);
          if (!mapped) return null;
          const cached = this.homeFrenchCache.get(mapped.subjectId);
          if (cached && !mapped.isFrench) {
            mapped.isFrench = cached.isFrench;
            mapped.language = cached.language;
            mapped.badge = cached.badge;
          }
          return mapped;
        })
        .filter(Boolean);
    } catch (err) {
      logger.warn(`Search failed for "${query}", trying filter fallback: ${(err as Error).message}`);
    }

    // Essai 2 (fallback) : endpoint filter avec le mot-clé comme tabId=0 (tendance/Tout)
    if (items.length === 0) {
      try {
        const body = JSON.stringify({ tabId: 0, page, perPage: 20, classify: 'French dub' });
        const json = await this.authedRequest(`${API_H5_URL}${ENDPOINTS.h5Filter}`, { method: 'POST', body });
        const inner = json?.data || {};
        const raw = inner.items || inner.list || [];
        items = raw.map((sub: any) => mapSubject(sub)).filter(Boolean);
        total = inner.pager?.totalCount || inner.total || items.length;
      } catch { /* échec silencieux */ }
    }

    const sorted = prioritizeFrench(items);
    for (const item of sorted) this.rememberSlug(item.subjectId, item.detailPath);

    return { items: sorted, total, page };
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
    const lang = getCornerLanguage(corner);

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
      language: lang.language,
      isFrench: lang.isFrench,
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

    const slug = await this.resolveSlug(subjectId, detailPath);

    // Découverte du domaine de lecture avec fallback multi-miroir + cookie UUID
    let domain = 'https://netfilm.world';
    const domHosts = [...new Set([API_H5_URL, ...API_H5_MIRRORS])];
    for (const baseUrl of domHosts) {
      try {
        const response = await request(`${baseUrl}${ENDPOINTS.h5PlayDomain}`, {
          headers: { ...H5_HEADERS },
        });
        if (response.status === 200) {
          const domData = await response.json();
          domain = String(domData?.data || domain).replace(/\/$/, '');
          break;
        }
      } catch {
        continue;
      }
    }

    let playData = await this.fetchPlay(domain, subjectId, slug, se, ep);

    if (!this.hasAnyStream(playData) && se === 1 && ep === 1) {
      playData = await this.fetchPlay(domain, subjectId, slug, 0, 0);
    }
    const rawStreams = [...(playData.streams || []), ...(playData.dash || []), ...(playData.hls || [])];


    const seen = new Set<string>();
    const sources = rawStreams.map((s: any) => ({
      id: s.id || undefined,
      url: s.url || '',
      format: s.format === 'HLS' ? 'HLS' : s.format === 'DASH' ? 'DASH' : 'MP4',
      // DASH/HLS adaptatif : `resolutions` peut lister plusieurs valeurs
      // ("1080,720,480"). On prend le MAX (pas de concaténation en un nombre géant
      // "1080720480" qui faisait rejeter la source par le lecteur → repli sur MP4).
      quality: (() => {
        const nums = String(s.resolutions || '').split(/[^0-9]+/).filter(Boolean)
          .map(Number).filter((n) => n > 0 && n <= 4320);
        return nums.length ? Math.max(...nums) : 0;
      })(),
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

  /**
   * Agrège toutes les sections de contenu du home francophone en une liste
   * unique dédoublonnée, triée French-first, musique exclue. Mise en cache
   * (TTL court). C'est la SEULE source VF fiable : l'endpoint `/subject/filter`
   * ignore le filtre `classify=French dub` et renvoie de la musique / du
   * contenu anglophone (vérifié en sondant l'upstream).
   */
  private async getHomeAggregatedItems(): Promise<any[]> {
    if (this.homeAggCache && Date.now() - this.homeAggCache.fetchedAt < this.HOME_AGG_TTL) {
      return this.homeAggCache.items;
    }

    const json = await this.authedRequest(`${API_H5_URL}${ENDPOINTS.h5Home}?host=moviebox.ph`);
    const operatingList = json?.data?.operatingList || [];

    const byId = new Map<string, any>();
    for (const op of operatingList) {
      if (!['SUBJECTS_MOVIE', 'SUBJECTS_TV', 'SUBJECTS_ANIMATION'].includes(op.type)) continue;
      for (const sub of op.subjects || []) {
        // subjectType 6 = musique : jamais dans l'Explorer d'une app de films
        if (sub?.subjectType === 6) continue;
        const item = mapSubject(sub);
        if (!item) continue;
        if (!byId.has(item.subjectId)) byId.set(item.subjectId, item);
      }
    }

    const items = prioritizeFrench([...byId.values()]);
    for (const item of items) {
      this.rememberSlug(item.subjectId, item.detailPath);
      if (item.isFrench || item.language || item.badge) {
        this.homeFrenchCache.set(item.subjectId, {
          isFrench: item.isFrench, language: item.language, badge: item.badge,
        });
      }
    }

    this.homeAggCache = { items, fetchedAt: Date.now() };
    return items;
  }

  /**
   * Explorer / Recommandations : pagination côté serveur de l'agrégation du
   * home francophone. tabId = trending (tout) / movies / series.
   */
  async category(tabId: string, page: number = 1): Promise<{ items: any[]; page: number; hasMore: boolean }> {
    const perPage = 24;
    const all = await this.getHomeAggregatedItems();

    const filtered = tabId === 'movies'
      ? all.filter((i) => i.type === 'movie')
      : tabId === 'series'
        ? all.filter((i) => i.type === 'series')
        : all; // trending / défaut : tout

    const start = (page - 1) * perPage;
    const items = filtered.slice(start, start + perPage);
    const hasMore = start + perPage < filtered.length;

    return { items, page, hasMore };
  }

  /**
   * Requête vers les endpoints du site web (hôte API_WEB_URL). Ces endpoints
   * n'exigent pas de token bearer, seulement le géo-spoof. Essaie chaque miroir.
   */
  private async webRequest(path: string, referer?: string): Promise<any> {
    const hosts = [...new Set([API_WEB_URL, ...API_WEB_MIRRORS])];
    for (const baseUrl of hosts) {
      try {
        const headers = { ...H5_HEADERS, ...(referer ? { Referer: referer } : {}) };
        const response = await request(`${baseUrl}${path}`, { headers });
        if (response.status === 200) return response.json();
      } catch {}
    }
    throw new Error(`Web request failed (all mirrors): ${path}`);
  }

  /**
   * Recommandations « Pour vous » pour un titre donné (endpoint web detail-rec).
   * Enrichit la VF depuis le cache home et trie French-first.
   */
  async recommendations(subjectId: string, page: number = 1): Promise<{ items: any[]; page: number; hasMore: boolean }> {
    const perPage = 18;
    const json = await this.webRequest(
      `${ENDPOINTS.webDetailRec}?subjectId=${subjectId}&page=${page}&perPage=${perPage}`
    );
    const inner = json?.data || {};
    const raw = inner.items || inner.subjects || inner.list || [];

    const items = raw.map((entry: any) => {
      const item = mapSubject(entry.subject || entry);
      if (!item) return null;
      const cached = this.homeFrenchCache.get(item.subjectId);
      if (cached && !item.isFrench) {
        item.isFrench = cached.isFrench;
        item.language = cached.language;
        item.badge = cached.badge;
      }
      return item;
    }).filter(Boolean);

    // webDetailRec ne fournit NI corner NI titre localisé (titres anglais) →
    // badge VF manquant côté app et titres affichés en anglais. Le détail h5,
    // lui, renvoie le titre français + le corner (« En français »/« VOSTFR »)
    // quand le contenu est doublé : on enrichit les items dont la langue est
    // inconnue (un seul appel h5 par item, mis en cache pour les requêtes
    // suivantes). En cas d'échec → on garde l'item tel quel (pas de régression).
    // Plafonné à 8 appels parallèles max (pas les 18 de perPage) : chaque appel
    // est un /subject/detail complet côté upstream, et un burst non borné sur
    // le scraper h5 PRIMAIRE (dont dépend tout le streaming VF) risquerait de
    // déclencher un rate-limit upstream ou d'approcher le maxDuration Vercel
    // (30s) sur cache froid. 8 couvre déjà largement ce qui est visible sans
    // scroller sur la grille "Pour vous".
    const missing = items
      .filter((i: any) => !i.language && !this.homeFrenchCache.get(i.subjectId))
      .slice(0, 8);
    if (missing.length > 0) {
      const settled = await Promise.allSettled(missing.map((m: any) => this.detail(m.subjectId)));
      settled.forEach((r, idx) => {
        if (r.status !== 'fulfilled') return;
        const d = r.value;
        const item = missing[idx];
        if (!d?.title && !d?.language) return;
        item.title = d.title || item.title;
        item.detailPath = d.detailPath || item.detailPath;
        item.posterUrl = d.posterUrl || item.posterUrl;
        // Corner du détail h5 (fiable) ; sinon marqueurs dans le titre localisé
        // (« [Version française] », « [VF] », « [VOSTFR] »).
        const lang = d.language === 'VF' || d.language === 'VOSTFR'
          ? { isFrench: d.isFrench, language: d.language }
          : getCornerLanguage('', d.title || item.title, d.detailPath || item.detailPath, d.subtitleLangs);
        item.isFrench = lang.isFrench;
        item.language = lang.language;
        item.badge = lang.language || item.badge;
        this.homeFrenchCache.set(item.subjectId, {
          isFrench: lang.isFrench,
          language: lang.language,
          badge: lang.language,
        });
      });
    }

    for (const item of items) this.rememberSlug(item.subjectId, item.detailPath);

    const pager = inner.pager || {};
    const total = pager.totalCount || inner.total || items.length;
    return { items: prioritizeFrench(items), page, hasMore: page * perPage < total };
  }

  /**
   * Liste directe des fichiers téléchargeables (MP4 par qualité + taille exacte)
   * pour un film/épisode, via l'endpoint web download. Plus fiable que de parser
   * les streams de /subject/play pour le téléchargement.
   */
  async downloads(subjectId: string, season?: number, episode?: number, detailPath?: string): Promise<{ files: any[]; captions: any[]; hasResource: boolean }> {
    const se = season ?? 0;
    const ep = episode ?? 0;
    const slug = await this.resolveSlug(subjectId, detailPath);
    // Le Referer /movies/<slug> est OBLIGATOIRE, sinon réponse vide
    const referer = `${API_WEB_URL}/movies/${slug}`;

    const json = await this.webRequest(
      `${ENDPOINTS.webDownload}?subjectId=${subjectId}&se=${se}&ep=${ep}`,
      referer
    );
    const data = json?.data || {};
    const rawDownloads = data.downloads || [];

    const files = rawDownloads.map((d: any) => ({
      id: d.id ? String(d.id) : undefined,
      url: d.url || '',
      format: 'MP4',
      quality: Number(d.resolution) || 0,
      size: d.size ? Number(d.size) : undefined,
      duration: d.duration ? Number(d.duration) : undefined,
    })).filter((f: any) => f.url);

    const captions = (data.captions || []).map((c: any) => ({
      url: c.url || '',
      language: c.lanName || c.language || c.lan || 'Unknown',
    })).filter((c: any) => c.url);

    return { files, captions, hasResource: data.hasResource ?? files.length > 0 };
  }
}
