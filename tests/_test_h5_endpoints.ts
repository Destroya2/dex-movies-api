const BASE = 'https://h5-api.aoneroom.com';
const H = { 'x-requested-with': 'XMLHttpRequest', 'x-forwarded-for': '196.28.244.1', 'cf-connecting-ip': '196.28.244.1', 'user-agent': 'Mozilla/5.0' };

async function main() {
  const paths = [
    '/subject/trending?page=1&perPage=5',
    '/subject/home',
    '/subject/search?keyword=spider&page=1',
    '/subject/play/',
  ];
  for (const p of paths) {
    try {
      const r = await fetch(BASE + p, { headers: H });
      const text = await r.text();
      console.log(`${r.status} ${p} -> ${text.substring(0, 150)}`);
    } catch(e: any) { console.log(`ERR ${p} -> ${e.message}`); }
  }
}
main().catch(console.error);
