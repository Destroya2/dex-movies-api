import { buildClientInfo } from '../src/utils/device';

const BASE = 'https://api3.aoneroom.com';
const PKG = 'com.community.mbox.in';
const CC = { pn: PKG, vn: '3.0.03.0529.03', vc: 50020042, os: '16', region: 'IN' };
const UA = 'com.community.mbox.in/50020042 (Linux; U; Android 16; en_IN; sdk_gphone64_x86_64; Build/BP22.250325.006; Cronet/133.0.6876.3)';
const CI = buildClientInfo(CC);

async function test(label: string, method: string, path: string, body: string | null, params?: Record<string, string>, sigHeader?: string) {
  try {
    let url = BASE + path;
    if (params) {
      const qs = Object.entries(params).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join('&');
      url += '?' + qs;
    }

    const headers: Record<string, string> = {
      'user-agent': UA, 'accept': 'application/json', 'content-type': 'application/json',
      'x-client-token': 'FAKE_TOKEN',
      'x-tr-signature': sigHeader || 'FAKE_SIG',
      'x-client-info': CI,
      'x-client-status': '0',
      'x-play-mode': '2',
      'x-forwarded-for': '196.28.244.1', 'cf-connecting-ip': '196.28.244.1',
    };

    const resp = await fetch(url, { method, headers, body });
    const text = await resp.text();
    const ok = resp.ok ? 'OK' : `${resp.status}`;
    console.log(`${label}: ${ok} ${text.substring(0, 120)}`);
  } catch (e: any) {
    console.log(`${label}: ERROR ${e.message}`);
  }
}

async function main() {
  await test('list FAKE', 'POST', '/wefeed-mobile-bff/subject-api/list',
    JSON.stringify({ tabId: 1, page: 1, perPage: 5, filter: { sort: 'RECOMMEND', language: 'ALL', year: 'ALL', genre: 'ALL', country: 'ALL' } }));
  
  await test('ranking FAKE', 'GET', '/wefeed-mobile-bff/tab/ranking-list',
    null, { tabId: '0', categoryType: '4516404531735022304', page: '1', perPage: '5' });
  
  await test('search FAKE', 'POST', '/wefeed-mobile-bff/subject-api/search/v2',
    JSON.stringify({ keyword: 'spider-noir', page: 1, perPage: 20 }));
  
  await test('get FAKE', 'GET', '/wefeed-mobile-bff/subject-api/get',
    null, { subjectId: '8650122993986953880' });

  // Now test with NO signature headers
  const NO_AUTH = async (label: string, method: string, path: string, body: string | null, params?: Record<string, string>) => {
    try {
      let url = BASE + path;
      if (params) {
        const qs = Object.entries(params).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join('&');
        url += '?' + qs;
      }
      const headers: Record<string, string> = {
        'user-agent': UA, 'accept': 'application/json', 'content-type': 'application/json',
        'x-client-info': CI,
      };
      const resp = await fetch(url, { method, headers, body });
      const text = await resp.text();
      const s = resp.ok ? 'OK' : `${resp.status}`;
      console.log(`${label}: ${s} ${text.substring(0, 120)}`);
    } catch (e: any) {
      console.log(`${label}: ERROR ${e.message}`);
    }
  };

  await NO_AUTH('list NO AUTH', 'POST', '/wefeed-mobile-bff/subject-api/list',
    JSON.stringify({ tabId: 1, page: 1, perPage: 5, filter: { sort: 'RECOMMEND', language: 'ALL', year: 'ALL', genre: 'ALL', country: 'ALL' } }));
  
  await NO_AUTH('search NO AUTH', 'POST', '/wefeed-mobile-bff/subject-api/search/v2',
    JSON.stringify({ keyword: 'spider-noir', page: 1, perPage: 20 }));
}

main().catch(console.error);
