import { Request, Response, NextFunction } from 'express';

const metrics = {
  requestsTotal: 0,
  requestsByPath: {} as Record<string, number>,
  requestsByStatus: {} as Record<string, number>,
  bridgeHits: 0,
  bridgeMisses: 0,
  startTime: Date.now(),
};

// Taux de résolution du pont TMDB→MovieBox (hit = un sujet MovieBox VF a été
// trouvé pour l'id TMDB catalogue, miss = aucun match). Sans ça, la seule
// visibilité était des logs texte non agrégés (scrapers/index.ts).
export function recordBridgeResult(hit: boolean): void {
  if (hit) metrics.bridgeHits++;
  else metrics.bridgeMisses++;
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  metrics.requestsTotal++;
  const path = req.path;
  metrics.requestsByPath[path] = (metrics.requestsByPath[path] || 0) + 1;

  res.on('finish', () => {
    const status = String(res.statusCode);
    metrics.requestsByStatus[status] = (metrics.requestsByStatus[status] || 0) + 1;
  });

  next();
}

export function metricsHandler(_req: Request, res: Response) {
  const uptime = Math.floor((Date.now() - metrics.startTime) / 1000);
  const lines: string[] = [
    '# HELP dex_requests_total Total requests',
    '# TYPE dex_requests_total counter',
    `dex_requests_total ${metrics.requestsTotal}`,
    '',
    '# HELP dex_uptime_seconds Server uptime',
    '# TYPE dex_uptime_seconds gauge',
    `dex_uptime_seconds ${uptime}`,
    '',
    '# HELP dex_requests_by_path Requests per path',
    '# TYPE dex_requests_by_path counter',
  ];
  for (const [path, count] of Object.entries(metrics.requestsByPath)) {
    lines.push(`dex_requests_by_path{path="${path}"} ${count}`);
  }
  lines.push('');
  lines.push('# HELP dex_requests_by_status Requests per status code');
  lines.push('# TYPE dex_requests_by_status counter');
  for (const [status, count] of Object.entries(metrics.requestsByStatus)) {
    lines.push(`dex_requests_by_status{status="${status}"} ${count}`);
  }
  lines.push('');
  lines.push('# HELP dex_bridge_hits TMDB→MovieBox bridge resolutions found');
  lines.push('# TYPE dex_bridge_hits counter');
  lines.push(`dex_bridge_hits ${metrics.bridgeHits}`);
  lines.push('');
  lines.push('# HELP dex_bridge_misses TMDB→MovieBox bridge resolutions not found');
  lines.push('# TYPE dex_bridge_misses counter');
  lines.push(`dex_bridge_misses ${metrics.bridgeMisses}`);

  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.send(lines.join('\n'));
}
