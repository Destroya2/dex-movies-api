const BASE = 'https://h5-api.aoneroom.com';
const H: Record<string, string> = {
  'x-requested-with': 'XMLHttpRequest',
  'x-forwarded-for': '196.28.244.1',
  'cf-connecting-ip': '196.28.244.1',
  'user-agent': 'Mozilla/5.0',
  'accept': 'application/json',
};

async function main() {
  const r1 = await fetch(BASE + '/wefeed-h5api-bff/home?host=moviebox.ph', { headers: H });
  const u = JSON.parse(r1.headers.get('x-user') || '{}');
  const token = u.token || '';
  const authH = { ...H, 'authorization': 'Bearer ' + token, 'content-type': 'application/json' };

  // 1. Search specifically for "Spider-Man Noir"
  const q = 'Spider-Man Noir';
  console.log(`=== Search: "${q}" ===`);
  const r = await fetch(BASE + '/wefeed-h5api-bff/subject/search', { method: 'POST', headers: authH, body: JSON.stringify({ keyword: q, page: 1, perPage: 20 }) });
  const j = await r.json();
  const items = j?.data?.items || [];
  console.log(`Total: ${j?.data?.pager?.totalCount || '?'}`);
  for (const i of items) {
    console.log(`${i.subjectId} | ${i.title} | corner=${i.corner || '(none)'} | type=${i.subjectType}`);
  }

  // 2. Detail of the BW version - check for dubs/alternate versions
  console.log('\n=== Detail 8650122993986953880 ===');
  const d = await fetch(BASE + `/wefeed-h5api-bff/detail?subjectId=8650122993986953880`, { headers: authH });
  const dj = await d.json();
  const sub = dj?.data?.subject || {};
  const res = dj?.data?.resource || {};
  console.log(`subjectId: ${sub.subjectId}`);
  console.log(`dubs: ${JSON.stringify(sub.dubs || [])}`);
  console.log(`resources: ${JSON.stringify(Object.keys(res))}`);
}
main().catch(console.error);
