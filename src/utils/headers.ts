import { generateXClientToken, generateXTrSignature } from './crypto';
import { buildClientInfo } from './device';

interface HeaderOptions {
  method?: string;
  accept?: string;
  contentType?: string;
  url: string;
  body?: string | null;
  useAltKey?: boolean;
  token?: string;
  profile?: 'home' | 'detail' | 'stream' | 'search';
  extraHeaders?: Record<string, string>;
}

export function buildSignedHeaders(opts: HeaderOptions): Record<string, string> {
  const method = opts.method || 'GET';
  const accept = opts.accept || 'application/json';
  const contentType = opts.contentType || 'application/json';
  const url = opts.url;
  const body = opts.body ?? null;
  const useAltKey = opts.useAltKey || false;
  const token = opts.token;
  const profile = opts.profile || 'detail';

  const xClientToken = generateXClientToken();
  const xTrSignature = generateXTrSignature(method, accept, contentType, url, body, useAltKey);

  const clientInfo = getClientInfo(profile);
  const ua = getUserAgent(profile);

  const headers: Record<string, string> = {
    'user-agent': ua,
    accept,
    'content-type': contentType,
    connection: 'keep-alive',
    'x-client-token': xClientToken,
    'x-tr-signature': xTrSignature,
    'x-client-info': clientInfo,
    'x-client-status': '0',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (profile === 'stream') {
    headers['X-Play-Mode'] = '1';
    headers['X-Idle-Data'] = '1';
    headers['X-Family-Mode'] = '0';
    headers['X-Content-Mode'] = '0';
  }

  if (opts.extraHeaders) {
    Object.assign(headers, opts.extraHeaders);
  }

  return headers;
}

function getClientInfo(profile: string): string {
  switch (profile) {
    case 'home':
      return buildClientInfo({
        packageName: 'com.community.mbox.in',
        versionName: '3.0.03.0529.03',
        versionCode: 50020042,
        osVersion: '16',
        region: 'IN',
      });
    case 'stream':
      return buildClientInfo({
        packageName: 'com.community.oneroom',
        versionName: '3.0.13.0325.03',
        versionCode: 50020088,
        osVersion: '13',
        region: 'US',
      });
    default:
      return buildClientInfo({
        packageName: 'com.community.oneroom',
        versionName: '3.0.13.0325.03',
        versionCode: 50020088,
        osVersion: '13',
        region: 'US',
      });
  }
}

function getUserAgent(profile: string): string {
  switch (profile) {
    case 'home':
      return 'com.community.mbox.in/50020042 (Linux; U; Android 16; en_IN; sdk_gphone64_x86_64; Build/BP22.250325.006; Cronet/133.0.6876.3)';
    case 'stream':
      return 'com.community.oneroom/50020088 (Linux; U; Android 13; en_US; Pixel 7; Build/TQ3A.230901.001; Cronet/145.0.7582.0)';
    default:
      return 'com.community.oneroom/50020088 (Linux; U; Android 13; en_US; Pixel 7; Build/TQ3A.230901.001; Cronet/145.0.7582.0)';
  }
}

export function buildPlayerHeaders(referer: string): Record<string, string> {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      + '(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    Accept: 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: referer,
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    'sec-ch-ua': '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
  };
}
