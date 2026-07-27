import { generateXClientToken, md5, base64DoubleDecode, base64Encode } from '../src/utils/crypto';
import crypto from 'crypto';

const SECRET_B64 = 'NzZpUmwwN3MweFNOOWpxbUVXQXQ3OUVCSlp1bElRSXNWNjRGWnIyTw==';

function hmac(key: Buffer, data: string): Buffer {
  return crypto.createHmac('md5', key).update(data, 'utf-8').digest();
}

function buildCanonical(method: string, accept: string, ct: string, url: string, body: string | null, ts: number): string {
  const parsed = new URL(url);
  const path = parsed.pathname;
  const params = Array.from(parsed.searchParams.entries()).sort(([a],[b]) => a.localeCompare(b));
  const query = params.map(([k,v]) => `${k}=${v}`).join('&');
  const canonicalUrl = query ? `${path}?${query}` : path;
  const bodyBytes = body ? Buffer.from(body, 'utf-8') : null;
  const truncated = bodyBytes && bodyBytes.length > 102400 ? bodyBytes.subarray(0, 102400) : bodyBytes;
  const bodyHash = truncated ? md5(truncated) : '';
  const bodyLength = bodyBytes ? bodyBytes.length.toString() : '';
  return [method.toUpperCase(), accept, ct, bodyLength, ts.toString(), bodyHash, canonicalUrl].join('\n');
}

async function tryEndpoint(label: string, host: string, method: string, path: string, body: string | null, qs: Record<string,string>) {
  try {
    const BASE = `https://${host}`;
    qs['host'] = host;
    const qParts = Object.entries(qs).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`);
    const url = `${BASE}${path}?${qParts.join('&')}`;
    const ts = Date.now();
    const accept = 'application/json';
    const ct = 'application/json';

    const canonical = buildCanonical(method, accept, ct, url, body, ts);
    const secret = base64DoubleDecode(SECRET_B64);
    const sigB64 = base64Encode(hmac(secret, canonical));
    const xSig = `${ts}|2|${sigB64}`;
    const xToken = generateXClientToken(ts);

    const headers: Record<string, string> = {
      'user-agent': 'MovieBoxPro/16.2.1 (Android 14; com.community.mbox.in)',
      'accept': accept, 'content-type': ct,
      'x-client-token': xToken, 'x-tr-signature': xSig,
      'x-client-info': '{"package_name":"com.movieboxpro.android","version_name":"16.2.1","version_code":16210,"os":"android","os_version":"12","device_id":"868203051234567","install_store":"googleplay","gaid":"","brand":"google","model":"Pixel 6","system_language":"en","net":"wifi","region":"IN","timezone":"Asia/Kolkata","sp_code":"404"}',
      'x-client-status': '0',
    };

    const resp = await fetch(url, { method, headers, body });
    const text = await resp.text();
    console.log(`${label}: ${resp.status} ${text.substring(0, 120)}`);
    return text;
  } catch(e: any) {
    console.log(`${label}: ERROR ${e.message}`);
    return null;
  }
}

async function main() {
  // Search with Python approach (host param)
  await tryEndpoint('search+host param', 'api3.aoneroom.com', 'POST', '/wefeed-mobile-bff/subject-api/search/v2',
    JSON.stringify({ keyword: 'spider-noir', page: 1, perPage: 20 }), {});
  
  // Search without host param (Python does add it but let's try both)
  await tryEndpoint('search NO host', 'api3.aoneroom.com', 'POST', '/wefeed-mobile-bff/subject-api/search/v2',
    JSON.stringify({ keyword: 'spider-noir', page: 1, perPage: 20 }), { host: '' });
  
  // Try also with api6 instead of api3
  await tryEndpoint('search+api6+host', 'api6.aoneroom.com', 'POST', '/wefeed-mobile-bff/subject-api/search/v2',
    JSON.stringify({ keyword: 'spider-noir', page: 1, perPage: 20 }), {});
  
  // GET detail with host param
  await tryEndpoint('get+host', 'api3.aoneroom.com', 'GET', '/wefeed-mobile-bff/subject-api/get',
    null, { subjectId: '8650122993986953880' });

  // GET ranking with host param (should work)
  await tryEndpoint('ranking+host', 'api3.aoneroom.com', 'GET', '/wefeed-mobile-bff/tab/ranking-list',
    null, { tabId: '0', categoryType: '4516404531735022304', page: '1', perPage: '5' });
}

main().catch(console.error);
