/**
 * Manuel duman testi - izleme gunlugu CRUD + filtreleme.
 * TMDb'ye cikmaz; kayitlar elle olusturulur (hizli ve deterministik).
 *
 * Kullanim: node scripts/test-entries.mjs [baseUrl]
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
      return { status: response.status, body: json };
    },
  };
}

const suffix = Date.now().toString(36).slice(-6);
const password = 'GucluSifre123';

console.log(`\nIzleme gunlugu testleri -> ${BASE_URL}\n`);

const alice = createClient();
const bob = createClient();

// Benzersiz TMDb kimlikleri: gercek TMDb kayitlarindan bagimsiz calisiriz
let nextTmdbId = Number(`9${Date.now().toString().slice(-6)}`);
function uniqueTmdbId() {
  nextTmdbId += 1;
  return nextTmdbId;
}

/** Kayit gövdesi uretir. */
function entryPayload(overrides = {}) {
  return {
    tmdbId: uniqueTmdbId(),
    mediaType: 'movie',
    title: 'Test Filmi',
    posterPath: '/testposter.jpg',
    releaseYear: 2020,
    status: 'watchlist',
    genres: [{ id: 28, name: 'Aksiyon' }],
    ...overrides,
  };
}

await test('oturumsuz erisim 401 doner', async () => {
  const res = await fetch(`${BASE_URL}/api/entries`);
  assert.equal(res.status, 401);
});

await test('iki test kullanicisi olusturuluyor', async () => {
  const a = await alice.request('POST', '/api/auth/register', { username: `alice_${suffix}`, password });
  const b = await bob.request('POST', '/api/auth/register', { username: `bob_${suffix}`, password });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(b.status, 201, JSON.stringify(b.body));
});

await test('bos gunluk bos liste doner', async () => {
  const res = await alice.request('GET', '/api/entries');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.items, []);
  assert.equal(res.body.total, 0);
  assert.equal(res.body.totalPages, 1);
});

let watchedEntry = null;

await test('kayit olusturuluyor (201) ve alanlar geri doner', async () => {
  const res = await alice.request(
    'POST',
    '/api/entries',
    entryPayload({
      title: 'Yildizlararasi',
      status: 'watched',
      rating: 9.5,
      review: 'Muhtesem bir bilim kurgu.',
      watchedAt: '2024-03-15',
      favorite: true,
      genres: [
        { id: 878, name: 'Bilim Kurgu' },
        { id: 12, name: 'Macera' },
      ],
    }),
  );
  assert.equal(res.status, 201, JSON.stringify(res.body));

  watchedEntry = res.body.entry;
  assert.equal(watchedEntry.title, 'Yildizlararasi');
  assert.equal(watchedEntry.rating, 9.5);
  assert.equal(watchedEntry.status, 'watched');
  assert.equal(watchedEntry.watchedAt, '2024-03-15');
  assert.equal(watchedEntry.favorite, true);
  assert.equal(watchedEntry.genres.length, 2);
  assert.match(watchedEntry.posterUrl, /^https:\/\/image\.tmdb\.org\/t\/p\//);
});

await test('ayni icerik tekrar eklenince 409 + mevcut kayit id gelir', async () => {
  const res = await alice.request('POST', '/api/entries', {
    tmdbId: watchedEntry.tmdbId,
    mediaType: 'movie',
    title: 'Yildizlararasi',
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.details.existingEntryId, watchedEntry.id);
});

await test('ayni tmdbId farkli mediaType ile eklenebilir', async () => {
  const res = await alice.request('POST', '/api/entries', {
    tmdbId: watchedEntry.tmdbId,
    mediaType: 'tv',
    title: 'Ayni kimlik, dizi surumu',
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  await alice.request('DELETE', `/api/entries/${res.body.entry.id}`);
});

await test('status verilmezse watchlist olur', async () => {
  const res = await alice.request('POST', '/api/entries', entryPayload({ title: 'Varsayilan Durum' }));
  assert.equal(res.status, 201);
  assert.equal(res.body.entry.status, 'watchlist');
  assert.equal(res.body.entry.watchedAt, null);
});

await test('watched eklenirken tarih verilmezse bugun atanir', async () => {
  const res = await alice.request('POST', '/api/entries', entryPayload({ status: 'watched' }));
  assert.equal(res.status, 201);
  assert.equal(res.body.entry.watchedAt, new Date().toISOString().slice(0, 10));
});

await test('gecersiz puan reddedilir (11)', async () => {
  const res = await alice.request('POST', '/api/entries', entryPayload({ rating: 11 }));
  assert.equal(res.status, 400);
  assert.equal(res.body.details.field, 'rating');
});

await test('yarim yildiz olmayan puan reddedilir (7.3)', async () => {
  const res = await alice.request('POST', '/api/entries', entryPayload({ rating: 7.3 }));
  assert.equal(res.status, 400);
  assert.equal(res.body.details.field, 'rating');
});

await test('gecersiz status reddedilir', async () => {
  const res = await alice.request('POST', '/api/entries', entryPayload({ status: 'izleniyor' }));
  assert.equal(res.status, 400);
  assert.equal(res.body.details.field, 'status');
});

await test('gelecek tarihli izleme tarihi reddedilir', async () => {
  const res = await alice.request('POST', '/api/entries', entryPayload({ status: 'watched', watchedAt: '2099-01-01' }));
  assert.equal(res.status, 400);
  assert.equal(res.body.details.field, 'watchedAt');
});

await test('yarinin tarihi kabul edilir (saat dilimi toleransi)', async () => {
  // Sunucu UTC calisir; UTC+3'te gece yarisindan sonra kullanicinin "bugun"u
  // UTC'ye gore yarindir. Bu yuzden bir gunluk tolerans olmali.
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const res = await alice.request('POST', '/api/entries', entryPayload({ status: 'watched', watchedAt: tomorrow }));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  await alice.request('DELETE', `/api/entries/${res.body.entry.id}`);
});

await test('takvimde olmayan tarih reddedilir (2024-02-30)', async () => {
  const res = await alice.request('POST', '/api/entries', entryPayload({ watchedAt: '2024-02-30' }));
  assert.equal(res.status, 400);
});

await test('dis alan adina isaret eden posterPath reddedilir', async () => {
  const res = await alice.request('POST', '/api/entries', entryPayload({ posterPath: 'https://kotu.site/x.jpg' }));
  assert.equal(res.status, 400);
  assert.equal(res.body.details.field, 'posterPath');
});

await test('eksik zorunlu alan reddedilir (tmdbId yok)', async () => {
  const res = await alice.request('POST', '/api/entries', { mediaType: 'movie', title: 'Kimliksiz' });
  assert.equal(res.status, 400);
  assert.equal(res.body.details.field, 'tmdbId');
});

await test('gecersiz tur listesi reddedilir', async () => {
  const res = await alice.request('POST', '/api/entries', entryPayload({ genres: [{ id: 'aksiyon' }] }));
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------
// Guncelleme
// ---------------------------------------------------------------------
await test('kismi guncelleme yalnizca gonderilen alani degistirir', async () => {
  const res = await alice.request('PATCH', `/api/entries/${watchedEntry.id}`, { rating: 8 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.entry.rating, 8);
  assert.equal(res.body.entry.review, 'Muhtesem bir bilim kurgu.', 'dokunulmamasi gereken alan degisti');
  assert.equal(res.body.entry.title, 'Yildizlararasi');
});

await test('null gondermek alani temizler', async () => {
  const res = await alice.request('PATCH', `/api/entries/${watchedEntry.id}`, { review: null });
  assert.equal(res.status, 200);
  assert.equal(res.body.entry.review, null);
});

await test('bos govde ile guncelleme 400 doner', async () => {
  const res = await alice.request('PATCH', `/api/entries/${watchedEntry.id}`, {});
  assert.equal(res.status, 400);
});

await test('watchlist -> watched gecisinde tarih otomatik atanir', async () => {
  const created = await alice.request('POST', '/api/entries', entryPayload({ title: 'Gecis Testi' }));
  const updated = await alice.request('PATCH', `/api/entries/${created.body.entry.id}`, { status: 'watched' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.entry.watchedAt, new Date().toISOString().slice(0, 10));
});

await test('tur listesi guncellenebilir', async () => {
  const res = await alice.request('PATCH', `/api/entries/${watchedEntry.id}`, {
    genres: [{ id: 18, name: 'Dram' }],
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.entry.genres.length, 1);
  assert.equal(res.body.entry.genres[0].name, 'Dram');
});

await test('updatedAt guncellemede tazelenir (trigger)', async () => {
  const before = await alice.request('GET', `/api/entries/${watchedEntry.id}`);
  await new Promise((resolve) => setTimeout(resolve, 30));
  const after = await alice.request('PATCH', `/api/entries/${watchedEntry.id}`, { favorite: false });
  assert.ok(
    after.body.entry.updatedAt > before.body.entry.updatedAt,
    `updatedAt tazelenmedi: ${before.body.entry.updatedAt} -> ${after.body.entry.updatedAt}`,
  );
});

// ---------------------------------------------------------------------
// Yetki izolasyonu
// ---------------------------------------------------------------------
await test("baska kullanicinin kaydi okunamaz (404)", async () => {
  const res = await bob.request('GET', `/api/entries/${watchedEntry.id}`);
  assert.equal(res.status, 404);
});

await test("baska kullanicinin kaydi guncellenemez (404)", async () => {
  const res = await bob.request('PATCH', `/api/entries/${watchedEntry.id}`, { rating: 1 });
  assert.equal(res.status, 404);
});

await test("baska kullanicinin kaydi silinemez (404)", async () => {
  const res = await bob.request('DELETE', `/api/entries/${watchedEntry.id}`);
  assert.equal(res.status, 404);
});

await test('bob kendi listesinde alice kayitlarini gormez', async () => {
  const res = await bob.request('GET', '/api/entries');
  assert.equal(res.body.total, 0);
});

// ---------------------------------------------------------------------
// Filtreleme / siralama / sayfalama
// ---------------------------------------------------------------------
await test('filtre veri kumesi hazirlaniyor', async () => {
  const dataset = [
    { title: 'Aksiyon Filmi', status: 'watched', rating: 9, genres: [{ id: 28, name: 'Aksiyon' }] },
    { title: 'Dram Filmi', status: 'watched', rating: 6, genres: [{ id: 18, name: 'Dram' }] },
    { title: 'Birakilan Dizi', mediaType: 'tv', status: 'dropped', rating: 3, genres: [{ id: 18, name: 'Dram' }] },
    { title: 'Izlenecek Dizi', mediaType: 'tv', status: 'watchlist', genres: [{ id: 35, name: 'Komedi' }] },
    { title: 'Puansiz Film', status: 'watched', genres: [{ id: 35, name: 'Komedi' }] },
  ];

  for (const item of dataset) {
    const res = await bob.request('POST', '/api/entries', entryPayload(item));
    assert.equal(res.status, 201, `${item.title}: ${JSON.stringify(res.body)}`);
  }

  const all = await bob.request('GET', '/api/entries');
  assert.equal(all.body.total, dataset.length);
});

await test('duruma gore filtreleme', async () => {
  const res = await bob.request('GET', '/api/entries?status=watched');
  assert.equal(res.body.total, 3);
  assert.ok(res.body.items.every((item) => item.status === 'watched'));
});

await test('ture gore filtreleme (mediaType)', async () => {
  const res = await bob.request('GET', '/api/entries?mediaType=tv');
  assert.equal(res.body.total, 2);
  assert.ok(res.body.items.every((item) => item.mediaType === 'tv'));
});

await test('genre kimligine gore filtreleme', async () => {
  const res = await bob.request('GET', '/api/entries?genreId=18');
  assert.equal(res.body.total, 2);
  assert.ok(res.body.items.every((item) => item.genres.some((genre) => genre.id === 18)));
});

await test('puan araligina gore filtreleme', async () => {
  const res = await bob.request('GET', '/api/entries?minRating=6&maxRating=9');
  assert.equal(res.body.total, 2);
  assert.ok(res.body.items.every((item) => item.rating >= 6 && item.rating <= 9));
});

await test('puansiz kayitlar filtrelenebilir', async () => {
  const res = await bob.request('GET', '/api/entries?unrated=true');
  assert.equal(res.body.total, 2, 'puansiz kayit sayisi beklenenden farkli');
  assert.ok(res.body.items.every((item) => item.rating === null));
});

await test('minRating > maxRating ise 400', async () => {
  const res = await bob.request('GET', '/api/entries?minRating=9&maxRating=2');
  assert.equal(res.status, 400);
});

await test('baslikta metin aramasi', async () => {
  const res = await bob.request('GET', '/api/entries?search=dizi');
  assert.equal(res.body.total, 2);
});

await test('SQL injection denemesi veri silmez/hata vermez', async () => {
  const res = await bob.request('GET', `/api/entries?search=${encodeURIComponent("'; DROP TABLE entries; --")}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 0, 'enjeksiyon metni sonuc dondurdu');

  const stillThere = await bob.request('GET', '/api/entries');
  assert.equal(stillThere.body.total, 5, 'kayitlar kayboldu (tablo dusmus olabilir)');
});

await test('LIKE joker karakterleri kacirilir (% her seyi getirmez)', async () => {
  const res = await bob.request('GET', '/api/entries?search=%25');
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 0, '"%" aramasi tum kayitlari getirdi');

  const underscore = await bob.request('GET', '/api/entries?search=_');
  assert.equal(underscore.body.total, 0, '"_" aramasi kayit getirdi');
});

await test('puana gore azalan siralama', async () => {
  const res = await bob.request('GET', '/api/entries?sort=rating&order=desc');
  const ratings = res.body.items.map((item) => item.rating);
  const rated = ratings.filter((value) => value !== null);
  assert.deepEqual(rated, [...rated].sort((a, b) => b - a), 'siralama bozuk');
  // Puansiz kayitlar sona atilmali
  assert.deepEqual(ratings.slice(rated.length), ratings.slice(rated.length).map(() => null));
});

await test('baslik alfabetik siralama', async () => {
  const res = await bob.request('GET', '/api/entries?sort=title&order=asc');
  const titles = res.body.items.map((item) => item.title);
  assert.deepEqual(titles, [...titles].sort((a, b) => a.localeCompare(b, 'tr')));
});

await test('gecersiz sort degeri 400 doner', async () => {
  const res = await bob.request('GET', '/api/entries?sort=puan');
  assert.equal(res.status, 400);
  assert.equal(res.body.details.field, 'sort');
});

await test('sayfalama calisiyor', async () => {
  const page1 = await bob.request('GET', '/api/entries?limit=2&page=1&sort=title&order=asc');
  const page2 = await bob.request('GET', '/api/entries?limit=2&page=2&sort=title&order=asc');

  assert.equal(page1.body.items.length, 2);
  assert.equal(page1.body.totalPages, 3);
  assert.equal(page2.body.items.length, 2);
  assert.notEqual(page1.body.items[0].id, page2.body.items[0].id, 'sayfalar ayni kaydi dondurdu');
});

await test('limit ust siniri asilamaz (400)', async () => {
  const res = await bob.request('GET', '/api/entries?limit=500');
  assert.equal(res.status, 400);
});

await test('kullanicinin turleri sayilariyla listelenir', async () => {
  const res = await bob.request('GET', '/api/entries/genres');
  assert.equal(res.status, 200);

  const drama = res.body.genres.find((genre) => genre.id === 18);
  assert.ok(drama, 'Dram turu listede yok');
  assert.equal(drama.count, 2);
  // Cok kullanilan tur basta olmali
  assert.ok(res.body.genres[0].count >= res.body.genres.at(-1).count);
});

await test('birden fazla filtre birlikte calisir', async () => {
  const res = await bob.request('GET', '/api/entries?status=watched&genreId=35&mediaType=movie');
  assert.equal(res.body.total, 1);
  assert.equal(res.body.items[0].title, 'Puansiz Film');
});

// ---------------------------------------------------------------------
// Silme
// ---------------------------------------------------------------------
await test('kayit silinir (204) ve tekrar silinemez (404)', async () => {
  const first = await alice.request('DELETE', `/api/entries/${watchedEntry.id}`);
  assert.equal(first.status, 204);

  const second = await alice.request('DELETE', `/api/entries/${watchedEntry.id}`);
  assert.equal(second.status, 404);

  const fetched = await alice.request('GET', `/api/entries/${watchedEntry.id}`);
  assert.equal(fetched.status, 404);
});

await test('silinen kaydin turleri de temizlenir (CASCADE)', async () => {
  const created = await alice.request('POST', '/api/entries', entryPayload({ genres: [{ id: 99, name: 'GeciciTur' }] }));
  await alice.request('DELETE', `/api/entries/${created.body.entry.id}`);

  const genres = await alice.request('GET', '/api/entries/genres');
  assert.ok(!genres.body.genres.some((genre) => genre.id === 99), 'silinen kaydin turu hala duruyor');
});

await test('gecersiz id bicimi 400 doner', async () => {
  const res = await alice.request('GET', '/api/entries/abc');
  assert.equal(res.status, 400);
});

await test('olmayan id 404 doner', async () => {
  const res = await alice.request('GET', '/api/entries/99999999');
  assert.equal(res.status, 404);
});

console.log(`\nSonuc: ${passed} basarili, ${failed} basarisiz\n`);
process.exit(failed === 0 ? 0 : 1);
