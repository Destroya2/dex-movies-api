import { generateXClientToken, generateXTrSignature } from '../src/utils/crypto';
import { buildClientInfo } from '../src/utils/device';

const BASE = 'https://api3.aoneroom.com';
const PKG = 'com.community.mbox.in';
const CC = { pn: PKG, vn: '3.0.03.0529.03', vc: 50020042, os: '16', region: 'IN' };
const UA = 'com.community.mbox.in/50020042 (Linux; U; Android 16; en_IN; sdk_gphone64_x86_64; Build/BP22.250325.006; Cronet/133.0.6876.3)';

async function call(path: string, method: string, params: Record<string, string> | null, body: string | null) {
  let url = BASE + path;
  if (params) {
    const qs = Object.entries(params).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join('&');
    url += '?' + qs;
  }
  const xToken = generateXClientToken();
  const ts = parseInt(xToken.split(',')[0]);
  const ct = 'application/json';
  const xSig = generateXTrSignature(method, ct, ct, url, body, false, ts);

  const hdrs: Record<string, string> = {
    'user-agent': UA, 'accept': ct, 'content-type': ct,
    'x-client-token': xToken, 'x-tr-signature': xSig,
    'x-client-info': buildClientInfo(CC),
    'x-client-status': '0',
    'x-forwarded-for': '196.28.244.1', 'cf-connecting-ip': '196.28.244.1',
  };

  const resp = await fetch(url, { method, headers: hdrs, body });
  const text = await resp.text();
  console.log(`${method} ${path} ? ${params ? Object.keys(params).length + ' params' : 'no params'} | body=${body ? (body.length > 20 ? body.substring(0,20)+'...' : body) : 'null'} -> ${resp.status}`);
  if (resp.ok) {
    const j = JSON.parse(text);
    const data = j?.data || {};
    console.log(`  Response keys: ${Object.keys(data).slice(0,8).join(', ')}`);
    const items = data?.results || data?.items || data?.list || [];
    if (Array.isArray(items)) {
      console.log(`  Items: ${items.length}`);
      for (const item of items.slice(0, 3)) {
        const sub = item?.subject || item;
        console.log(`    ${sub?.title || '?'} | corner=${sub?.corner || '(none)'}`);
      }
    } else if (typeof items === 'object') {
      for (const [k, v] of Object.entries(items)) {
        if (Array.isArray(v)) console.log(`  ${k}: ${v.length} items`);
      }
    }
  } else {
    console.log(`  Error: ${text.substring(0, 150)}`);
  }
  return resp.ok;
}

async function main() {
  // 1. GET ranking (already works)
  await call('/wefeed-mobile-bff/tab/ranking-list', 'GET', { tabId: '0', categoryType: '4516404531735022304', page: '1', perPage: '5' }, null);
  
  // 2. POST search with body as string
  await call('/wefeed-mobile-bff/subject-api/search/v2', 'POST', null, JSON.stringify({ keyword: 'spider-noir', page: 1, perPage: 20 }));
  
  // 3. POST like GET (no body, params in URL)
  await call('/wefeed-mobile-bff/subject-api/search/v2', 'POST', { keyword: 'spider-noir', page: '1', perPage: '20' }, null);
  
  // 4. GET on search with params in URL
  await call('/wefeed-mobile-bff/subject-api/search/v2', 'GET', { keyword: 'spider-noir', page: '1', perPage: '20' }, null);

  // 5. subject-api/list (used by CNCVerse for content)
  await call('/wefeed-mobile-bff/subject-api/list', 'POST', null, JSON.stringify({ tabId: 1, page: 1, perPage: 5, filter: { sort: 'RECOMMEND', language: 'ALL', year: 'ALL', genre: 'ALL', country: 'ALL' } }));
  
  // 6. GET subject-api/get (detail)
  await call('/wefeed-mobile-bff/subject-api/get', 'GET', { subjectId: '8650122993986953880' }, null);
  
  // 7. POST subject/search/v2 with empty body + keyword in query params
  await call('/wefeed-mobile-bff/subject-api/search/v2', 'POST', { keyword: 'spider-noir', page: '1', perPage: '20' }, '');
}

main().catch(console.error);
