import { generateXClientToken, generateXTrSignature, buildCanonicalString } from '../src/utils/crypto';

// 1. Debug the canonical string for list vs search
const url = 'https://api3.aoneroom.com/wefeed-mobile-bff/subject-api/search/v2';
const method = 'POST';
const accept = 'application/json';
const ct = 'application/json';
const body = JSON.stringify({ keyword: 'spider-noir', page: 1, perPage: 20 });
const ts = Date.now();

const canonList = buildCanonicalString(method, accept, ct, 'https://api3.aoneroom.com/wefeed-mobile-bff/subject-api/list',
  JSON.stringify({ tabId: 1, page: 1, perPage: 5, filter: { sort: 'RECOMMEND', language: 'ALL', year: 'ALL', genre: 'ALL', country: 'ALL' } }), ts);
const canonSearch = buildCanonicalString(method, accept, ct, url, body, ts);

console.log('=== CANONICAL FOR LIST (working) ===');
console.log(canonList.split('\n').map((l,i) => `  [${i}] ${JSON.stringify(l)}`).join('\n'));
console.log('\n=== CANONICAL FOR SEARCH (failing) ===');
console.log(canonSearch.split('\n').map((l,i) => `  [${i}] ${JSON.stringify(l)}`).join('\n'));

// 2. Test: is the problem x-client-token or x-tr-signature?
// Try search with REAL x-tr-signature but FAKE x-client-token
const realSig = generateXTrSignature(method, accept, ct, url, body, false, ts);
const fakeToken = 'FAKE_TOKEN';
console.log(`\n=== search with FAKE token + REAL sig ===`);
console.log(`  Sig: ${realSig}`);
console.log(`  Token: ${fakeToken}`);

async function main() {
  const hdrs: Record<string, string> = {
    'user-agent': 'com.community.mbox.in/50020042 (Linux; U; Android 16; en_IN; sdk_gphone64_x86_64; Build/BP22.250325.006; Cronet/133.0.6876.3)',
    'accept': accept, 'content-type': ct,
    'x-client-token': fakeToken,
    'x-tr-signature': realSig,
    'x-client-info': '{"package_name":"com.community.mbox.in","version_name":"3.0.03.0529.03","version_code":50020042,"os":"android","os_version":"16","device_id":"a1b2c3d4e5f6","install_store":"ps","gaid":"d7578036d13336cc","brand":"google","model":"Pixel 9 Pro","system_language":"en","net":"NETWORK_WIFI","region":"IN","timezone":"Asia/Calcutta","sp_code":""}',
    'x-client-status': '0',
    'x-forwarded-for': '196.28.244.1', 'cf-connecting-ip': '196.28.244.1',
  };

  const resp = await fetch(url, { method, headers: hdrs, body });
  const text = await resp.text();
  console.log(`  Status: ${resp.status} ${text.substring(0, 150)}`);

  // 3. Try with REAL token + FAKE sig
  const realToken = generateXClientToken(ts);
  const fakeSig = `${ts}|2|AAAA`;
  console.log(`\n=== search with REAL token + FAKE sig ===`);
  console.log(`  Token: ${realToken}`);
  console.log(`  Sig: ${fakeSig}`);

  const hdrs2: Record<string, string> = {
    ...hdrs,
    'x-client-token': realToken,
    'x-tr-signature': fakeSig,
  };

  const resp2 = await fetch(url, { method, headers: hdrs2, body });
  const text2 = await resp2.text();
  console.log(`  Status: ${resp2.status} ${text2.substring(0, 150)}`);
}

main().catch(console.error);
