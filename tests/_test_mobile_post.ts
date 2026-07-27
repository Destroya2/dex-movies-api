import { generateXClientToken, generateXTrSignature } from '../src/utils/crypto';
import { buildClientInfo } from '../src/utils/device';

async function testPost() {
  const BASE = 'https://api3.aoneroom.com';
  const ENDPOINT = '/wefeed-mobile-bff/subject-api/search/v2';
  const url = BASE + ENDPOINT;
  const method = 'POST';
  const accept = 'application/json';
  const ct = 'application/json';
  // Test 1: with body
  // Test 2: without body (GET-style)
  
  for (const test of ['with body', 'empty body', 'no body param']) {
    let body: string | null;
    if (test === 'no body param') body = null;
    else if (test === 'empty body') body = '';
    else body = JSON.stringify({ keyword: "spider", page: 1, perPage: 5 });

    const xToken = generateXClientToken();
    const timestamp = parseInt(xToken.split(',')[0]);
    const xSig = generateXTrSignature(method, accept, ct, url, body, false, timestamp);

    const headers: Record<string, string> = {
      'user-agent': 'com.community.mbox.in/50020042 (Linux; U; Android 16; en_IN; sdk_gphone64_x86_64; Build/BP22.250325.006; Cronet/133.0.6876.3)',
      'accept': accept,
      'content-type': ct,
      'x-client-token': xToken,
      'x-tr-signature': xSig,
      'x-client-info': buildClientInfo({ packageName: 'com.community.mbox.in', versionName: '3.0.03.0529.03', versionCode: 50020042, osVersion: '16', region: 'IN' }),
      'x-client-status': '0',
      'x-forwarded-for': '196.28.244.1',
      'cf-connecting-ip': '196.28.244.1',
    };

    const resp = await fetch(url, { method: 'POST', headers, body });
    const text = await resp.text();
    console.log(`POST ${test}: ${resp.status} -> ${text.substring(0, 200)}`);
  }

  // Test with GET on search (maybe the endpoint accepts GET?)
  console.log('\n=== GET SEARCH ===');
  const url2 = `${BASE}${ENDPOINT}?keyword=spider&page=1&perPage=5`;
  const xToken2 = generateXClientToken();
  const ts2 = parseInt(xToken2.split(',')[0]);
  const xSig2 = generateXTrSignature('GET', 'application/json', 'application/json', url2, null, false, ts2);
  
  const headers2: Record<string, string> = {
    'user-agent': 'com.community.mbox.in/50020042 (Linux; U; Android 16; en_IN; sdk_gphone64_x86_64; Build/BP22.250325.006; Cronet/133.0.6876.3)',
    'accept': 'application/json',
    'content-type': 'application/json',
    'x-client-token': xToken2,
    'x-tr-signature': xSig2,
    'x-client-info': buildClientInfo({ packageName: 'com.community.mbox.in', versionName: '3.0.03.0529.03', versionCode: 50020042, osVersion: '16', region: 'IN' }),
    'x-client-status': '0',
    'x-forwarded-for': '196.28.244.1',
    'cf-connecting-ip': '196.28.244.1',
  };
  const resp2 = await fetch(url2, { method: 'GET', headers: headers2 });
  const text2 = await resp2.text();
  console.log(`GET search: ${resp2.status} -> ${text2.substring(0, 300)}`);
}

testPost().catch(console.error);
