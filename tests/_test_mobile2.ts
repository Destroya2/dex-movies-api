import { generateXClientToken, generateXTrSignature } from '../src/utils/crypto';
import { buildClientInfo } from '../src/utils/device';

// Test multiple combinations to find the right one
const COMBOS = [
  { name: '1. default headers, no charset', ct: 'application/json', ua: 'com.community.mbox.in/50020042 (Linux; U; Android 16; en_IN; sdk_gphone64_x86_64; Build/BP22.250325.006; Cronet/133.0.6876.3)', extraHeaders: {} },
  { name: '2. with charset', ct: 'application/json; charset=utf-8', ua: 'com.community.mbox.in/50020042 (Linux; U; Android 16; en_IN; sdk_gphone64_x86_64; Build/BP22.250325.006; Cronet/133.0.6876.3)', extraHeaders: {} },
  { name: '3. oneroom package', ct: 'application/json', ua: 'com.community.oneroom/50020088 (Linux; U; Android 13; en_US; Pixel 7; Build/TQ3A.230901.001; Cronet/145.0.7582.0)', extraHeaders: {} },
  { name: '4. with geo spoof', ct: 'application/json', ua: 'com.community.mbox.in/50020042 (Linux; U; Android 16; en_IN; sdk_gphone64_x86_64; Build/BP22.250325.006; Cronet/133.0.6876.3)', extraHeaders: { 'X-Forwarded-For': '196.28.244.1', 'CF-Connecting-IP': '196.28.244.1' } },
  { name: '5. no extra headers (bare bones)', ct: 'application/json', ua: 'com.community.mbox.in/50020042 (Linux; U; Android 16; en_IN; sdk_gphone64_x86_64; Build/BP22.250325.006; Cronet/133.0.6876.3)', extraHeaders: { 'x-play-mode': '2' } },
];

const BASE = 'https://api3.aoneroom.com';
const ENDPOINT = '/wefeed-mobile-bff/subject-api/search/v2';

async function tryCombo(combo: typeof COMBOS[0]) {
  const url = BASE + ENDPOINT;
  const method = 'POST';
  const accept = 'application/json';
  const body = JSON.stringify({ keyword: "spider", page: 1, perPage: 5 });

  const xToken = generateXClientToken();
  const timestamp = parseInt(xToken.split(',')[0]);
  const xSig = generateXTrSignature(method, accept, combo.ct, url, body, false, timestamp);

  const clientInfo = buildClientInfo({
    packageName: 'com.community.mbox.in',
    versionName: '3.0.03.0529.03',
    versionCode: 50020042,
    osVersion: '16',
    region: 'IN',
  });

  const headers: Record<string, string> = {
    'user-agent': combo.ua,
    'accept': accept,
    'content-type': combo.ct,
    'x-client-token': xToken,
    'x-tr-signature': xSig,
    'x-client-info': clientInfo,
    'x-client-status': '0',
    ...combo.extraHeaders,
  };
  // No connection header to avoid issues

  try {
    const response = await fetch(url, { method: 'POST', headers, body });
    const text = await response.text();
    const msg = text.length < 200 ? text : text.substring(0, 200);
    console.log(`${combo.name}: ${response.status} — ${msg}`);
    if (response.ok) {
      const json = JSON.parse(text);
      return json;
    }
  } catch (e: any) {
    console.log(`${combo.name}: ERROR — ${e.message}`);
  }
  return null;
}

async function main() {
  for (const combo of COMBOS) {
    const result = await tryCombo(combo);
    if (result) {
      console.log('\nSUCCESS! Full response:');
      // Extract items
      const data = result?.data || {};
      const items = data?.results || data?.items || data?.list || [];
      console.log(`Items: ${JSON.stringify(items).substring(0, 500)}`);
      break;
    }
  }
}

main().catch(console.error);
