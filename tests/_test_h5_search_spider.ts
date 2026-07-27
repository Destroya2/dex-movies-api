const BASE = 'https://h5-api.aoneroom.com';
const H: Record<string, string> = {
  'x-requested-with': 'XMLHttpRequest',
  'x-forwarded-for': '196.28.244.1',
  'cf-connecting-ip': '196.28.244.1',
  'user-agent': 'Mozilla/5.0',
  'accept': 'application/json',
};

async function main() {
  try {
    const r1 = await fetch(BASE + '/wefeed-h5api-bff/home?host=moviebox.ph', { headers: H });
    const u = JSON.parse(r1.headers.get('x-user') || '{}');
    const token = u.token || '';
    const authH = { ...H, 'authorization': 'Bearer ' + token, 'content-type': 'application/json' };

    // Search for Spider-Man Noir VF
    const searches = ['Spider-Man Noir', 'Spider-Man', 'spider'];
    for (const q of searches) {
      const r = await fetch(BASE + '/wefeed-h5api-bff/subject/search', { method: 'POST', headers: authH, body: JSON.stringify({ keyword: q, page: 1, perPage: 10 }) });
      const j = await r.json();
      const items = j?.data?.items || [];
      const spiderItems = items.filter((i: any) => i.title?.toLowerCase().includes('spider'));
      for (const i of spiderItems) {
        console.log(`${i.subjectId} | ${i.title} | corner=${i.corner || '(none)'} | detailPath=${i.detailPath || '(none)'}`);
      }
    }

    // Also check the detail of the specific one we found
    console.log('\n=== Detail of Spider-Noir [Black&White] ===');
    const r2 = await fetch(BASE + `/wefeed-h5api-bff/detail?subjectId=8650122993986953880`, { headers: authH });
    const j2 = await r2.json();
    const sub = j2?.data?.subject || {};
    console.log(`Title: ${sub.title}`);
    console.log(`Dubs: ${JSON.stringify(sub.dubs || [])}`);
    console.log(`Corner: ${sub.corner}`);

  } catch (e: any) { console.log('ERROR:', e.message); }
}

main().catch(console.error);
