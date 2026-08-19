/**
 * Bellek ici (in-memory) hiz sinirlayici.
 *
 * Amac: giris/kayit uclarina yapilan kaba kuvvet denemelerini yavaslatmak.
 * Sabit pencere (fixed window) sayaci kullanilir; tek sunucu icin yeterlidir.
 * (Coklu sunucuya gecilirse bu mantik Redis benzeri paylasimli bir depoya tasinir.)
 */

import { HttpError } from './http.js';

/** @type {Map<string, { count: number, resetAt: number }>} */
const buckets = new Map();

// Bellegi sisirmemek icin suresi gecmis kovalari periyodik temizle
const pruneTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 60_000);
pruneTimer.unref();

/**
 * Bir istegi sayar; sinir asilirsa 429 firlatir.
 * @param {string} key Ornek: "login:127.0.0.1"
 * @param {{ limit: number, windowMs: number, message?: string }} options
 */
export function consumeRateLimit(key, { limit, windowMs, message }) {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    const error = new HttpError(
      429,
      message ?? `Cok fazla deneme yaptiniz. ${retryAfterSeconds} saniye sonra tekrar deneyin.`,
      { retryAfterSeconds },
    );
    error.headers = { 'Retry-After': String(retryAfterSeconds) };
    throw error;
  }
}

/**
 * Sayaci ARTIRMADAN sinira ulasilip ulasilmadigini kontrol eder.
 * "Sadece basarili islemleri say" senaryosu icin kullanilir: once bu
 * fonksiyonla izin alinir, islem basarili olursa `bumpRateLimit` cagrilir.
 * @param {string} key
 * @param {{ limit: number, message?: string }} options
 */
export function assertRateLimit(key, { limit, message }) {
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= Date.now()) return;

  if (bucket.count >= limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - Date.now()) / 1000));
    const error = new HttpError(429, message ?? 'Islem siniri asildi. Daha sonra tekrar deneyin.', {
      retryAfterSeconds,
    });
    error.headers = { 'Retry-After': String(retryAfterSeconds) };
    throw error;
  }
}

/** Sayaci artirir, sinir asilsa bile hata firlatmaz. */
export function bumpRateLimit(key, windowMs) {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) buckets.set(key, { count: 1, resetAt: now + windowMs });
  else bucket.count += 1;
}

/** Basarili islemden sonra sayaci sifirlar (ornek: dogru sifre girildi). */
export function resetRateLimit(key) {
  buckets.delete(key);
}
