import { generateXClientToken, generateXTrSignature } from '../src/utils/crypto';
import { buildClientInfo } from '../src/utils/device';

const BASE = 'https://api3.aoneroom.com';
const ENDPOINT = '/wefeed-mobile-bff/subject-api/search/v2';

async function tryWith(key: 'default' | 'alt') {
  const url = BASE + ENDPOINT;
  const method = 'POST';
  const accept = 'application/json';
  const ct = 'application/json';
  const body = JSON.stringify({ keyword: "spider", page: 1, perPage: 5 });

  const xToken = generateXClientToken();
  const timestamp = parseInt(xToken.split(',')[0]);
  const useAlt = key === 'alt';
  const xSig = generateXTrSignature(method, accept, ct, url, body, useAlt, timestamp);

  console.log(`\n=== KEY=${key} ===`);
  console.log(`Timestamp: ${timestamp}`);
  console.log(`Token: ${xToken}`);
  console.log(`Sig: ${xSig}`);

  const headers = {
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

  try {
    const resp = await fetch(url, { method: 'POST', headers, body });
    const text = await resp.text();
    console.log(`Status: ${resp.status} -> ${text.substring(0, 150)}`);
    if (resp.ok) return JSON.parse(text);
  } catch (e: any) {
    console.log(`ERROR: ${e.message}`);
  }
  return null;
}

async function main() {
  await tryWith('default');
  await tryWith('alt');
  console.log('\nDone.');
}

main().catch(console.error);
