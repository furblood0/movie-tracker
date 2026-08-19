/**
 * Manuel duman testi (smoke test) - kimlik dogrulama akisi.
 * Harici test kutuphanesi yok; node:assert ve fetch yeterli.
 *
 * Kullanim:  node scripts/test-auth.mjs [baseUrl]
 * Ornek:     node scripts/test-auth.mjs http://127.0.0.1:3000
 */

import assert from 'node:assert/strict';

const BASE_URL = process.argv[2] ?? 'http://127.0.0.1:3000';

let passed = 0;
let failed = 0;

/** Tek bir kontrolu calistirir ve sonucu yazdirir. */
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

/** Cerezleri elle tasiyan kucuk bir istemci (tarayici davranisi taklidi). */
function createClient() {
  const cookies = new Map();

  return {
    get cookieHeader() {
      return [...cookies].map(([key, value]) => `${key}=${value}`).join('; ');
    },
    hasCookie(name) {
      return cookies.has(name);
    },
    async request(method, path, body) {
      const headers = { Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (cookies.size > 0) headers.Cookie = this.cookieHeader;

      const response = await fetch(BASE_URL + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      // Set-Cookie basliklarini isle (Max-Age=0 ise cerezi sil)
      for (const raw of response.headers.getSetCookie?.() ?? []) {
        const [pair, ...attributes] = raw.split(';').map((part) => part.trim());
        const separatorIndex = pair.indexOf('=');
        const name = pair.slice(0, separatorIndex);
        const value = pair.slice(separatorIndex + 1);
        const isExpired = attributes.some((attribute) => /^max-age=0$/i.test(attribute));
        if (isExpired || value === '') cookies.delete(name);
        else cookies.set(name, value);
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

// Her kosuda benzersiz kullanici adi: veritabani temizlemeye gerek kalmasin
const suffix = Date.now().toString(36).slice(-6);
const username = `test_${suffix}`;
const password = 'GucluSifre123';

console.log(`\nKimlik dogrulama testleri -> ${BASE_URL}\n`);

const client = createClient();

await test('oturum yokken /api/auth/me -> user: null', async () => {
  const res = await client.request('GET', '/api/auth/me');
  assert.equal(res.status, 200);
  assert.equal(res.body.user, null);
});

await test('kisa sifre ile kayit reddedilir (400)', async () => {
  const res = await client.request('POST', '/api/auth/register', { username, password: '123' });
  assert.equal(res.status, 400);
  assert.equal(res.body.details.field, 'password');
});

await test('gecersiz kullanici adi reddedilir (400)', async () => {
  const res = await client.request('POST', '/api/auth/register', { username: 'ab!', password });
  assert.equal(res.status, 400);
  assert.equal(res.body.details.field, 'username');
});

await test('gecersiz e-posta reddedilir (400)', async () => {
  const res = await client.request('POST', '/api/auth/register', {
    username,
    password,
    email: 'bozuk-adres',
  });
  assert.equal(res.status, 400);
});

await test('kayit basarili (201) ve oturum cerezi gelir', async () => {
  const res = await client.request('POST', '/api/auth/register', {
    username,
    password,
    email: `${username}@example.com`,
  });
  assert.equal(res.status, 201, `beklenen 201, gelen ${res.status}: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.user.username, username);
  assert.ok(client.hasCookie('session_id'), 'session_id cerezi ayarlanmadi');

  const setCookie = res.headers.getSetCookie()[0];
  assert.match(setCookie, /HttpOnly/, 'HttpOnly eksik');
  assert.match(setCookie, /SameSite=Strict/, 'SameSite=Strict eksik');
  assert.match(setCookie, /Path=\//, 'Path=/ eksik');
});

await test('yanitta sifre/hash alanlari sizmaz', async () => {
  const res = await client.request('GET', '/api/auth/me');
  const serialized = JSON.stringify(res.body);
  assert.ok(!serialized.includes('password'), 'yanitta password gecen bir alan var');
  assert.ok(!serialized.includes('salt'), 'yanitta salt gecen bir alan var');
});

await test('kayittan sonra /api/auth/me kullaniciyi doner', async () => {
  const res = await client.request('GET', '/api/auth/me');
  assert.equal(res.status, 200);
  assert.equal(res.body.user.username, username);
});

await test('ayni kullanici adi tekrar alinamaz (409)', async () => {
  const res = await client.request('POST', '/api/auth/register', { username, password });
  assert.equal(res.status, 409);
  assert.equal(res.body.details.field, 'username');
});

await test('cikis sonrasi oturum dusuyor (204 + cerez silinir)', async () => {
  const logout = await client.request('POST', '/api/auth/logout');
  assert.equal(logout.status, 204);
  assert.ok(!client.hasCookie('session_id'), 'cerez silinmedi');

  const me = await client.request('GET', '/api/auth/me');
  assert.equal(me.body.user, null);
});

await test('yanlis sifre ile giris reddedilir (401)', async () => {
  const res = await client.request('POST', '/api/auth/login', { username, password: 'YanlisSifre1' });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'Kullanici adi veya sifre hatali.');
});

await test('olmayan kullanici da ayni 401 mesajini alir', async () => {
  const res = await client.request('POST', '/api/auth/login', {
    username: 'hicyokboyle_kullanici',
    password,
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'Kullanici adi veya sifre hatali.');
});

await test('dogru sifre ile giris basarili (200)', async () => {
  const res = await client.request('POST', '/api/auth/login', { username, password });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.username, username);
  assert.ok(client.hasCookie('session_id'));
});

await test('sahte oturum kimligi kabul edilmez', async () => {
  const fake = createClient();
  const res = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { Cookie: `session_id=${'a'.repeat(64)}` },
  });
  const json = await res.json();
  assert.equal(json.user, null);
  assert.equal(fake.hasCookie('session_id'), false);
});

await test('korumali uc oturumsuz 401 doner', async () => {
  const res = await fetch(`${BASE_URL}/api/auth/password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: password, newPassword: 'YeniSifre123' }),
  });
  assert.equal(res.status, 401);
});

await test('sifre degistirme calisir ve yeni sifre ile giris yapilir', async () => {
  const newPassword = 'YeniGucluSifre456';

  const change = await client.request('POST', '/api/auth/password', {
    currentPassword: password,
    newPassword,
  });
  assert.equal(change.status, 200, JSON.stringify(change.body));

  // Sifre degisiminden sonra bu cihazin oturumu gecerli olmali
  const me = await client.request('GET', '/api/auth/me');
  assert.equal(me.body.user.username, username);

  // Yeni sifre ile temiz bir istemciden giris
  const fresh = createClient();
  const login = await fresh.request('POST', '/api/auth/login', { username, password: newPassword });
  assert.equal(login.status, 200);

  // Eski sifre artik gecersiz
  const oldLogin = await fresh.request('POST', '/api/auth/login', { username, password });
  assert.equal(oldLogin.status, 401);
});

await test('sifre degisimi diger oturumlari dusurur', async () => {
  const deviceA = createClient();
  const deviceB = createClient();
  const user2 = `test2_${suffix}`;

  await deviceA.request('POST', '/api/auth/register', { username: user2, password });
  await deviceB.request('POST', '/api/auth/login', { username: user2, password });

  // B cihazi sifreyi degistirir -> A cihazinin oturumu gecersiz olmali
  const change = await deviceB.request('POST', '/api/auth/password', {
    currentPassword: password,
    newPassword: 'BambaskaSifre789',
  });
  assert.equal(change.status, 200, JSON.stringify(change.body));

  const meA = await deviceA.request('GET', '/api/auth/me');
  assert.equal(meA.body.user, null, 'A cihazinin oturumu dusmedi');

  const meB = await deviceB.request('GET', '/api/auth/me');
  assert.equal(meB.body.user.username, user2);
});

await test('kaba kuvvet denemeleri 429 ile sinirlanir', async () => {
  const attacker = createClient();
  let sawTooMany = false;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const res = await attacker.request('POST', '/api/auth/login', {
      username: `kurban_${suffix}`,
      password: `deneme${attempt}`,
    });
    if (res.status === 429) {
      sawTooMany = true;
      assert.ok(res.headers.get('retry-after'), 'Retry-After basligi yok');
      break;
    }
  }
  assert.ok(sawTooMany, '12 denemeden sonra bile 429 gelmedi');
});

console.log(`\nSonuc: ${passed} basarili, ${failed} basarisiz\n`);
process.exit(failed === 0 ? 0 : 1);
