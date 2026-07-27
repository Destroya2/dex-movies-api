import { generateXClientToken, generateXTrSignature } from '../src/utils/crypto';
import { buildClientInfo } from '../src/utils/device';

// Try GET request as a simpler test
async function testGet() {
  const BASE = 'https://api3.aoneroom.com';
  const url = `${BASE}/wefeed-mobile-bff/tab/ranking-list?tabId=0&categoryType=4516404531735022304&page=1&perPage=5`;
  const method = 'GET';
  const accept = 'application/json';
  const ct = 'application/json';

  const xToken = generateXClientToken();
  const timestamp = parseInt(xToken.split(',')[0]);
  const xSig = generateXTrSignature(method, accept, ct, url, null, false, timestamp);

  console.log('URL:', url);
  console.log('Token:', xToken);
  console.log('Sig:', xSig);

  const clientInfo = buildClientInfo({
    packageName: 'com.community.mbox.in',
    versionName: '3.0.03.0529.03',
    versionCode: 50020042,
    osVersion: '16',
    region: 'IN',
  });

  const headers: Record<string, string> = {
    'user-agent': 'com.community.mbox.in/50020042 (Linux; U; Android 16; en_IN; sdk_gphone64_x86_64; Build/BP22.250325.006; Cronet/133.0.6876.3)',
    'accept': accept,
    'content-type': ct,
    'x-client-token': xToken,
    'x-tr-signature': xSig,
    'x-client-info': clientInfo,
    'x-client-status': '0',
    'x-forwarded-for': '196.28.244.1',
    'cf-connecting-ip': '196.28.244.1',
  };

  const resp = await fetch(url, { method: 'GET', headers });
  const text = await resp.text();
  console.log(`Status: ${resp.status}`);
  console.log(`Body: ${text.substring(0, 300)}`);
}

testGet().catch(console.error);
