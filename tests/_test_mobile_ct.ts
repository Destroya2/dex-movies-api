import { generateXClientToken, md5 } from '../src/utils/crypto';
import crypto from 'crypto';

const GATEWAY_SECRET = "NzZpUmwwN3MweFNOOWpxbUVXQXQ3OUVCSlp1bElRSXNWNjRGWnIyTw==";

function doubleDecode(s: string): Buffer {
  const first = Buffer.from(s, 'base64').toString('utf-8');
  return Buffer.from(first, 'base64');
}

function hmacMd5(key: Buffer, data: string): string {
  return crypto.createHmac('md5', key).update(data, 'utf-8').digest('base64');
}

function buildCanonicalKotlin(method: string, accept: string, ct: string, url: string, body: string | null, ts: number): string {
  const parsed = new URL(url);
  const path = parsed.pathname;
  const params = Array.from(parsed.searchParams.entries()).sort(([a],[b]) => a.localeCompare(b));
  const query = params.map(([k,v]) => `${k}=${v}`).join('&');
  const canonicalUrl = query ? `${path}?${query}` : path;

  const bodyBytes = body ? Buffer.from(body, 'utf-8') : null;
  const truncated = bodyBytes && bodyBytes.length > 102400 ? bodyBytes.subarray(0, 102400) : bodyBytes;
  const bodyHash = truncated ? md5(truncated) : '';
  const bodyLength = bodyBytes ? bodyBytes.length.toString() : '';

  return [method.toUpperCase(), accept, ct, bodyLength, ts.toString(), bodyHash, canonicalUrl].join('\n');
}

async function test(contentType: string, label: string) {
  const BASE = 'https://api3.aoneroom.com';
  const path = '/wefeed-mobile-bff/subject-api/search/v2';
  const url = BASE + path;
  const method = 'POST';
  const accept = 'application/json';
  const body = JSON.stringify({ keyword: 'spider-noir', page: 1, perPage: 20 });
  const ts = Date.now();
  
  const canonical = buildCanonicalKotlin(method, accept, contentType, url, body, ts);
  const secret = doubleDecode(GATEWAY_SECRET);
  const sig = hmacMd5(secret, canonical);
  const xSig = `${ts}|2|${sig}`;
  const xToken = generateXClientToken(ts);

  const headers: Record<string, string> = {
    'user-agent': 'MovieBoxPro/16.2.1 (Android 14; com.community.mbox.in)',
    'accept': accept,
    'content-type': contentType,
    'x-client-token': xToken,
    'x-tr-signature': xSig,
    'x-client-info': '{"package_name":"com.movieboxpro.android","version_name":"16.2.1","version_code":16210,"os":"android","os_version":"12","install_ch":"googleplay","device_id":"868203051234567","install_store":"googleplay","gaid":"","brand":"google","model":"Pixel 6","system_language":"en","net":"wifi","region":"IN","timezone":"Asia/Kolkata","sp_code":"404"}',
    'x-client-status': '0',
    'x-forwarded-for': '196.28.244.1',
    'cf-connecting-ip': '196.28.244.1',
  };

  const resp = await fetch(url, { method, headers, body });
  const text = await resp.text();
  console.log(`${label}: ${resp.status} ${text.substring(0, 120)}`);
  if (resp.ok) return true;
  return false;
}

async function main() {
  // Try different content types
  await test('application/json', 'CT=application/json (our current)');
  await test('application/json; charset=utf-8', 'CT=with space+lower (Kotlin)');
  await test('application/json;charset=UTF-8', 'CT=no space+upper (Python/reverse)');
  console.log('\nDone.');
}

main().catch(console.error);
