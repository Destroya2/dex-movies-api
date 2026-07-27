import { generateXClientToken, generateXTrSignature } from '../src/utils/crypto';
import { buildClientInfo } from '../src/utils/device';

async function test() {
  const url = 'https://api3.aoneroom.com/wefeed-mobile-bff/subject-api/search/v2';
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

  console.log('URL:', url);
  console.log('Method:', method);
  console.log('Body:', body);
  console.log('Body length:', body.length);
  console.log('Token:', xToken);
  console.log('Sig:', xSig);
  console.log('Client-Info:', clientInfo);
  console.log('Timestamp:', timestamp);
}

test().catch(console.error);
