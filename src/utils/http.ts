import https from 'https';
import http from 'http';
import { URL } from 'url';

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  json(): Promise<any>;
}

export function request(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeout?: number;
  } = {}
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;

    const req = mod.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: options.method || 'GET',
        headers: options.headers || {},
        timeout: options.timeout || 25000,
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : (v as string);
          }
          resolve({
            status: res.statusCode || 0,
            headers,
            body,
            json: async () => JSON.parse(body),
          });
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timeout: ${url}`));
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}
