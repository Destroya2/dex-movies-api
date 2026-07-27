import { generateXClientToken, generateXTrSignature } from '../src/utils/crypto';
import { buildClientInfo } from '../src/utils/device';

const BASE = 'https://api3.aoneroom.com';
const PKG = 'com.community.mbox.in';
const CC = { pn: PKG, vn: '3.0.03.0529.03', vc: 50020042, os: '16', region: 'IN' };
const UA = 'com.community.mbox.in/50020042 (Linux; U; Android 16; en_IN; sdk_gphone64_x86_64; Build/BP22.250325.006; Cronet/133.0.6876.3)';

async function test() {
  // Try search with x-play-mode: 2 header
  const url = BASE + '/wefeed-mobile-bff/subject-api/search/v2';
  const method = 'POST';
  const ct = 'application/json';
  const body = JSON.stringify({ keyword: 'spider-noir', page: 1, perPage: 20 });

  const xToken = generateXClientToken();
  const ts = parseInt(xToken.split(',')[0]);
  const xSig = generateXTrSignature(method, ct, ct, url, body, false, ts);

  const hdrs: Record<string, string> = {
    'user-agent': UA, 'accept': ct, 'content-type': ct,
    'x-client-token': xToken, 'x-tr-signature': xSig,
    'x-client-info': buildClientInfo(CC),
    'x-client-status': '0',
    'x-play-mode': '2',  // <-- ADDED: CNCVerse always sends this
    'x-forwarded-for': '196.28.244.1', 'cf-connecting-ip': '196.28.244.1',
  };

  const resp = await fetch(url, { method, headers: hdrs, body });
  const text = await resp.text();
  console.log(`Status: ${resp.status}`);
  console.log(`Body: ${text.substring(0, 500)}`);
}

test().catch(console.error);
