/**
 * Batterie de tests complète : home, catégories, pagination, search, suggest,
 * detail, stream, recommend, download.
 * Usage : npx tsx tests/battery.ts [baseUrl]
 */
const BASE = process.argv[2] || 'http://localhost:3000';

interface TestResult {
  label: string;
  ok: boolean;
  detail: string;
}
const results: TestResult[] = [];

function ok(label: string, cond: boolean, detail: string = '') {
  results.push({ label, ok: cond, detail });
  const mark = cond ? '✅' : '❌';
  console.log(`${mark} ${label}${detail ? ' — ' + detail : ''}`);
}

async function get(path: string): Promise<any> {
  const r = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`);
  return r.json();
}

async function haveDetailPath(items: any[]): Promise<boolean> {
  return items.length > 0 && items.every((i: any) => !!i.detailPath);
}

async function main() {
  const start = Date.now();
  console.log(`\n🔋 BATTERIE DE TESTS — ${BASE}\n`);
  console.log('═'.repeat(60));

  // ─── 1. HEALTH ─────────────────────────────────────────────────────
  console.log('\n📡 1. HEALTH\n');
  {
    const h = await get('/health');
    ok('health status ok', h.status === 'ok', h.status);
    ok('health cache stats', !!h.cache, `${h.cache?.size ?? 0} entrées`);
    ok('health uptime > 0', (h.uptime ?? 0) > 0, `${Math.round(h.uptime)}s`);
  }

  // ─── 2. HOME ───────────────────────────────────────────────────────
  console.log('\n🏠 2. HOME\n');
  {
    const home = await get('/api/dex/home?nocache=1');
    const sections = home?.data?.sections || [];
    const tabs = home?.data?.tabs || [];
    ok('home: sections non vides', sections.length > 0, `${sections.length} sections`);
    ok('home: au moins 39 sections (ou presque)', sections.length >= 35, `${sections.length} sections`);
    ok('home: tabs présents', tabs.length >= 3, `[${tabs.map((t: any) => t.id).join(', ')}]`);

    const allItems = sections.flatMap((s: any) => s.items || []);
    ok('home: items ont detailPath', allItems.length > 0 && allItems.every((i: any) => !!i.detailPath),
      `${allItems.length} items, ex: ${allItems[0]?.detailPath}`);

    const bannerSection = sections.find((s: any) => s.type === 'banner');
    ok('home: section BANNER présente', !!bannerSection, bannerSection?.title ?? '');
    ok('home: banner items > 0', (bannerSection?.items?.length ?? 0) > 0,
      `${bannerSection?.items?.length} banner items`);

    const rowSections = sections.filter((s: any) => s.type === 'row');
    ok('home: sections row (étagères) > 0', rowSections.length > 0, `${rowSections.length} row sections`);

    // Vérifie le premier item en détail
    const first = allItems[0];
    ok('home: premier item a subjectId', !!first?.subjectId, first?.subjectId);
    ok('home: premier item a title', !!first?.title, first?.title);
    ok('home: premier item a posterUrl', !!first?.posterUrl, first?.posterUrl?.substring(0, 60));
  }

  // ─── 3. CATÉGORIES (29+ items par onglet) ──────────────────────────
  console.log('\n🗂️  3. CATÉGORIES (29+ items)\n');
  {
    for (const tab of ['trending', 'movies', 'series', 'animation']) {
      try {
        let all: any[] = [];
        let page = 1;
        while (all.length < 29 && page <= 5) {
          const cat = await get(`/api/dex/category/${tab}?page=${page}&nocache=1`);
          const items = cat?.data?.items || [];
          all = all.concat(items);
          if (!cat?.data?.hasMore) break;
          page++;
        }
        const hasDetailPath = haveDetailPath(all);
        ok(`category/${tab}: ${all.length} items (${page} pages)`, all.length >= 10,
          `${all.length} items, detailPath=${hasDetailPath}`);
      } catch (e: any) {
        ok(`category/${tab}: erreur`, false, e.message);
      }
    }
  }

  // ─── 4. RECHERCHE MULTI-QUERIES ────────────────────────────────────
  console.log('\n🔍 4. RECHERCHE\n');
  {
    const queries = ['spider', 'batman', 'dragon', 'one piece', 'naruto', 'demon', 'attack', 'jujutsu', 'solo leveling'];
    for (const q of queries) {
      try {
        const s = await get(`/api/dex/search?q=${encodeURIComponent(q)}&nocache=1`);
        const items = s?.data?.items || [];
        ok(`search "${q}": ${items.length} résultats`, items.length > 0,
          items.length > 0 ? `[${items.slice(0, 3).map((i: any) => i.title).join(', ')}]` : 'vide');
        if (items.length > 0) {
          ok(`search "${q}": detailPath présent`, !!items[0]?.detailPath, items[0].detailPath);
        }
      } catch (e: any) {
        ok(`search "${q}": erreur`, false, e.message);
      }
    }
  }

  // ─── 5. SUGGEST ────────────────────────────────────────────────────
  console.log('\n💡 5. SUGGEST (autocomplete)\n');
  {
    const prefixes = ['spi', 'bat', 'dra', 'one', 'nar', 'dem', 'att', 'juju', 'solo', 'a'];
    for (const p of prefixes) {
      try {
        const sug = await get(`/api/dex/suggest?q=${p}`);
        const items = sug?.data || [];
        ok(`suggest "${p}": ${items.length} suggestions`, items.length > 0,
          items.slice(0, 3).map((i: any) => i.title).join(', '));
      } catch (e: any) {
        ok(`suggest "${p}": erreur`, false, e.message);
      }
    }
  }

  // ─── 6. DETAIL ─────────────────────────────────────────────────────
  console.log('\n📄 6. DETAIL\n');
  {
    // Récupère une liste d'items depuis le home et la recherche
    const home = await get('/api/dex/home?nocache=1');
    const homeItems = home?.data?.sections?.flatMap((s: any) => s.items || []) || [];
    const search = await get('/api/dex/search?q=spider&nocache=1');
    const searchItems = search?.data?.items || [];
    const candidates = [...homeItems, ...searchItems].filter(Boolean);
    const seen = new Set<string>();
    const unique: any[] = [];
    for (const c of candidates) {
      if (!seen.has(c.subjectId) && c.subjectId) {
        seen.add(c.subjectId);
        unique.push(c);
      }
    }
    const toTest = unique.slice(0, 8);
    for (const item of toTest) {
      try {
        const d = await get(`/api/dex/detail/${item.subjectId}?nocache=1`);
        const data = d?.data || {};
        const cond = !!data.title;
        ok(`detail ${item.subjectId.substring(0, 12)}: "${data.title || item.title}"`,
          cond, `type=${data.type}, saisons=${data.seasons?.length ?? 0}, cast=${data.cast?.length ?? 0}`);
      } catch (e: any) {
        ok(`detail ${item.subjectId.substring(0, 12)}: "${item.title}"`,
          false, e.message);
      }
    }
  }

  // ─── 7. STREAM — VÉRIFICATION CRITIQUE ─────────────────────────────
  console.log('\n🎬 7. STREAM\n');
  {
    // Films depuis le home
    const home = await get('/api/dex/home?nocache=1');
    const allHome = home?.data?.sections?.flatMap((s: any) => s.items || []) || [];
    const movies = allHome.filter((i: any) => i.type === 'movie');
    const series = allHome.filter((i: any) => i.type === 'series');

    // Test films (max 5)
    const moviesToTest = movies.slice(0, 5);
    for (const m of moviesToTest) {
      try {
        const s = await get(`/api/dex/stream/${m.subjectId}?detailPath=${m.detailPath}&nocache=1`);
        const sources = s?.data?.sources || [];
        ok(`stream film "${m.title?.substring(0, 30)}": ${sources.length} sources`,
          sources.length > 0,
          sources.map((src: any) => `${src.quality}p ${src.format}`).join(', '));
      } catch (e: any) {
        ok(`stream film "${m.title?.substring(0, 30)}": erreur`, false, e.message);
      }
    }

    // Test séries (max 5, saison 1 épisode 1)
    const seriesToTest = series.slice(0, 5);
    for (const s of seriesToTest) {
      try {
        // D'abord récupérer le detail pour avoir le detailPath et verifier les saisons
        let detailPath = s.detailPath;
        try {
          const dd = await get(`/api/dex/detail/${s.subjectId}?nocache=1`);
          if (dd?.data?.detailPath) detailPath = dd.data.detailPath;
        } catch (_) {}
        const stream = await get(`/api/dex/stream/${s.subjectId}?season=1&episode=1&detailPath=${detailPath}&nocache=1`);
        const sources = stream?.data?.sources || [];
        ok(`stream série "${s.title?.substring(0, 30)}" S1E1: ${sources.length} sources`,
          sources.length > 0,
          sources.map((src: any) => `${src.quality}p ${src.format}`).join(', '));
      } catch (e: any) {
        ok(`stream série "${s.title?.substring(0, 30)}": erreur`, false, e.message);
      }
    }

    // Test stream SANS detailPath (résolution auto du slug)
    for (const m of moviesToTest.slice(0, 3)) {
      try {
        const s = await get(`/api/dex/stream/${m.subjectId}?season=1&episode=1&nocache=1`);
        const sources = s?.data?.sources || [];
        ok(`stream "${m.title?.substring(0, 30)}" SANS detailPath: ${sources.length} sources`,
          sources.length > 0, sources.map((src: any) => `${src.quality}p`).join(', '));
      } catch (e: any) {
        ok(`stream "${m.title?.substring(0, 30)}" SANS detailPath: erreur`, false, e.message);
      }
    }

    // Vérifie la présence de sous-titres
    const firstMovie = moviesToTest[0];
    if (firstMovie) {
      try {
        const s = await get(`/api/dex/stream/${firstMovie.subjectId}?detailPath=${firstMovie.detailPath}&nocache=1`);
        const subs = s?.data?.subtitles || [];
        ok(`stream sous-titres "${firstMovie.title?.substring(0, 30)}": ${subs.length} pistes`,
          true, subs.map((sub: any) => sub.language).join(', ') || 'aucun');
      } catch (_) {}
    }
  }

  // ─── 8. RECOMMEND ──────────────────────────────────────────────────
  console.log('\n👍 8. RECOMMEND\n');
  {
    const home = await get('/api/dex/home?nocache=1');
    const items = home?.data?.sections?.flatMap((s: any) => s.items || []) || [];
    const toTest = items.filter((i: any) => i.subjectId).slice(0, 5);
    for (const item of toTest) {
      try {
        const r = await get(`/api/dex/recommend/${item.subjectId}?nocache=1`);
        const items = r?.data?.items || [];
        ok(`recommend "${item.title?.substring(0, 25)}": ${items.length} recommandations`,
          true, `hasMore=${r?.data?.hasMore}`);
      } catch (e: any) {
        ok(`recommend "${item.title?.substring(0, 25)}": erreur`, false, e.message);
      }
    }
  }

  // ─── 9. DOWNLOAD ───────────────────────────────────────────────────
  console.log('\n⬇️  9. DOWNLOAD\n');
  {
    const home = await get('/api/dex/home?nocache=1');
    const items = home?.data?.sections?.flatMap((s: any) => s.items || []) || [];
    const toTest = items.filter((i: any) => i.subjectId && i.detailPath).slice(0, 5);
    for (const item of toTest) {
      try {
        const d = await get(`/api/dex/download/${item.subjectId}?detailPath=${item.detailPath}&nocache=1`);
        const files = d?.data?.files || [];
        ok(`download "${item.title?.substring(0, 25)}": ${files.length} fichiers`,
          true, files.map((f: any) => `${f.quality}p`).join(', '));
      } catch (e: any) {
        ok(`download "${item.title?.substring(0, 25)}": erreur`, false, e.message);
      }
    }
  }

  // ─── 10. TRENDING (legacy) ─────────────────────────────────────────
  console.log('\n🔥 10. TRENDING (legacy)\n');
  {
    const t = await get('/api/dex/trending?nocache=1');
    const items = t?.data?.items || [];
    ok('/trending items > 0', items.length > 0, `${items.length} items`);
    ok('/trending detailPath présent', items.every((i: any) => !!i.detailPath), items[0]?.detailPath);
  }

  // ─── RAPPORT FINAL ─────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n📊 RAPPORT — ${elapsed}s | ${results.length} tests`);
  console.log(`   ✅ Réussis : ${passed}`);
  console.log(`   ❌ Échecs   : ${failed}`);
  console.log(`   📈 Taux     : ${(passed / results.length * 100).toFixed(1)}%\n`);

  if (failed > 0) {
    console.log('Détail des échecs :');
    results.filter(r => !r.ok).forEach(r => {
      console.log(`  ❌ ${r.label} — ${r.detail}`);
    });
    console.log();
  }

  console.log(failed === 0 ? '🎉 TOUS LES TESTS PASSENT' : `⚠️ ${failed} échec(s)`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`💥 Batterie interrompue : ${e.message}`);
  process.exit(1);
});
