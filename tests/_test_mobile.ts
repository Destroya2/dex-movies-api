import { generateXClientToken, generateXTrSignature } from '../src/utils/crypto';
import { buildClientInfo } from '../src/utils/device';

async function testMobileAPI() {
  const BASE = 'https://api3.aoneroom.com';
  const ENDPOINT = '/wefeed-mobile-bff/subject-api/search/v2';
  const url = BASE + ENDPOINT;
  const method = 'POST';
  const accept = 'application/json';
  const contentType = 'application/json; charset=utf-8';
  const body = JSON.stringify({ keyword: "spider-noir", page: 1, perPage: 20 });

  const xToken = generateXClientToken();
  const timestamp = parseInt(xToken.split(',')[0]);
  const xSig = generateXTrSignature(method, accept, contentType, url, body, false, timestamp);

  const clientInfo = buildClientInfo({
    packageName: 'com.community.mbox.in',
    versionName: '3.0.03.0529.03',
    versionCode: 50020042,
    osVersion: '16',
    region: 'IN',
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'user-agent': 'com.community.mbox.in/50020042 (Linux; U; Android 16; en_IN; sdk_gphone64_x86_64; Build/BP22.250325.006; Cronet/133.0.6876.3)',
      'accept': accept,
      'content-type': contentType,
      'connection': 'keep-alive',
      'x-client-token': xToken,
      'x-tr-signature': xSig,
      'x-client-info': clientInfo,
      'x-client-status': '0',
      'x-play-mode': '2',
    },
    body,
  });

  console.log('Status:', response.status);
  const text = await response.text();
  console.log('Body:', text.substring(0, 1000));

  if (response.ok) {
    const json = JSON.parse(text);
    const data = json?.data || {};
    const results = data?.results || data?.items || data?.list || [];
    console.log('\nResults structure type:', typeof results);
    if (Array.isArray(results)) {
      console.log('Items count:', results.length);
      for (const item of results) {
        const sub = item?.subject || item;
        console.log(`  ${String(sub?.title || '?').padEnd(55)} | corner=${String(sub?.corner || '(none)').padEnd(15)} | type=${sub?.subjectType} | sid=${sub?.subjectId}`);
      }
    } else if (typeof results === 'object') {
      console.log('Result keys:', Object.keys(results));
      for (const [cat, items] of Object.entries(results)) {
        if (Array.isArray(items)) {
          console.log(`  Category "${cat}": ${items.length} items`);
          for (const item of items.slice(0, 3)) {
            const sub = item?.subject || item;
            console.log(`    ${String(sub?.title || '?').padEnd(55)} | corner=${String(sub?.corner || '(none)').padEnd(15)}`);
          }
        }
      }
    }
  } else {
    console.log('Full response:', text.substring(0, 500));
  }
}

testMobileAPI().catch(console.error);
