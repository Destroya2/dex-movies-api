import { Request, Response, NextFunction } from 'express';

const metrics = {
  requestsTotal: 0,
  requestsByPath: {} as Record<string, number>,
  requestsByStatus: {} as Record<string, number>,
  bridgeHits: 0,
  bridgeMisses: 0,
  // Efficacité du cache par famille et par niveau. C'est LA métrique qui dit si
  // l'upstream est réellement protégé : un taux de hit qui s'effondre annonce
  // le rate-limit sur l'IP de géo-spoof unique bien avant la panne visible.
  cache: {} as Record<string, { hitL1: number; hitL2: number; miss: number }>,
  // Dernier état connu de chaque disjoncteur (voir utils/resilience.ts).
  breakers: {} as Record<string, string>,
  startTime: Date.now(),
};

export type CacheEvent = 'hitL1' | 'hitL2' | 'miss';

export function recordCacheEvent(family: string, event: CacheEvent): void {
  const e = metrics.cache[family] || (metrics.cache[family] = { hitL1: 0, hitL2: 0, miss: 0 });
  e[event]++;
}

export function recordBreakerState(key: string, state: string): void {
  metrics.breakers[key] = state;
}

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
  lines.push('');
  lines.push('# HELP dex_cache_events_total Cache lookups by family and layer');
  lines.push('# TYPE dex_cache_events_total counter');
  for (const [family, e] of Object.entries(metrics.cache)) {
    lines.push(`dex_cache_events_total{family="${family}",layer="l1"} ${e.hitL1}`);
    lines.push(`dex_cache_events_total{family="${family}",layer="l2"} ${e.hitL2}`);
    lines.push(`dex_cache_events_total{family="${family}",layer="miss"} ${e.miss}`);
  }
  lines.push('');
  lines.push('# HELP dex_circuit_breaker Upstream circuit breaker state (1 = active)');
  lines.push('# TYPE dex_circuit_breaker gauge');
  for (const [key, state] of Object.entries(metrics.breakers)) {
    lines.push(`dex_circuit_breaker{target="${key}",state="${state}"} 1`);
  }

  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.send(lines.join('\n'));
}

/** Vue JSON des compteurs, pour /health (le format Prometheus reste sur /metrics). */
export function metricsSnapshot() {
  return {
    requestsTotal: metrics.requestsTotal,
    uptimeSeconds: Math.floor((Date.now() - metrics.startTime) / 1000),
    bridge: { hits: metrics.bridgeHits, misses: metrics.bridgeMisses },
    cache: metrics.cache,
  };
}
