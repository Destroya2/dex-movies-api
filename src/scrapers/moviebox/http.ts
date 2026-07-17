import { API_MOBILE_HOSTS, ENDPOINTS } from '../../config/constants';
import { buildSignedHeaders } from '../../utils/headers';
import { request, HttpResponse } from '../../utils/http';

export function mobileUrl(path: string, host?: string): string {
  return `${host || API_MOBILE_HOSTS[0]}${path}`;
}

export async function mobileRequest(
  path: string,
  options: { method?: string; body?: string; profile?: 'home' | 'detail' | 'stream' | 'search'; headers?: Record<string, string> } = {}
): Promise<HttpResponse> {
  const hosts = [...API_MOBILE_HOSTS];
  for (const host of hosts) {
    try {
      const url = mobileUrl(path, host);
      const signedHeaders = buildSignedHeaders({ url, profile: options.profile });
      const mergedHeaders = { ...signedHeaders, ...options.headers };
      const response = await request(url, { ...options, headers: mergedHeaders });
      if (response.status === 200) {
        return response;
      }
    } catch {}
  }
  throw new Error(`All mobile API hosts failed for ${path}`);
}

export async function mobileGet(path: string, profile?: 'home' | 'detail' | 'stream' | 'search'): Promise<any> {
  const resp = await mobileRequest(path, { profile });
  return resp.json();
}

export async function mobilePost(path: string, body: any, profile?: 'home' | 'detail' | 'stream' | 'search'): Promise<any> {
  const resp = await mobileRequest(path, { method: 'POST', body: JSON.stringify(body), profile });
  return resp.json();
}

export function detectProfile(path: string): 'home' | 'detail' | 'stream' | 'search' {
  if (path.includes(ENDPOINTS.detail)) return 'detail';
  if (path.includes(ENDPOINTS.search)) return 'search';
  if (path.includes(ENDPOINTS.playInfo)) return 'stream';
  if (path.includes(ENDPOINTS.tabOperating)) return 'home';
  return 'detail';
}

// Cache de tokens par subjectId
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export async function acquireBearerToken(subjectId: string, force: boolean = false): Promise<string> {
  if (!force) {
    const cached = tokenCache.get(subjectId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }
  }

  const path = `${ENDPOINTS.detail}?subjectId=${subjectId}`;
  const response = await mobileRequest(path, { profile: 'detail' });

  const xUser = response.headers['x-user'];
  if (xUser) {
    try {
      const parsed = JSON.parse(xUser);
      if (parsed.token) {
        tokenCache.set(subjectId, {
          token: parsed.token,
          expiresAt: Date.now() + 25 * 60 * 1000,
        });
        return parsed.token;
      }
    } catch {}
  }

  throw new Error('No bearer token in x-user response header');
}

export function clearTokenCache(): void {
  tokenCache.clear();
}
