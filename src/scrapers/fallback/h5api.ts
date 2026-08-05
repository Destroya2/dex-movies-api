import { request } from '../../utils/http';
import { API_H5_URL, API_H5_MIRRORS, API_WEB_URL, API_WEB_MIRRORS, ENDPOINTS, SUBJECT_TYPE } from '../../config/constants';
import { Scraper, ScraperConfig, HomeResult, SearchResult, SuggestResult, DetailResult, StreamResult } from '../base';
import { persistentGet, persistentSet } from '../../middleware/persistentCache';
import { logger } from '../../middleware/logger';
import { currentProfile, geoSpoofHeaders } from '../../config/geo';
import { audioTrackOf, orderByAudioTrack } from '../../utils/streamSources';

const UA_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

/**
 * Les en-têtes sont désormais construits À CHAQUE APPEL, et non figés au
 * chargement du module : l'IP de géo-spoof et la langue dépendent du profil
 * géographique de la requête en cours (voir config/geo.ts). C'est ce qui permet
 * à la fois de servir le bon catalogue selon la langue de l'appareil ET de faire
 * tourner plusieurs IP au lieu d'une seule.
 */
function h5Headers(): Record<string, string> {
  const profile = currentProfile();
  return {
    'User-Agent': UA_CHROME,
    'Referer': 'https://moviebox.ph/',
    'Origin': 'https://moviebox.ph',
    'X-Client-Info': `{"timezone":"${profile.code === 'fr' ? 'Africa/Ouagadougou' : 'Etc/UTC'}"}`,
    'X-Request-Lang': profile.upstreamLang,
    'X-Client-Type': 'h5',
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'sec-ch-ua': '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    ...geoSpoofHeaders(),
  };
}

function playerHeaders(): Record<string, string> {
  const profile = currentProfile();
  return {
    'User-Agent': UA_CHROME,
    'Accept': 'application/json',
    'Accept-Language': profile.code === 'fr'
      ? 'fr-FR,fr;q=0.9,en;q=0.8'
      : `${profile.upstreamLang},en;q=0.8`,
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'X-Client-Info': `{"timezone":"${profile.code === 'fr' ? 'Africa/Ouagadougou' : 'Etc/UTC'}"}`,
    'X-Source': '',
    'sec-ch-ua': '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    ...geoSpoofHeaders(),
  };
}

const CATEGORY_TABS: { id: string; title: string }[] = [
  { id: 'trending', title: 'Trending' },
  { id: 'movies', title: 'Movies' },
  { id: 'series', title: 'TV Series' },
];

/**
 * Fiches connues comme CASSÉES côté upstream (catalogue MovieBox) :
 * subjectId → raison. Leur ressource vidéo est erronée (fichier d'un autre
 * film) ou absente. Exclues de la recherche, des recommandations et des
 * candidats du bridge TMDB — mieux vaut pas de résultat qu'un mauvais fichier.
 * À enrichir au fil des signalements utilisateur.
 */
const BROKEN_SUBJECTS: Record<string, string> = {
  '5785946876918776912': 'Ressource vidéo d\'un autre film (upstream)',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

/**
 * Décode les entités HTML des titres upstream. Les rails CUSTOM (contenus
 * courts) renvoient des titres bruts non décodés — « Jackie Chan &amp; John
 * Cena » s'affichait tel quel dans l'app.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function mapSubject(sub: any, sectionTitle?: string): any | null {
  if (!sub) return null;
  const subjectId = sub.subjectId;
  if (!subjectId) return null;
  const corner = sub.corner ? String(sub.corner) : '';
  const detailPath = sub.detailPath || '';
  const title = decodeEntities(sub.title || 'Unknown');
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
        const response = await request(`${baseUrl}${ENDPOINTS.h5Home}?host=moviebox.ph`, { headers: h5Headers() });
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
    return { ...h5Headers(), 'Authorization': `Bearer ${token}` };
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
      } else if (opType === 'CUSTOM' && (op.customData?.items?.length || 0) > 0) {
        // ⚠️ Les rails CUSTOM ne rangent PAS leur contenu dans `subjects` (toujours
        // vide) mais dans `customData.items[]`, chaque entrée portant son propre
        // `subject` + une image d'affiche dédiée. Ils étaient donc renvoyés VIDES
        // (`items: []`) et disparaissaient de l'accueil de l'app, alors qu'ils
        // s'affichent dans l'app officielle : 165 éléments perdus sur un relevé du
        // 05/08/2026, dont 41 films/séries bien lisibles (« Jurassic World:
        // Rebirth [Version française] », « Moana », « Miraculous »…).
        // Types conservés : films (1), séries (2), éducation/jeunesse (5) et
        // formats courts (9 — replays WWE, extraits : vérifiés lisibles via
        // /stream). La MUSIQUE (6) reste exclue, comme partout ailleurs.
        const items = (op.customData.items || [])
          .map((entry: any) => {
            const sub = entry.subject;
            if (!sub || sub.subjectType === SUBJECT_TYPE.MUSIC) return null;
            const mapped = mapSubject(sub);
            if (!mapped) return null;
            // L'affiche du rail est souvent une image dédiée (format paysage) :
            // on la garde en couverture sans écraser le poster vertical.
            if (entry.image?.url) mapped.coverUrl = entry.image.url;
            if (entry.title) mapped.title = decodeEntities(entry.title);
            return mapped;
          })
          .filter(Boolean);
        if (items.length > 0) {
          sections.push({ id: op.opId || 'custom', title, type: 'row', items });
        }
      } else {
        // SPORT_LIVE, FILTER, CUSTOM sans contenu — pass-through natif
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
    // ⚠️ La pagination upstream est ERRATIQUE : page 1 renvoie parfois 2 items
    // malgré totalCount > 100, et le perPage demandé est ignoré/recadré (2, 4,
    // 6, 10 items selon les appels). On page donc JUSQU'À ÉPUISEMENT (hasMore)
    // et on déduplique — sinon une recherche comme "spider man" n'afficherait
    // que 2 résultats sur les 38 titres réellement disponibles.
    const MAX_UPSTREAM_PAGES = 12;
    // Budget de temps EN PLUS du plafond de pages : 12 pages × (appel + 150 ms)
    // pouvaient dépasser 7 s en prod, sur une fonction Vercel qui coupe à 30 s.
    // Quand l'upstream ralentit, mieux vaut rendre 25 résultats tout de suite
    // que 38 après un timeout. On s'arrête donc au premier des deux plafonds.
    const SEARCH_BUDGET_MS = 8_000;
    // Cible de résultats UNIQUES. La pagination exhaustive existait pour une
    // bonne raison (« spider man » ne rendait que 2 titres sur 38 disponibles),
    // mais aller jusqu'à l'épuisement coûte ~6,2 s en prod alors qu'aucun client
    // ne pagine la recherche : l'app affiche une grille, la PWA aussi. On
    // s'arrête donc dès qu'on a de quoi remplir largement l'écran.
    // ⚠️ NE PAS paralléliser ces pages : tout le trafic sort par UNE seule IP
    // de géo-spoof, et la faire rate-limiter couperait le catalogue VF entier.
    const TARGET_UNIQUE = 40;
    const startedAt = Date.now();
    const seen = new Map<string, any>();
    let total = 0;

    // Essai 1 : endpoint de recherche standard
    try {
      for (let p = 1; p <= MAX_UPSTREAM_PAGES; p++) {
        const body = JSON.stringify({ keyword: query, page: p, perPage: 20 });
        const json = await this.authedRequest(`${API_H5_URL}${ENDPOINTS.h5Search}`, { method: 'POST', body });
        const inner = json?.data || {};
        const raw = inner.items || inner.list || [];
        total = inner.pager?.totalCount || inner.total || raw.length;

        for (const entry of raw) {
          const sub = entry.subject || entry;
          // subjectType 6 = musique (clips, chansons) : jamais en recherche film
          if (sub?.subjectType === 6) continue;
          const mapped = mapSubject(sub, entry.detailPath);
          if (!mapped) continue;
          if (BROKEN_SUBJECTS[mapped.subjectId]) continue;
          const cached = this.homeFrenchCache.get(mapped.subjectId);
          if (cached && !mapped.isFrench) {
            mapped.isFrench = cached.isFrench;
            mapped.language = cached.language;
            mapped.badge = cached.badge;
          }
          if (!seen.has(mapped.subjectId)) seen.set(mapped.subjectId, mapped);
        }

        const hasMore = inner.pager?.hasMore === true;
        if (!hasMore || p >= MAX_UPSTREAM_PAGES) break;
        if (seen.size >= TARGET_UNIQUE) {
          logger.info(`Recherche "${query}" : ${seen.size} résultats uniques après ${p} page(s), arrêt anticipé`);
          break;
        }
        if (Date.now() - startedAt > SEARCH_BUDGET_MS) {
          logger.warn(`Recherche "${query}" : budget de ${SEARCH_BUDGET_MS}ms atteint après ${p} page(s), ${seen.size} résultat(s) rendus`);
          break;
        }
        await sleep(150); // évite de se faire bloquer par l'upstream
      }
    } catch (err) {
      logger.warn(`Search failed for "${query}", trying filter fallback: ${(err as Error).message}`);
    }

    // Essai 2 (fallback) : endpoint filter avec le mot-clé comme tabId=0 (tendance/Tout)
    if (seen.size === 0) {
      try {
        const body = JSON.stringify({ tabId: 0, page: 1, perPage: 20, classify: 'French dub' });
        const json = await this.authedRequest(`${API_H5_URL}${ENDPOINTS.h5Filter}`, { method: 'POST', body });
        const inner = json?.data || {};
        const raw = inner.items || inner.list || [];
        for (const entry of raw) {
          const sub = entry.subject || entry;
          if (sub?.subjectType === 6) continue;
          const mapped = mapSubject(sub);
          if (!mapped || BROKEN_SUBJECTS[mapped.subjectId]) continue;
          if (!seen.has(mapped.subjectId)) seen.set(mapped.subjectId, mapped);
        }
        total = inner.pager?.totalCount || inner.total || seen.size;
      } catch { /* échec silencieux */ }
    }

    const all = [...seen.values()];
    const sorted = prioritizeFrench(all);
    for (const item of sorted) this.rememberSlug(item.subjectId, item.detailPath);

    // Pagination applicative sur l'ensemble collecté (20/page) — l'app garde un
    // contrat stable même si la pagination upstream est erratique.
    const perPage = 20;
    const start = (page - 1) * perPage;
    const items = sorted.slice(start, start + perPage);

    return { items, total: all.length, page };
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
    // Fiche cassée : détail vide → l'app (résiliente) garde les infos de la
    // liste et la lecture est bloquée par stream().
    if (BROKEN_SUBJECTS[String(subjectId)]) {
      logger.warn(`Detail refusé pour la fiche cassée ${subjectId} (${BROKEN_SUBJECTS[String(subjectId)]})`);
      return {
        subjectId: String(subjectId), title: '', posterUrl: '', type: 'movie',
        dubs: [], freeEpisodes: 0,
      };
    }

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

  private async fetchPlay(domain: string, subjectId: string, slug: string, se: number, ep: number): Promise<any> {
    const playerReferer = `${domain}/spa/videoPlayPage/movies/${slug}?id=${subjectId}&type=/movie/detail&detailSe=${se}&detailEp=${ep}&lang=en`;
    const playUrl = `${domain}${ENDPOINTS.h5Play}?subjectId=${subjectId}&se=${se}&ep=${ep}&detailPath=${slug}`;

    const playResponse = await request(playUrl, {
      headers: { ...playerHeaders(), 'Referer': playerReferer },
    });

    if (playResponse.status !== 200) {
      throw new Error(`H5 play failed: ${playResponse.status}`);
    }

    const playJson = await playResponse.json();
    return playJson?.data || {};
  }

  async stream(subjectId: string, season?: number, episode?: number, detailPath?: string): Promise<StreamResult> {
    // Fiche connue comme cassée côté upstream (ressource d'un autre film) :
    // on ne renvoie AUCUNE source — jamais le mauvais fichier au lecteur.
    if (BROKEN_SUBJECTS[String(subjectId)]) {
      logger.warn(`Stream refusé pour la fiche cassée ${subjectId} (${BROKEN_SUBJECTS[String(subjectId)]})`);
      return { sources: [], dubs: [], subtitles: [], hasResource: false, freeEpisodes: 0 };
    }

    const se = season ?? 1;
    const ep = episode ?? 1;

    const slug = await this.resolveSlug(subjectId, detailPath);

    // Découverte du domaine de lecture avec fallback multi-miroir + cookie UUID
    let domain = 'https://netfilm.world';
    const domHosts = [...new Set([API_H5_URL, ...API_H5_MIRRORS])];
    for (const baseUrl of domHosts) {
      try {
        const response = await request(`${baseUrl}${ENDPOINTS.h5PlayDomain}`, {
          headers: { ...h5Headers() },
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

    // ⚠️ Le domaine de lecture découvert (ex. netfilm.world) renvoie parfois des
    // streams SANS URL exploitable (`vipLocked`, signCookie à remplir — observé
    // sur les séries S1E1), alors que l'API h5 (h5-api.aoneroom.com) renvoie
    // l'URL signée pour le même contenu. → on essaie chaque hôte (domaine
    // découvert puis API + miroirs) jusqu'à obtenir une source à URL non vide.
    const playHosts = [...new Set([domain, API_H5_URL, ...API_H5_MIRRORS])];

    const tryPlay = async (se2: number, ep2: number): Promise<{ playData: any; rawStreams: any[] }> => {
      let lastPd: any = {};
      for (const host of playHosts) {
        try {
          const pd = await this.fetchPlay(host, subjectId, slug, se2, ep2);
          lastPd = pd;
          const rs = [...(pd.streams || []), ...(pd.dash || []), ...(pd.hls || [])];
          if (rs.some((s: any) => !!s.url)) {
            return { playData: pd, rawStreams: rs };
          }
        } catch {
          continue;
        }
      }
      return { playData: lastPd, rawStreams: [] };
    };

    let { playData, rawStreams } = await tryPlay(se, ep);
    // Films / appels par défaut (se=1, ep=1) : si aucune source exploitable,
    // retenter en mode "film" (se=0, ep=0) comme le fait l'upstream.
    if (rawStreams.length === 0 && se === 1 && ep === 1) {
      ({ playData, rawStreams } = await tryPlay(0, 0));
    }


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
      audioTrack: audioTrackOf(s.url || ''),
    })).filter((s: any) => {
      if (!s.url || seen.has(s.url)) return false;
      seen.add(s.url);
      return true;
    });

    // Doublages de langue inconnue déclassés derrière les pistes d'origine.
    const ordered = orderByAudioTrack(sources);

    // ⚠️ PAS de validation HTTP des sources ici : testée puis retirée — le CDN
    // (hakunaymatata.com) renvoie des 403 incohérents (rate-limit par IP, sign
    // volatil) qui faisaient jeter des sources VALIDES et cassaient la lecture.
    // La fiabilité est assurée autrement : blocklist BROKEN_SUBJECTS (fiches
    // upstream erronées) côté backend + failover multi-source côté lecteur.

    const subtitles = await this.fetchCaptions(subjectId, slug, ordered[0]);

    return {
      sources: ordered,
      dubs: [],
      subtitles,
      hasResource: ordered.length > 0,
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
        if (BROKEN_SUBJECTS[String(sub?.subjectId)]) continue;
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
        const headers = { ...h5Headers(), ...(referer ? { Referer: referer } : {}) };
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
      if (BROKEN_SUBJECTS[item.subjectId]) return null;
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
