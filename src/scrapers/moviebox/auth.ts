import { buildSignedHeaders } from '../../utils/headers';
import { request } from '../../utils/http';
import { API_BASE_URL, ENDPOINTS } from '../../config/constants';

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export async function acquireBearerToken(subjectId: string, force: boolean = false): Promise<string> {
  if (!force) {
    const cached = tokenCache.get(subjectId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }
  }

  const url = `${API_BASE_URL}${ENDPOINTS.detail}?subjectId=${subjectId}`;
  const headers = buildSignedHeaders({ url, profile: 'detail' });

  const response = await request(url, { headers });
  if (response.status !== 200) {
    throw new Error(`Failed to fetch subject detail: ${response.status}`);
  }

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
    } catch {
      // fall through
    }
  }

  throw new Error('No bearer token in x-user response header');
}

export function clearTokenCache(): void {
  tokenCache.clear();
}
