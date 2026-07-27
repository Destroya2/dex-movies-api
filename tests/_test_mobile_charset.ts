import { generateXClientToken, generateXTrSignature } from '../src/utils/crypto';
import { buildClientInfo } from '../src/utils/device';

const BASE = 'https://api3.aoneroom.com';
const PKG = 'com.community.mbox.in';
const CC = { pn: PKG, vn: '3.0.03.0529.03', vc: 50020042, os: '16', region: 'IN' };
const UA = 'com.community.mbox.in/50020042 (Linux; U; Android 16; en_IN; sdk_gphone64_x86_64; Build/BP22.250325.006; Cronet/133.0.6876.3)';

async function doCall(label: string, method: string, path: string, accept: string, ct: string, body: string | null, params?: Record<string, string>) {
  let url = BASE + path;
  if (params) {
    const qs = Object.entries(params).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join('&');
    url += '?' + qs;
  }

  const xToken = generateXClientToken();
  const ts = parseInt(xToken.split(',')[0]);
  const xSig = generateXTrSignature(method, accept, ct, url, body, false, ts);

  const headers: Record<string, string> = {
    'user-agent': UA, 'accept': accept, 'content-type': ct,
    'x-client-token': xToken, 'x-tr-signature': xSig,
    'x-client-info': buildClientInfo(CC),
    'x-client-status': '0',
    'x-play-mode': '2',
    'x-forwarded-for': '196.28.244.1', 'cf-connecting-ip': '196.28.244.1',
  };

  const resp = await fetch(url, { method, headers, body });
  const text = await resp.text();
  const ok = resp.ok ? 'OK' : `${resp.status}`;
  const preview = text.substring(0, 120);
  console.log(`${label}: ${ok} ${preview}`);
  if (resp.ok) return JSON.parse(text);
  return null;
}

async function main() {
  // 1. list with charset in CT
  await doCall('list+charset', 'POST', '/wefeed-mobile-bff/subject-api/list',
    'application/json', 'application/json; charset=utf-8',
    JSON.stringify({ tabId: 1, page: 1, perPage: 5, filter: { sort: 'RECOMMEND', language: 'ALL', year: 'ALL', genre: 'ALL', country: 'ALL' } }));
  
  // 2. list without charset (baseline)
  await doCall('list-no-charset', 'POST', '/wefeed-mobile-bff/subject-api/list',
    'application/json', 'application/json',
    JSON.stringify({ tabId: 1, page: 1, perPage: 5, filter: { sort: 'RECOMMEND', language: 'ALL', year: 'ALL', genre: 'ALL', country: 'ALL' } }));

  // 3. search with charset
  await doCall('search+charset', 'POST', '/wefeed-mobile-bff/subject-api/search/v2',
    'application/json', 'application/json; charset=utf-8',
    JSON.stringify({ keyword: 'spider-noir', page: 1, perPage: 20 }));

  // 4. search without charset
  await doCall('search-no-charset', 'POST', '/wefeed-mobile-bff/subject-api/search/v2',
    'application/json', 'application/json',
    JSON.stringify({ keyword: 'spider-noir', page: 1, perPage: 20 }));

  // 5. get detail with charset
  await doCall('get+charset', 'GET', '/wefeed-mobile-bff/subject-api/get',
    'application/json', 'application/json; charset=utf-8',
    null, { subjectId: '8650122993986953880' });

  // 6. get detail without charset
  await doCall('get-no-charset', 'GET', '/wefeed-mobile-bff/subject-api/get',
    'application/json', 'application/json',
    null, { subjectId: '8650122993986953880' });

  // 7. Try a differen body format for search
  await doCall('search+bodyPageFirst', 'POST', '/wefeed-mobile-bff/subject-api/search/v2',
    'application/json', 'application/json; charset=utf-8',
    JSON.stringify({ page: 1, perPage: 20, keyword: 'spider-noir' }));
}

main().catch(console.error);
