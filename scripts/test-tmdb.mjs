/**
 * Manuel duman testi - TMDb proxy.
 * Gercek TMDb API'sine cikar; internet baglantisi gerekir.
 *
 * Kullanim: node scripts/test-tmdb.mjs [baseUrl]
 */

import assert from 'node:assert/strict';

const BASE_URL = process.argv[2] ?? 'http://127.0.0.1:3000';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  OK   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL ${name}\n       ${error.message}`);
  }
}

/** Oturum cerezini tasiyan kucuk istemci. */
function createClient() {
  let cookie = '';
  return {
    async request(method, path, body) {
      const headers = { Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (cookie) headers.Cookie = cookie;

      const response = await fetch(BASE_URL + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      for (const raw of response.headers.getSetCookie?.() ?? []) {
        const pair = raw.split(';')[0];
        if (pair.startsWith('session_id=')) cookie = pair;
      }

      const text = await response.text();
      let json = null;
      try {
        json = text === '' ? null : JSON.parse(text);
      } catch {
        json = text;
      }
      return { status: response.status, body: json, headers: response.headers };
    },
  };
}

console.log(`\nTMDb proxy testleri -> ${BASE_URL}\n`);

const suffix = Date.now().toString(36).slice(-6);
const client = createClient();

await test('oturumsuz arama 401 doner (anahtar korumasi)', async () => {
  const res = await fetch(`${BASE_URL}/api/tmdb/search?query=matrix`);
  assert.equal(res.status, 401);
});

await test('test kullanicisi olusturuluyor', async () => {
  const res = await client.request('POST', '/api/auth/register', {
    username: `tmdb_${suffix}`,
    password: 'GucluSifre123',
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
});

await test('query parametresi olmadan 400', async () => {
  const res = await client.request('GET', '/api/tmdb/search');
  assert.equal(res.status, 400);
  assert.equal(res.body.details.field, 'query');
});

await test('gecersiz type degeri 400', async () => {
  const res = await client.request('GET', '/api/tmdb/search?query=matrix&type=kitap');
  assert.equal(res.status, 400);
  assert.equal(res.body.details.field, 'type');
});

await test('gecersiz sayfa numarasi 400', async () => {
  const res = await client.request('GET', '/api/tmdb/search?query=matrix&page=0');
  assert.equal(res.status, 400);
});

let firstResult = null;

await test('film aramasi sonuc doner ve alanlar normalize edilir', async () => {
  const res = await client.request('GET', '/api/tmdb/search?query=matrix&type=movie');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(Array.isArray(res.body.results), 'results dizi degil');
  assert.ok(res.body.results.length > 0, 'sonuc bos');

  firstResult = res.body.results[0];
  for (const field of ['tmdbId', 'mediaType', 'title', 'posterPath', 'releaseYear', 'genres']) {
    assert.ok(field in firstResult, `${field} alani eksik`);
  }
  assert.equal(firstResult.mediaType, 'movie');
  assert.equal(typeof firstResult.tmdbId, 'number');
  assert.ok(Array.isArray(firstResult.genres));
});

await test('tur adlari cozuluyor (tur filtresi icin gerekli)', async () => {
  const res = await client.request('GET', '/api/tmdb/search?query=inception&type=movie');
  const withGenres = res.body.results.find((item) => item.genres.length > 0);
  assert.ok(withGenres, 'hicbir sonucta tur adi cozulmemis');
  assert.equal(typeof withGenres.genres[0].name, 'string');
  assert.equal(typeof withGenres.genres[0].id, 'number');
});

await test('API anahtari yanitta sizmiyor', async () => {
  const res = await client.request('GET', '/api/tmdb/search?query=matrix');
  const serialized = JSON.stringify(res.body);
  assert.ok(!/api_key/i.test(serialized), 'yanitta api_key gecen bir alan var');
  assert.ok(!serialized.includes('be4a6d'), 'yanitta anahtar parcasi var');
});

await test('multi aramada person sonuclari filtrelenir', async () => {
  const res = await client.request('GET', '/api/tmdb/search?query=tom&type=multi');
  assert.equal(res.status, 200);
  const invalid = res.body.results.filter((item) => item.mediaType !== 'movie' && item.mediaType !== 'tv');
  assert.equal(invalid.length, 0, `desteklenmeyen tur sizdi: ${JSON.stringify(invalid.slice(0, 2))}`);
});

await test('dizi aramasi calisiyor', async () => {
  const res = await client.request('GET', '/api/tmdb/search?query=breaking bad&type=tv');
  assert.equal(res.status, 200);
  assert.ok(res.body.results.length > 0, 'dizi sonucu bos');
  assert.ok(res.body.results.every((item) => item.mediaType === 'tv'), 'mediaType tv degil');
});

await test('sonucsuz arama bos dizi doner (hata degil)', async () => {
  const res = await client.request('GET', '/api/tmdb/search?query=zzzxqwyvbnmasdfgh&type=movie');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.results, []);
});

await test('ikinci ayni arama onbellekten gelir', async () => {
  const first = await client.request('GET', '/api/tmdb/search?query=interstellar&type=movie');
  assert.equal(first.status, 200);

  const second = await client.request('GET', '/api/tmdb/search?query=INTERSTELLAR  &type=movie');
  assert.equal(second.status, 200);
  assert.equal(second.body.cached, true, 'onbellek isabeti olmadi');
  // Normalize edilmis sorgu ayni oldugu icin sonuclar da ayni olmali
  assert.equal(second.body.results[0].tmdbId, first.body.results[0].tmdbId);
});

await test('one cikanlar listesi geliyor', async () => {
  const res = await client.request('GET', '/api/tmdb/trending?window=week');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.results.length > 0);
  assert.ok(res.body.results.every((item) => ['movie', 'tv'].includes(item.mediaType)));
});

await test('detay ucu tur, sure ve oyuncu bilgisi doner', async () => {
  const res = await client.request('GET', `/api/tmdb/movie/${firstResult.tmdbId}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.tmdbId, firstResult.tmdbId);
  assert.ok(Array.isArray(res.body.genres) && res.body.genres.length > 0, 'tur listesi bos');
  assert.ok(Array.isArray(res.body.cast), 'cast dizi degil');
  assert.ok(res.body.cast.length <= 10, 'cast 10 kisiyi asiyor');
});

await test('gecersiz mediaType 400 doner', async () => {
  const res = await client.request('GET', '/api/tmdb/kitap/123');
  assert.equal(res.status, 400);
  assert.equal(res.body.details.field, 'mediaType');
});

await test('olmayan tmdbId icin 404', async () => {
  const res = await client.request('GET', '/api/tmdb/movie/999999999');
  assert.equal(res.status, 404, JSON.stringify(res.body));
});

await test('sayisal olmayan tmdbId 400 doner', async () => {
  const res = await client.request('GET', '/api/tmdb/movie/abc');
  assert.equal(res.status, 400);
});

console.log(`\nSonuc: ${passed} basarili, ${failed} basarisiz\n`);
process.exit(failed === 0 ? 0 : 1);
