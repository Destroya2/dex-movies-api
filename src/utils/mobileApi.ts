import { request } from './http';
import { logger } from '../middleware/logger';
import { generateXClientToken, generateXTrSignature } from './crypto';
import { runResilient, hostKey, CircuitOpenError } from './resilience';

/**
 * Client de l'API MOBILE MovieBox (`/wefeed-mobile-bff/`, signature HMAC).
 *
 * Longtemps documentée comme « morte / clés pivotées » dans ce projet : c'était
 * faux. Elle répond avec nos clés HMAC d'origine — trois détails la rendaient
 * inaccessible, tous vérifiés le 05/08/2026 :
 *
 * 1. **L'hôte.** `api3.aoneroom.com` (celui par défaut historiquement) renvoie
 *    404 sur TOUTES les routes. Ceux qui répondent : api4, api5, api6, api4sg,
 *    api.inmoviebox.com.
 * 2. **Le token invité.** Il faut d'abord appeler `tab-operating` et lire le
 *    header de réponse `x-user` (même mécanique que le scraper h5), puis envoyer
 *    `Authorization: Bearer <token>`. Sans lui, tous les `subject-api/*`
 *    répondent **441**.
 * 3. **`sp_code` doit rester VIDE.** Le renseigner (`40401`, valeur vue dans une
 *    doc de rétro-ingénierie) bascule sur le cluster INDIEN : catalogue Hindi/CAM,
 *    zéro VF. Vide + `region: BF` + `system_language: fr` → catalogue francophone.
 *
 * Ce que ça apporte et que l'API h5 ne sait pas faire : un **catalogue VF paginé
 * et rangé par catégories françaises réelles** (Tendance, Top 200, Box Office
 * 2025, Animation, Action, Comédie, Horreur, Arts Martiaux, Romance) — mesuré à
 * 99 % de titres VF, là où `/subject/filter` (h5) ignore `classify=French dub`.
 *
 * ⚠️ Cette API ne remplace PAS le scraper h5 primaire : elle vient EN PLUS,
 * derrière ses propres routes, pour ne pas mettre le streaming en risque.
 */

// api3 volontairement absent : 404 sur toutes les routes (vérifié).
const MOBILE_HOSTS = [
  'https://api4.aoneroom.com',
  'https://api5.aoneroom.com',
  'https://api6.aoneroom.com',
  'https://api4sg.aoneroom.com',
  'https://api.inmoviebox.com',
];

const SPOOF_IP = process.env.SPOOF_IP || '196.28.244.1';

// Identité d'appareil alignée sur l'app officielle. `sp_code` VIDE = catalogue
// francophone (voir en-tête). Ne pas « compléter » ce champ.
const CLIENT_INFO = JSON.stringify({
  package_name: 'com.community.oneroom',
  version_name: '3.0.11.1230.03',
  version_code: 50020042,
  os: 'android',
  os_version: '12',
  install_ch: 'ps',
  device_id: 'a3f1c8e94b7d02516ac9e83f47b21d60',
  install_store: 'ps',
  gaid: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  brand: 'Redmi',
  model: '2201117TG',
  system_language: 'fr',
  net: 'NETWORK_WIFI',
  region: 'BF',
  timezone: 'Africa/Ouagadougou',
  sp_code: '',
  'X-Play-Mode': '2',
});

const TOKEN_TTL_MS = 25 * 60 * 1000;

// Relais résidentiel : l'API mobile répond depuis une IP domestique mais PAS
// depuis les IP datacenter de Vercel (vérifié en prod — aucun hôte ne délivre de
// token invité). Le Raspberry Pi relaie donc la requête DÉJÀ SIGNÉE : la
// signature HMAC ne dépend que de la méthode, des en-têtes et de l'URL, jamais
// de l'IP. Sans relais configuré, on reste en appel direct (cas du dev local,
// qui marche puisque l'IP est résidentielle).
const RELAY_BASE = (process.env.FALLBACK_RESOLVER_URL || '').replace(/\/$/, '');
const RELAY_TOKEN = process.env.RESOLVER_TOKEN || '';

let guestToken: string | null = null;
let tokenFetchedAt = 0;
let activeHost: string | null = null;
// null = pas encore tranché ; true = l'appel direct est bloqué ici, passer par
// le relais sans perdre de temps à réessayer en direct à chaque requête.
let useRelay: boolean | null = null;

interface RawResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Appel direct (IP du serveur), sous disjoncteur par hôte : un hôte mort
 * (`api3` a basculé en 404 du jour au lendemain) est écarté pendant 60 s au lieu
 * de coûter son timeout complet à chaque requête utilisateur.
 */
async function directCall(
  url: string,
  headers: Record<string, string>,
  upstream?: { method: 'POST'; body: string },
): Promise<RawResponse | null> {
  try {
    return await runResilient(
      `mobile:${hostKey(url)}`,
      async () => {
        const resp = await request(url, {
          headers,
          timeout: 12000,
          method: upstream?.method,
          body: upstream?.body,
        });
        // 404/441 = réponse de l'hôte, pas une panne : ne pas pénaliser le circuit.
        return { status: resp.status, headers: resp.headers, body: resp.body };
      },
      { attempts: 2, backoffMs: 250 }
    );
  } catch (e: any) {
    if (!(e instanceof CircuitOpenError)) {
      logger.warn(`API mobile (direct) ${url} : ${e?.message || e}`);
    }
    return null;
  }
}

/** Même appel, relayé par le Pi (IP résidentielle). */
async function relayCall(
  url: string,
  headers: Record<string, string>,
  upstream?: { method: 'POST'; body: string },
): Promise<RawResponse | null> {
  if (!RELAY_BASE) return null;
  try {
    const resp = await request(
      `${RELAY_BASE}/relay${RELAY_TOKEN ? `?key=${encodeURIComponent(RELAY_TOKEN)}` : ''}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // `method`/`body` décrivent la requête à REJOUER en amont, à ne pas
        // confondre avec le POST qui porte l'enveloppe jusqu'au Pi.
        body: JSON.stringify({ url, headers, method: upstream?.method, body: upstream?.body }),
        timeout: 25000,
      }
    );
    if (resp.status !== 200) return null;
    const j = JSON.parse(resp.body);
    if (typeof j?.status !== 'number') return null;
    return { status: j.status, headers: j.headers || {}, body: j.body || '' };
  } catch (e: any) {
    logger.warn(`API mobile (relais Pi) ${url} : ${e?.message || e}`);
    return null;
  }
}

/**
 * Exécute l'appel par le chemin qui marche : direct si possible, relais Pi
 * sinon. La bascule est mémorisée pour ne pas retenter le direct à chaque fois.
 */
async function call(
  url: string,
  headers: Record<string, string>,
  upstream?: { method: 'POST'; body: string },
): Promise<RawResponse | null> {
  if (useRelay === true) return relayCall(url, headers, upstream);
  const direct = await directCall(url, headers, upstream);
  if (direct && direct.status !== 403 && direct.status !== 0) {
    if (useRelay === null) useRelay = false;
    return direct;
  }
  const relayed = await relayCall(url, headers, upstream);
  if (relayed) {
    if (!useRelay) logger.info('API mobile : appel direct bloqué, bascule sur le relais Pi');
    useRelay = true;
    return relayed;
  }
  return direct;
}

function buildHeaders(
  host: string,
  url: string,
  token?: string | null,
  upstream?: { method: 'POST'; body: string },
): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': 'MovieBoxPro/16.2.1 (Android 12; Pixel 6)',
    'X-M-Version': '16.2.1',
    Accept: 'application/json',
    'Content-Type': 'application/json;charset=UTF-8',
    Referer: `${host}/`,
    'x-client-token': generateXClientToken(),
    // La signature couvre la MÉTHODE et le CORPS : signer un POST comme un GET
    // donne une signature valide en apparence et un 4xx côté serveur.
    'x-tr-signature': generateXTrSignature(
      upstream?.method || 'GET',
      'application/json',
      'application/json;charset=UTF-8',
      url,
      upstream?.body ?? null,
      false,
    ),
    'x-client-info': CLIENT_INFO,
    'x-client-status': '0',
    'X-Play-Mode': '2',
    // Géo-spoof francophone, comme partout ailleurs (règle d'or du projet).
    'X-Forwarded-For': SPOOF_IP,
    'CF-Connecting-IP': SPOOF_IP,
    'X-Real-IP': SPOOF_IP,
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

/**
 * Récupère (et met en cache) le token invité. Il arrive dans le header `x-user`
 * de n'importe quel appel non authentifié — on utilise `tab-operating`, le seul
 * endpoint qui répond sans token.
 */
async function acquireGuestToken(force = false): Promise<string | null> {
  if (!force && guestToken && Date.now() - tokenFetchedAt < TOKEN_TTL_MS) return guestToken;

  const hosts = activeHost ? [activeHost, ...MOBILE_HOSTS.filter((h) => h !== activeHost)] : MOBILE_HOSTS;

  const tryAll = async (): Promise<string | null> => {
    for (const host of hosts) {
      const url = `${host}/wefeed-mobile-bff/tab-operating?page=1&tabId=0&version=`;
      const resp = await call(url, buildHeaders(host, url));
      if (!resp || resp.status !== 200) continue;
      const xUser = resp.headers['x-user'];
      if (!xUser) continue;
      try {
        const token = JSON.parse(String(xUser)).token;
        if (!token) continue;
        guestToken = token;
        tokenFetchedAt = Date.now();
        activeHost = host;
        logger.info(`API mobile : token invité obtenu via ${host}${useRelay ? ' (relais Pi)' : ''}`);
        return token;
      } catch { /* x-user illisible : hôte suivant */ }
    }
    return null;
  };

  const direct = await tryAll();
  if (direct) return direct;

  // Aucun hôte n'a délivré de token en direct. Ce n'est pas forcément une erreur
  // réseau : depuis Vercel, l'upstream répond 200 mais SANS `x-user` — il faut
  // donc forcer la bascule sur le relais résidentiel, la détection par code
  // d'erreur de `call()` ne suffit pas à voir ce cas.
  if (RELAY_BASE && useRelay !== true) {
    logger.info('API mobile : aucun token en direct, nouvelle tentative via le relais Pi');
    useRelay = true;
    const relayed = await tryAll();
    if (relayed) return relayed;
    useRelay = null; // le relais non plus : on laissera une prochaine requête retenter
  }
  return null;
}

/**
 * GET signé avec token invité, bascule d'hôte automatique et retry sur 441.
 *
 * Exporté : c'est LE transport de l'API mobile qui fonctionne réellement en
 * production (bascule direct → relais Pi, pool d'hôtes, disjoncteurs). Le
 * scraper `scrapers/moviebox/` s'appuie dessus au lieu de refaire un appel
 * direct de son côté — le direct est bloqué depuis Vercel.
 */
export async function mobileApiGet(path: string): Promise<any | null> {
  const token = await acquireGuestToken();
  if (!token) return null;

  const hosts = activeHost ? [activeHost, ...MOBILE_HOSTS.filter((h) => h !== activeHost)] : MOBILE_HOSTS;
  for (const host of hosts) {
    const url = `${host}${path}`;
    const resp = await call(url, buildHeaders(host, url, token));
    if (!resp) continue;
    // 441 = token refusé/expiré → on en redemande un et on retente une fois.
    if (resp.status === 441) {
      const fresh = await acquireGuestToken(true);
      if (!fresh) continue;
      const retry = await call(url, buildHeaders(host, url, fresh));
      if (!retry || retry.status !== 200) continue;
      try { return JSON.parse(retry.body); } catch { continue; }
    }
    if (resp.status !== 200) continue;
    activeHost = host;
    try {
      const parsed = JSON.parse(resp.body);
      return parsed;
    } catch { continue; }
  }
  return null;
}

/**
 * Même chose, mais renvoie la réponse BRUTE (statut + en-têtes + corps).
 *
 * Nécessaire pour lire l'en-tête `x-user` : c'est là que MovieBox glisse le
 * jeton porteur d'un sujet, jamais dans le corps.
 */
export async function mobileApiRaw(path: string): Promise<RawResponse | null> {
  const token = await acquireGuestToken();
  const hosts = activeHost ? [activeHost, ...MOBILE_HOSTS.filter((h) => h !== activeHost)] : MOBILE_HOSTS;
  for (const host of hosts) {
    const url = `${host}${path}`;
    const resp = await call(url, buildHeaders(host, url, token));
    if (!resp) continue;
    if (resp.status === 200) {
      activeHost = host;
      return resp;
    }
  }
  return null;
}

/**
 * GET signé avec un jeton PORTEUR précis (celui d'un sujet) et des en-têtes
 * supplémentaires. `play-info` en a besoin : le jeton invité global ne lui
 * suffit pas toujours.
 */
export async function mobileApiGetAs(
  path: string,
  token: string,
  extraHeaders: Record<string, string> = {},
): Promise<RawResponse | null> {
  const hosts = activeHost ? [activeHost, ...MOBILE_HOSTS.filter((h) => h !== activeHost)] : MOBILE_HOSTS;
  for (const host of hosts) {
    const url = `${host}${path}`;
    const resp = await call(url, { ...buildHeaders(host, url, token), ...extraHeaders });
    if (!resp) continue;
    if (resp.status === 200) {
      activeHost = host;
      return resp;
    }
    // 441 = jeton refusé : inutile d'essayer les autres hôtes avec le même.
    if (resp.status === 441) return resp;
  }
  return null;
}

/**
 * POST signé (jeton invité), même chemin réseau que les GET.
 *
 * La recherche de l'API mobile (`subject-api/search/v2`) est un POST : sans
 * cela, elle retombait systématiquement sur le scraper h5.
 */
export async function mobileApiPost(path: string, body: any): Promise<any | null> {
  const token = await acquireGuestToken();
  if (!token) return null;
  const payload = JSON.stringify(body);
  const hosts = activeHost ? [activeHost, ...MOBILE_HOSTS.filter((h) => h !== activeHost)] : MOBILE_HOSTS;
  for (const host of hosts) {
    const url = `${host}${path}`;
    const up = { method: 'POST' as const, body: payload };
    const resp = await call(url, buildHeaders(host, url, token, up), up);
    if (!resp || resp.status !== 200) continue;
    activeHost = host;
    try { return JSON.parse(resp.body); } catch { continue; }
  }
  return null;
}

/**
 * Jeton invité courant (en obtient un si besoin).
 *
 * `play-info` l'accepte : vérifié le 06/08/2026, il renvoie le même `streams`
 * qu'avec un jeton propre au sujet. C'est le repli quand la fiche ne fournit
 * pas d'en-tête `x-user` — ce qui est le cas courant, pas l'exception.
 */
export async function mobileGuestToken(): Promise<string | null> {
  return acquireGuestToken();
}

/** Le relais est-il configuré ? Sans lui, l'API mobile est inutilisable en prod. */
export function mobileRelayConfigured(): boolean {
  return Boolean(RELAY_BASE);
}

// ─── Mapping vers le format ContentItem de l'app ──────────────────────────────

/** `https://moviebox.ph/fr/detail/xeno-version-francaise-SNbNi4tlos3` → slug. */
function slugFromDetailUrl(detailUrl?: string): string {
  if (!detailUrl) return '';
  const clean = detailUrl.split('?')[0].replace(/\/$/, '');
  return clean.substring(clean.lastIndexOf('/') + 1);
}

function mapMobileSubject(sub: any): any | null {
  if (!sub?.subjectId) return null;
  const corner = sub.corner ? String(sub.corner) : '';
  const isFrench = /fran[cç]ais|vostfr|\bvf\b/i.test(corner);
  return {
    subjectId: String(sub.subjectId),
    detailPath: slugFromDetailUrl(sub.detailUrl),
    title: sub.title || 'Sans titre',
    posterUrl: sub.cover?.url || '',
    coverUrl: sub.cover?.url || undefined,
    type: sub.subjectType === 2 ? 'series' : 'movie',
    year: sub.releaseDate ? String(sub.releaseDate).substring(0, 4) : undefined,
    rating: sub.imdbRatingValue || sub.imdbRate || sub.rate || undefined,
    genres: sub.genre ? String(sub.genre).split(',').map((g: string) => g.trim()) : undefined,
    plot: sub.description || undefined,
    duration: sub.seconds ? `${Math.floor(Number(sub.seconds) / 60)}m` : undefined,
    country: sub.countryName || undefined,
    isFrench: isFrench || undefined,
    language: /vostfr/i.test(corner) ? 'VOSTFR' : isFrench ? 'VF' : undefined,
    badge: corner || undefined,
    source: 'moviebox-mobile',
  };
}

// ─── API publique ─────────────────────────────────────────────────────────────

export interface VfCategory {
  id: string;
  name: string;
}

/** Catégories réelles du catalogue VF (libellés déjà en français côté upstream). */
export async function mobileVfCategories(): Promise<VfCategory[]> {
  const json = await mobileApiGet('/wefeed-mobile-bff/tab/ranking-list?tabId=2&page=1&perPage=1');
  const list = json?.data?.categoryList || [];
  return list
    .map((c: any) => ({ id: String(c.type ?? c.categoryType ?? ''), name: c.name || c.title || '' }))
    .filter((c: VfCategory) => c.id && c.name);
}

/**
 * Catalogue VF paginé. `categoryId` = `id` renvoyé par [mobileVfCategories]
 * (absent → catégorie par défaut de l'upstream, « Tendance »).
 */
export async function mobileVfList(
  categoryId?: string,
  page = 1
): Promise<{ items: any[]; page: number; hasMore: boolean; category?: string }> {
  const pg = Math.max(1, Math.floor(Number(page) || 1));
  const qs = new URLSearchParams({ tabId: '2', page: String(pg), perPage: '20' });
  if (categoryId) qs.set('categoryType', categoryId);
  const json = await mobileApiGet(`/wefeed-mobile-bff/tab/ranking-list?${qs.toString()}`);
  if (!json) return { items: [], page: pg, hasMore: false };
  const items = (json?.data?.subjects || []).map(mapMobileSubject).filter(Boolean);
  return {
    items,
    page: pg,
    hasMore: Boolean(json?.data?.pager?.hasMore) && items.length > 0,
    category: json?.data?.currentCategoryType ? String(json.data.currentCategoryType) : undefined,
  };
}

/** Diagnostic : l'API mobile est-elle joignable depuis cet environnement ? */
export async function mobileApiStatus(): Promise<{ ok: boolean; host?: string; via?: string }> {
  const token = await acquireGuestToken(true);
  return {
    ok: Boolean(token),
    host: activeHost || undefined,
    via: useRelay === true ? 'relais Pi' : useRelay === false ? 'direct' : undefined,
  };
}
