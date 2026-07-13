/**
 * Smoke test live : vérifie que chaque endpoint renvoie des données NON VIDES.
 * Usage : npm run smoke [-- baseUrl]
 * Ex    : npm run smoke                          (local, démarre sur les routes montées)
 *         npm run smoke -- https://dexmovies-api.vercel.app
 */
const BASE = process.argv[2] || 'http://localhost:3000';

let failures = 0;

function ok(label: string, cond: boolean, extra: string = '') {
  const mark = cond ? '✅' : '❌';
  if (!cond) failures++;
  console.log(`${mark} ${label}${extra ? ' — ' + extra : ''}`);
}

async function get(path: string): Promise<any> {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`);
  return r.json();
}

async function main() {
  console.log(`Smoke test sur ${BASE}\n`);

  // 1. health
  const health = await get('/health');
  ok('/health', health.status === 'ok');

  // 2. home
  const home = await get('/api/dex/home?nocache=1');
  const sections = home?.data?.sections || [];
  const tabs = home?.data?.tabs || [];
  ok('/home sections non vides', sections.length > 0, `${sections.length} sections (source: ${home?.meta?.source})`);
  ok('/home tabs présents', tabs.length > 0, tabs.map((t: any) => t.id).join(','));
  const firstItem = sections.flatMap((s: any) => s.items || [])[0];
  ok('/home items ont detailPath', !!firstItem?.detailPath, firstItem?.detailPath);

  // 3. trending
  const trending = await get('/api/dex/trending?nocache=1');
  ok('/trending items non vides', (trending?.data?.items || []).length > 0, `${trending?.data?.items?.length} items`);

  // 4. category (3 onglets)
  for (const tab of ['trending', 'movies', 'series']) {
    const cat = await get(`/api/dex/category/${tab}?page=1&nocache=1`);
    const items = cat?.data?.items || [];
    ok(`/category/${tab}`, items.length > 0, `${items.length} items, hasMore=${cat?.data?.hasMore}`);
  }

  // 5. search
  const search = await get('/api/dex/search?q=batman&nocache=1');
  const searchItems = search?.data?.items || [];
  ok('/search items non vides', searchItems.length > 0, `${searchItems.length} items`);
  ok('/search items ont detailPath', !!searchItems[0]?.detailPath, searchItems[0]?.detailPath);

  // 6. suggest
  const suggest = await get('/api/dex/suggest?q=bat');
  ok('/suggest non vide', (suggest?.data || []).length > 0, `${suggest?.data?.length} suggestions`);

  // 7. detail (série trouvée par la recherche)
  const serie = searchItems.find((i: any) => i.type === 'series') || searchItems[0];
  const detail = await get(`/api/dex/detail/${serie.subjectId}?nocache=1`);
  const d = detail?.data || {};
  ok('/detail titre présent', !!d.title, d.title);
  ok('/detail detailPath présent', !!d.detailPath, d.detailPath);
  if (serie.type === 'series') {
    ok('/detail saisons présentes', (d.seasons || []).length > 0, JSON.stringify(d.seasons));
  }

  // 8. stream série (avec et sans detailPath explicite)
  const stream1 = await get(`/api/dex/stream/${serie.subjectId}?season=1&episode=1&detailPath=${d.detailPath}&nocache=1`);
  ok('/stream (avec detailPath) sources non vides', (stream1?.data?.sources || []).length > 0,
    `${stream1?.data?.sources?.length} sources, ex: ${stream1?.data?.sources?.[0]?.quality}p ${stream1?.data?.sources?.[0]?.format}`);

  const stream2 = await get(`/api/dex/stream/${serie.subjectId}?season=1&episode=2&nocache=1`);
  ok('/stream (sans detailPath, résolution auto du slug) sources non vides', (stream2?.data?.sources || []).length > 0,
    `${stream2?.data?.sources?.length} sources`);

  // 9. stream film
  const movie = searchItems.find((i: any) => i.type === 'movie');
  if (movie) {
    const streamM = await get(`/api/dex/stream/${movie.subjectId}?detailPath=${movie.detailPath}&nocache=1`);
    ok(`/stream film ("${movie.title}") sources non vides`, (streamM?.data?.sources || []).length > 0,
      `${streamM?.data?.sources?.length} sources`);
  }

  console.log(`\n${failures === 0 ? '🎉 TOUS LES TESTS PASSENT' : `⚠️ ${failures} échec(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`💥 Smoke test interrompu : ${e.message}`);
  process.exit(1);
});
