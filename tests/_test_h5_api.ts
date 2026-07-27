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
    console.log('home status:', r1.status);
    const u = r1.headers.get('x-user');
    let token = '';
    if (u) { const p = JSON.parse(u); token = p.token; }
    console.log('Token:', token ? token.substring(0, 30) + '...' : 'NONE');

    if (!token) { console.log('NO TOKEN'); return; }

    const authH = { ...H, 'authorization': 'Bearer ' + token, 'content-type': 'application/json' };

    const r2 = await fetch(BASE + '/wefeed-h5api-bff/subject/search', { method: 'POST', headers: authH, body: JSON.stringify({ keyword: 'spider-noir', page: 1, perPage: 20 }) });
    const t2 = await r2.text();
    console.log('search:', r2.status, t2.substring(0, 300));

    const r3 = await fetch(BASE + '/wefeed-h5api-bff/subject/search-suggest', { method: 'POST', headers: authH, body: JSON.stringify({ keyword: 'spider', perPage: 5 }) });
    const t3 = await r3.text();
    console.log('suggest:', r3.status, t3.substring(0, 300));
  } catch (e: any) { console.log('ERROR:', e.message); }
}

main().catch(console.error);
