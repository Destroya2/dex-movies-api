// Audit anti-crash : chaque cas limite doit renvoyer une réponse JSON PROPRE
// (success:false ou data vide), jamais un crash/hang/HTML d'erreur.
const BASE = process.argv[2] || 'https://dexmovies-api.vercel.app';
let warns = 0;

async function hit(label: string, path: string, expectOk?: boolean) {
  const url = `${BASE}${path}`;
  const t0 = Date.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(35000) });
    const ms = Date.now() - t0;
    const ct = r.headers.get('content-type') || '';
    let body: any = null, parseOk = true;
    const text = await r.text();
    try { body = JSON.parse(text); } catch { parseOk = false; }

    const jsonOk = parseOk && body && typeof body.success === 'boolean';
    const flag = !jsonOk ? '❌ PAS JSON PROPRE' :
      (r.status >= 500 ? '⚠️ 5xx' : '✅');
    if (!jsonOk || r.status >= 500) warns++;
    console.log(`${flag} [${r.status} ${ms}ms] ${label} — ${jsonOk ? ('success=' + body.success + (body.error ? ' code=' + body.error.code : '')) : ct.slice(0, 30) + ' len=' + text.length}`);
  } catch (e: any) {
    warns++;
    console.log(`❌ [ERR/${Date.now() - t0}ms] ${label} — ${e.message}`);
  }
}

async function main() {
  console.log(`Audit anti-crash sur ${BASE}\n`);

  // IDs invalides / inexistants
  await hit('stream subjectId bidon', '/api/dex/stream/xyznotreal123?nocache=1');
  await hit('stream tmdb inexistant', '/api/dex/stream/tmdb:movie:999999999?nocache=1');
  await hit('stream tmdb malformé', '/api/dex/stream/tmdb:garbage?nocache=1');
  await hit('detail subjectId bidon', '/api/dex/detail/xyznotreal123?nocache=1');
  await hit('detail tmdb inexistant', '/api/dex/detail/tmdb:movie:999999999?nocache=1');
  await hit('download tmdb inexistant', '/api/dex/download/tmdb:movie:999999999?nocache=1');
  await hit('recommend inexistant', '/api/dex/recommend/999999999?nocache=1');

  // Catalogue : params invalides
  await hit('catalog discover type invalide', '/api/dex/catalog/discover?type=zzz&page=1');
  await hit('catalog discover page négative', '/api/dex/catalog/discover?type=movie&page=-5');
  await hit('catalog discover page énorme', '/api/dex/catalog/discover?type=movie&page=99999');
  await hit('catalog discover genre invalide', '/api/dex/catalog/discover?type=movie&genre=abc');
  await hit('catalog detail inexistant', '/api/dex/catalog/detail/movie/999999999?nocache=1');
  await hit('catalog detail type invalide', '/api/dex/catalog/detail/zzz/1?nocache=1');

  // Recherche / catégorie
  await hit('search vide', '/api/dex/search?q=');
  await hit('search 1 char', '/api/dex/search?q=a');
  await hit('search caractères spéciaux', '/api/dex/search?q=' + encodeURIComponent('<script>&%$#'));
  await hit('category tab invalide', '/api/dex/category/zzznope?page=1');
  await hit('category page négative', '/api/dex/category/movies?page=-1');

  // Routes / méthodes inconnues
  await hit('route inexistante', '/api/dex/nawak');
  await hit('detail sans id', '/api/dex/detail/');

  console.log(`\n${warns === 0 ? '🎉 AUCUN crash/5xx — toutes les erreurs sont propres' : `⚠️ ${warns} réponse(s) à revoir`}`);
}
main().catch((e) => { console.error('💥', e.message); process.exit(1); });
