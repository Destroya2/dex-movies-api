import { ENDPOINTS } from '../../config/constants';
import { mobileApiGet, mobileApiPost, mobileApiRaw, mobileGuestToken } from '../../utils/mobileApi';

/**
 * Transport du scraper API mobile (`/wefeed-mobile-bff/`, signature HMAC).
 *
 * Ce fichier ne construit plus lui-même ses appels. Il délègue à
 * `utils/mobileApi.ts`, qui est le SEUL chemin réseau vérifié en production
 * pour cette API :
 *
 *   - pool d'hôtes (api3 renvoie 404 sur tout, api4/5/6 répondent) ;
 *   - jeton invité obtenu via l'en-tête `x-user` de `tab-operating` ;
 *   - **bascule automatique sur le relais du Raspberry Pi** quand l'appel
 *     direct est bloqué — c'est le cas depuis Vercel, dont les IP datacenter
 *     n'obtiennent jamais de jeton. La signature HMAC ne dépend que de la
 *     méthode, des en-têtes et de l'URL, jamais de l'IP : la requête peut donc
 *     être signée ici et relayée telle quelle ;
 *   - disjoncteurs par hôte, pour ne pas payer le timeout d'un hôte mort à
 *     chaque requête utilisateur.
 *
 * L'ancienne version appelait `request()` en direct avec ses propres en-têtes.
 * C'est précisément ce qui rendait ce scraper inutilisable en production et
 * l'avait fait mettre derrière un drapeau désactivé.
 */

export function mobileUrl(path: string, _host?: string): string {
  // Conservé pour compatibilité de signature : l'hôte est choisi par le
  // transport (pool + hôte actif mémorisé), plus par l'appelant.
  return path;
}

export async function mobileGet(path: string, _profile?: string): Promise<any> {
  const json = await mobileApiGet(path);
  if (!json) throw new Error(`API mobile injoignable pour ${path}`);
  return json;
}

export async function mobilePost(path: string, body: any, _profile?: string): Promise<any> {
  const json = await mobileApiPost(path, body);
  if (!json) throw new Error(`API mobile injoignable pour ${path} (POST)`);
  return json;
}

export function detectProfile(path: string): 'home' | 'detail' | 'stream' | 'search' {
  if (path.includes(ENDPOINTS.detail)) return 'detail';
  if (path.includes(ENDPOINTS.search)) return 'search';
  if (path.includes(ENDPOINTS.playInfo)) return 'stream';
  if (path.includes(ENDPOINTS.tabOperating)) return 'home';
  return 'detail';
}

// Cache de jetons par subjectId.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/**
 * Jeton porteur propre à un sujet, lu dans l'en-tête `x-user` de sa fiche.
 *
 * `play-info` le réclame ; le jeton invité global ne suffit pas toujours.
 */
export async function acquireBearerToken(subjectId: string, force: boolean = false): Promise<string> {
  if (!force) {
    const cached = tokenCache.get(subjectId);
    if (cached && cached.expiresAt > Date.now()) return cached.token;
  }

  const resp = await mobileApiRaw(`${ENDPOINTS.detail}?subjectId=${subjectId}`);
  const xUser = resp?.headers['x-user'];
  if (xUser) {
    try {
      const parsed = JSON.parse(String(xUser));
      if (parsed.token) {
        tokenCache.set(subjectId, {
          token: parsed.token,
          expiresAt: Date.now() + 25 * 60 * 1000,
        });
        return parsed.token;
      }
    } catch { /* x-user illisible */ }
  }

  // Pas de `x-user` sur cette fiche — c'est le cas COURANT, pas une anomalie.
  // Le jeton invité fait le travail : vérifié le 06/08/2026 sur `play-info`,
  // il renvoie exactement le même `streams` qu'un jeton propre au sujet. Lever
  // ici faisait échouer toute la lecture pour une raison qui n'en est pas une.
  const invite = await mobileGuestToken();
  if (invite) {
    tokenCache.set(subjectId, { token: invite, expiresAt: Date.now() + 25 * 60 * 1000 });
    return invite;
  }

  throw new Error(`Aucun jeton disponible pour le sujet ${subjectId}`);
}

export function clearTokenCache(): void {
  tokenCache.clear();
}
