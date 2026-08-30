/**
 * Kimlik dogrulama uclari.
 *
 *   POST   /api/auth/register   yeni kullanici + otomatik giris
 *   POST   /api/auth/login      giris
 *   POST   /api/auth/logout     cikis (oturumu veritabanindan siler)
 *   GET    /api/auth/me         mevcut oturum bilgisi
 *   POST   /api/auth/password   sifre degistirme (diger oturumlari dusurur)
 */

import { config } from '../config.js';
import {
  HttpError,
  buildClearCookie,
  buildSetCookie,
  sendEmpty,
  sendJson,
} from '../lib/http.js';
import { fakeVerify, verifyPassword } from '../lib/password.js';
import { assertRateLimit, bumpRateLimit, consumeRateLimit, resetRateLimit } from '../lib/rate-limit.js';
import { optionalEmail, optionalString, requireString } from '../lib/validate.js';
import { attachUser, requireAuth } from '../middleware/auth.js';
import {
  SESSION_MAX_AGE_SECONDS,
  createSession,
  destroySession,
  destroyUserSessions,
} from '../services/sessions.js';
import {
  createUser,
  findUserByUsername,
  toPublicUser,
  updateUserPassword,
} from '../services/users.js';

const USERNAME_PATTERN = /^[a-zA-Z0-9._-]+$/;
const MIN_PASSWORD_LENGTH = 8;
const REGISTER_WINDOW_MS = 60 * 60 * 1000; // kayit sinirlarinin pencere suresi (1 saat)

/** Kullanici adi dogrulama (ortak kural: kayit ve giriste ayni). */
function readUsername(body) {
  return requireString(body.username, 'username', {
    min: 3,
    max: 32,
    pattern: USERNAME_PATTERN,
    patternMessage: 'Kullanıcı adı yalnızca harf, rakam, nokta, alt tire ve tire içerebilir.',
  });
}

/** Sifre dogrulama. Ust sinir, scrypt'i DoS amaciyla yormayi engeller. */
function readPassword(body, field = 'password') {
  return requireString(body[field], field, { min: MIN_PASSWORD_LENGTH, max: 200 });
}

/** Oturum cerezini yaniti ile birlikte gonderir. */
function sessionCookieHeader(sessionId) {
  return {
    'Set-Cookie': buildSetCookie(config.session.cookieName, sessionId, {
      maxAgeSeconds: SESSION_MAX_AGE_SECONDS,
      path: '/',
      httpOnly: true,
      sameSite: 'Strict',
    }),
  };
}

/**
 * @param {ReturnType<import('../lib/router.js').createRouter>} router
 */
export function registerAuthRoutes(router) {
  // ------------------------------------------------------------------
  // Kayit
  // ------------------------------------------------------------------
  router.post('/api/auth/register', async (ctx) => {
    // Iki katmanli sinir:
    //  1) Toplam deneme: form hatalari da sayilir, tavan genis tutulur ki
    //     dalgin kullanici kilitlenmesin.
    consumeRateLimit(`register-attempt:${ctx.ip}`, {
      limit: 20,
      windowMs: REGISTER_WINDOW_MS,
      message: 'Çok fazla kayıt denemesi. Lütfen bir süre sonra tekrar deneyin.',
    });
    //  2) Gercekten olusturulan hesap: bot/spam savunmasi, tavan sikidir.
    //     Burada sayaci artirmiyoruz; kayit basarili olursa artiracagiz.
    assertRateLimit(`register-created:${ctx.ip}`, {
      limit: 5,
      message: 'Bu ağ adresinden çok fazla hesap oluşturuldu. Daha sonra tekrar deneyin.',
    });

    const body = await ctx.body();

    const username = readUsername(body);
    const password = readPassword(body);
    const email = optionalEmail(body.email, 'email');
    const displayName = optionalString(body.displayName, 'displayName', { max: 60 });

    // Sifrenin kullanici adiyla ayni olmasi cok yaygin bir zayiflik
    if (password.toLowerCase() === username.toLowerCase()) {
      throw new HttpError(400, 'Şifre kullanıcı adıyla aynı olamaz.', { field: 'password' });
    }

    // createUser, UNIQUE cakismasinda 409 firlatir.
    const user = createUser({ username, password, email, displayName });

    // Hesap olustu: "olusturulan hesap" sayacini simdi artir.
    bumpRateLimit(`register-created:${ctx.ip}`, REGISTER_WINDOW_MS);

    // Kayit sonrasi otomatik giris: yeni oturum olustur.
    const sessionId = createSession(user.id, {
      userAgent: ctx.req.headers['user-agent'],
      ip: ctx.ip,
    });

    sendJson(ctx.res, 201, { user: toPublicUser(user) }, sessionCookieHeader(sessionId));
  });

  // ------------------------------------------------------------------
  // Giris
  // ------------------------------------------------------------------
  router.post('/api/auth/login', async (ctx) => {
    const body = await ctx.body();

    const username = readUsername(body);
    // Giriste uzunluk kurallari uygulanmaz: eski/kisa sifreler de denenebilsin.
    // Yalnizca metin oldugu ve makul uzunlukta oldugu dogrulanir.
    const password = requireString(body.password, 'password', { min: 1, max: 200 });

    // IP + kullanici adi bazli sinir: 15 dakikada 10 basarisiz deneme.
    const rateKey = `login:${ctx.ip}:${username.toLowerCase()}`;
    consumeRateLimit(rateKey, {
      limit: 10,
      windowMs: 15 * 60 * 1000,
      message: 'Çok fazla başarısız giriş denemesi. Lütfen biraz sonra tekrar deneyin.',
    });

    const userRow = findUserByUsername(username);

    // Kullanici yoksa da ayni maliyette hesaplama yapilir (zamanlama esitleme)
    const isValid = userRow
      ? verifyPassword(password, {
          hash: userRow.password_hash,
          salt: userRow.password_salt,
          algo: userRow.password_algo,
        })
      : fakeVerify(password);

    if (!isValid) {
      // Hangisinin yanlis oldugunu soylemiyoruz (kullanici sizdirmasi savunmasi)
      throw new HttpError(401, 'Kullanıcı adı veya şifre hatalı.');
    }

    resetRateLimit(rateKey);

    // Oturum sabitleme (session fixation) savunmasi: her giriste YENI kimlik.
    const sessionId = createSession(userRow.id, {
      userAgent: ctx.req.headers['user-agent'],
      ip: ctx.ip,
    });

    sendJson(ctx.res, 200, { user: toPublicUser(userRow) }, sessionCookieHeader(sessionId));
  });

  // ------------------------------------------------------------------
  // Cikis
  // ------------------------------------------------------------------
  router.post('/api/auth/logout', (ctx) => {
    const sessionId = ctx.cookies[config.session.cookieName];
    if (sessionId) destroySession(sessionId);

    // Oturum gecersiz olsa bile cerezi temizle: istemci tarafi tutarli kalsin.
    sendEmpty(ctx.res, 204, { 'Set-Cookie': buildClearCookie(config.session.cookieName) });
  });

  // ------------------------------------------------------------------
  // Mevcut oturum
  // ------------------------------------------------------------------
  router.get('/api/auth/me', (ctx) => {
    // Arayuz acilista bu ucu cagirir; oturum yoksa 401 yerine null doneriz,
    // boylece istemci tarafinda "hata" yonetimine gerek kalmaz.
    const user = attachUser(ctx);
    sendJson(ctx.res, 200, { user });
  });

  // ------------------------------------------------------------------
  // Sifre degistirme
  // ------------------------------------------------------------------
  router.post('/api/auth/password', async (ctx) => {
    const user = requireAuth(ctx);
    const body = await ctx.body();

    const currentPassword = requireString(body.currentPassword, 'currentPassword', { min: 1, max: 200 });
    const newPassword = readPassword(body, 'newPassword');

    const userRow = findUserByUsername(user.username);
    const isValid = verifyPassword(currentPassword, {
      hash: userRow.password_hash,
      salt: userRow.password_salt,
      algo: userRow.password_algo,
    });
    if (!isValid) {
      throw new HttpError(401, 'Mevcut şifre hatalı.', { field: 'currentPassword' });
    }
    if (currentPassword === newPassword) {
      throw new HttpError(400, 'Yeni şifre eskisiyle aynı olamaz.', { field: 'newPassword' });
    }

    updateUserPassword(user.id, newPassword);

    // Guvenlik: sifre degisince TUM oturumlar dusurulur, ardindan bu cihaz
    // icin yeni bir oturum acilir (kullanici tekrar giris yapmak zorunda kalmasin).
    destroyUserSessions(user.id);
    const sessionId = createSession(user.id, {
      userAgent: ctx.req.headers['user-agent'],
      ip: ctx.ip,
    });

    sendJson(ctx.res, 200, { ok: true }, sessionCookieHeader(sessionId));
  });
}
