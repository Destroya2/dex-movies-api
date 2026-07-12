import crypto from 'crypto';

// Note: Kotlin's CloudStream does a DOUBLE base64 decode:
// base64DecodeArray(base64Decode(key)) = Base64.decode(String(Base64.decode(key)))
// The first decode converts base64→bytes→UTF-8 string.
// The second decode treats that string as base64 and converts to raw bytes.
const SECRET_KEY_DEFAULT_B64 = process.env.SECRET_KEY_DEFAULT || 'NzZpUmwwN3MweFNOOWpxbUVXQXQ3OUVCSlp1bElRSXNWNjRGWnIyTw==';
const SECRET_KEY_ALT_B64 = process.env.SECRET_KEY_ALT || 'WHFuMm5uTzQxL0w5Mm8xaXVYaFNMSFRiWHZZNFo1Wlo2Mm04bVNMQQ==';

function base64Decode(s: string): Buffer {
  return Buffer.from(s, 'base64');
}

function base64DoubleDecode(s: string): Buffer {
  const firstPass = Buffer.from(s, 'base64').toString('utf-8');
  return Buffer.from(firstPass, 'base64');
}

function base64Encode(buf: Buffer): string {
  return buf.toString('base64');
}

function md5(input: Buffer | string): string {
  return crypto.createHash('md5').update(input).digest('hex');
}

function reverseString(input: string): string {
  return input.split('').reverse().join('');
}

function hmacMd5(key: Buffer, data: string): Buffer {
  return crypto.createHmac('md5', key).update(data, 'utf-8').digest();
}

export function generateXClientToken(timestamp?: number): string {
  const ts = (timestamp ?? Date.now()).toString();
  const reversed = reverseString(ts);
  const hash = md5(reversed);
  return `${ts},${hash}`;
}

export function buildCanonicalString(
  method: string,
  accept: string | null,
  contentType: string | null,
  url: string,
  body: string | null,
  timestamp: number
): string {
  const parsed = new URL(url);
  const path = parsed.pathname;

  const sortedParams = Array.from(parsed.searchParams.entries())
    .sort(([a], [b]) => a.localeCompare(b));
  const query = sortedParams.map(([k, v]) => `${k}=${v}`).join('&');
  const canonicalUrl = query ? `${path}?${query}` : path;

  const bodyBytes = body ? Buffer.from(body, 'utf-8') : null;
  const truncated = bodyBytes && bodyBytes.length > 102400
    ? bodyBytes.subarray(0, 102400)
    : bodyBytes;
  const bodyHash = truncated ? md5(truncated) : '';
  const bodyLength = bodyBytes ? bodyBytes.length.toString() : '';

  return [
    method.toUpperCase(),
    accept ?? '',
    contentType ?? '',
    bodyLength,
    timestamp.toString(),
    bodyHash,
    canonicalUrl,
  ].join('\n');
}

export function generateXTrSignature(
  method: string,
  accept: string | null,
  contentType: string | null,
  url: string,
  body?: string | null,
  useAltKey?: boolean,
  timestamp?: number
): string {
  const ts = timestamp ?? Date.now();
  const canonical = buildCanonicalString(method, accept, contentType, url, body ?? null, ts);
  const secretB64 = useAltKey ? SECRET_KEY_ALT_B64 : SECRET_KEY_DEFAULT_B64;
  const secret = base64DoubleDecode(secretB64);
  const signature = hmacMd5(secret, canonical);
  return `${ts}|2|${base64Encode(signature)}`;
}

export { base64Decode, base64DoubleDecode, base64Encode, md5 };
