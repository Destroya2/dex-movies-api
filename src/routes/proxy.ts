import { Router, Request, Response, NextFunction } from 'express';
import http from 'http';
import https from 'https';
import dns from 'dns';
import net from 'net';
import { URL } from 'url';
import { CDN_DOMAINS, API_BASE_URL } from '../config/constants';
import { AppError } from '../middleware/errorHandler';

const router = Router();

/**
 * @openapi
 * /api/proxy/stream:
 *   get:
 *     tags: [Proxy]
 *     summary: Proxy de streaming CDN (Range requests)
 *     parameters:
 *       - in: query
 *         name: url
 *         required: true
 *         schema:
 *           type: string
 *         description: URL du fichier à proxifier (domaine whitelisté)
 *     responses:
 *       200:
 *         description: Flux vidéo
 *       400:
 *         description: URL manquante
 *       403:
 *         description: Domaine non autorisé
 */

const ALLOWED_DOMAINS = new Set([
  ...CDN_DOMAINS,
  'api3.aoneroom.com',
]);

// Désactive la validation SSL pour les CDNs qui utilisent des certificats
// auto-signés ou des SANs non standards (netfilm.world, hakunaymatata.com).
// Risque accepté : le domaine est whitelisté statiquement en amont.
const agent = new https.Agent({ rejectUnauthorized: false });

function isAllowed(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    return ALLOWED_DOMAINS.has(parsed.hostname) || parsed.hostname.endsWith('.hakunaymatata.com');
  } catch {
    return false;
  }
}

// Contrairement à /stream (domaines CDN whitelistés statiquement), /captions
// doit accepter des fournisseurs de sous-titres variés (wyzie.ru, etc.) donc
// pas de whitelist fixe possible — on bloque plutôt les cibles internes/privées
// pour empêcher le SSRF (metadata cloud, localhost, réseau interne Vercel).
function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1') return true;
    if (lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
    if (lower.startsWith('::ffff:')) {
      const v4 = lower.split(':').pop()!;
      return net.isIPv4(v4) ? isPrivateIp(v4) : true;
    }
    return false;
  }
  return true;
}

async function isSafeExternalUrl(urlStr: string): Promise<boolean> {
  let parsed: URL;
  try { parsed = new URL(urlStr); } catch { return false; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (parsed.hostname === 'localhost') return false;
  if (net.isIP(parsed.hostname)) return !isPrivateIp(parsed.hostname);
  try {
    const { address } = await dns.promises.lookup(parsed.hostname);
    return !isPrivateIp(address);
  } catch {
    return false;
  }
}

function wrapAsync(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

router.get('/stream', wrapAsync(async (req: Request, res: Response) => {
  const urlStr = req.query.url as string;
  if (!urlStr) throw new AppError(400, 'MISSING_URL', 'url query parameter is required');
  if (!isAllowed(urlStr)) throw new AppError(403, 'FORBIDDEN_DOMAIN', 'Domain not allowed');

  const parsed = new URL(urlStr);
  const isHttps = parsed.protocol === 'https:';
  const transport = isHttps ? https : http;

  const options: http.RequestOptions = {
    hostname: parsed.hostname,
    port: parsed.port || (isHttps ? 443 : 80),
    path: parsed.pathname + parsed.search,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': `${API_BASE_URL}/`,
      'Range': (req.headers.range as string) || '',
    },
    agent: isHttps ? agent : undefined,
  };

  try {
    const proxyReq = transport.request(options, (proxyRes) => {
      const statusCode = proxyRes.statusCode || 200;

      if (statusCode >= 400) {
        res.status(statusCode).json({ error: `Upstream returned ${statusCode}` });
        return;
      }

      res.status(statusCode);
      const passthroughHeaders = [
        'content-type', 'content-length', 'content-range',
        'accept-ranges', 'cache-control', 'expires',
        'last-modified', 'etag',
      ];
      for (const key of passthroughHeaders) {
        const value = proxyRes.headers[key];
        if (value) res.setHeader(key, value);
      }

      proxyRes.pipe(res);

      proxyRes.on('error', () => {
        if (!res.headersSent) res.status(502).json({ error: 'Stream error' });
      });
    });

    proxyReq.on('error', () => {
      if (!res.headersSent) res.status(502).json({ error: 'Proxy error' });
    });

    req.on('aborted', () => proxyReq.destroy());
    proxyReq.end();
  } catch {
    throw new AppError(502, 'PROXY_ERROR', 'Failed to create proxy request');
  }
}));

/**
 * @openapi
 * /api/proxy/captions:
 *   get:
 *     tags: [Proxy]
 *     summary: Proxy de sous-titres (VTT)
 *     parameters:
 *       - in: query
 *         name: url
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Contenu VTT
 *       400:
 *         description: URL manquante
 */
router.get('/captions', wrapAsync(async (req: Request, res: Response) => {
  const urlStr = req.query.url as string;
  if (!urlStr) throw new AppError(400, 'MISSING_URL', 'url query parameter is required');
  if (!(await isSafeExternalUrl(urlStr))) throw new AppError(403, 'FORBIDDEN_TARGET', 'Target not allowed');

  try {
    const response = await fetch(urlStr);
    if (!response.ok) {
      throw new AppError(502, 'CAPTIONS_ERROR', `Captions fetch failed: ${response.status}`);
    }
    const text = await response.text();
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(text);
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    throw new AppError(502, 'CAPTIONS_ERROR', error?.message || 'Failed to fetch captions');
  }
}));

export default router;
