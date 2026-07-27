// Test: can we search via H5 API?
const BASE = 'https://h5-api.aoneroom.com';
const H5_HEADERS = {
  'x-requested-with': 'XMLHttpRequest',
  'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8',
  'x-forwarded-for': '196.28.244.1',
  'cf-connecting-ip': '196.28.244.1',
  'user-agent': 'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko)',
};

async function testH5Search() {
  console.log('=== H5: search suggest ===');
  const suggest = `${BASE}/subject/suggest?keyword=spider-noir`;
  let resp = await fetch(suggest, { headers: H5_HEADERS });
  console.log(`suggest: ${resp.status}`);
  let text = await resp.text();
  console.log(text.substring(0, 300));

  console.log('\n=== H5: search page ===');
  const search = `${BASE}/subject/search?keyword=spider-noir&page=1&perPage=20`;
  resp = await fetch(search, { headers: H5_HEADERS });
  console.log(`search: ${resp.status}`);
  text = await resp.text();
  console.log(text.substring(0, 500));
}

testH5Search().catch(console.error);
