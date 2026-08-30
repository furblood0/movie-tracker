/**
 * Girdi dogrulama yardimcilari.
 *
 * Tum uc noktalar govdeden gelen veriyi DOGRUDAN kullanmaz; once buradaki
 * fonksiyonlardan gecirir. Hata durumunda HttpError(400) firlatilir ve
 * `details` alaninda hangi alanin neden reddedildigi istemciye bildirilir.
 */

import { HttpError } from './http.js';

/** Alan bazli hata firlatir. */
function fail(field, message) {
  throw new HttpError(400, message, { field });
}

/**
 * Zorunlu metin alani.
 * @param {unknown} value
 * @param {string} field Hata mesajinda gorunecek alan adi
 * @param {{ min?: number, max?: number, pattern?: RegExp, patternMessage?: string }} [options]
 * @returns {string} Bas/son bosluklari kirpilmis deger
 */
export function requireString(value, field, options = {}) {
  const { min = 1, max = 1000, pattern, patternMessage } = options;

  if (typeof value !== 'string') fail(field, `"${field}" alanı metin olmalıdır.`);
  const trimmed = value.trim();

  if (trimmed.length < min) fail(field, `"${field}" en az ${min} karakter olmalıdır.`);
  if (trimmed.length > max) fail(field, `"${field}" en fazla ${max} karakter olabilir.`);
  if (pattern && !pattern.test(trimmed)) fail(field, patternMessage ?? `"${field}" geçersiz karakterler içeriyor.`);

  return trimmed;
}

/**
 * Istege bagli metin alani. Bos/undefined/null ise null doner.
 * @returns {string | null}
 */
export function optionalString(value, field, options = {}) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  return requireString(value, field, options);
}

/**
 * Belirli degerlerden biri olmasi gereken alan (enum).
 * @template {string} T
 * @param {unknown} value
 * @param {string} field
 * @param {readonly T[]} allowed
 * @returns {T}
 */
export function requireEnum(value, field, allowed) {
  if (typeof value !== 'string' || !allowed.includes(/** @type {T} */ (value))) {
    fail(field, `"${field}" şu değerlerden biri olmalıdır: ${allowed.join(', ')}`);
  }
  return /** @type {T} */ (value);
}

/**
 * Sayisal alan. Metin de kabul edilir ("8.5"), sayiya cevrilir.
 * @param {{ min?: number, max?: number, integer?: boolean, step?: number }} [options]
 * @returns {number}
 */
export function requireNumber(value, field, options = {}) {
  const { min = -Infinity, max = Infinity, integer = false, step } = options;

  const parsed = typeof value === 'number' ? value : Number(value);
  if (typeof value === 'boolean' || value === null || value === '' || !Number.isFinite(parsed)) {
    fail(field, `"${field}" geçerli bir sayı olmalıdır.`);
  }
  if (integer && !Number.isInteger(parsed)) fail(field, `"${field}" tam sayı olmalıdır.`);
  if (parsed < min || parsed > max) fail(field, `"${field}" ${min} ile ${max} arasında olmalıdır.`);

  if (step) {
    // Kayan nokta hatasini onlemek icin yuvarlayarak karsilastir
    const remainder = Math.abs(Math.round(parsed / step) * step - parsed);
    if (remainder > 1e-9) fail(field, `"${field}" ${step} adımlarla verilmelidir.`);
  }
  return parsed;
}

/** Istege bagli sayi; bos ise null. */
export function optionalNumber(value, field, options = {}) {
  if (value === undefined || value === null || value === '') return null;
  return requireNumber(value, field, options);
}

/** Istege bagli boolean; 0/1, "true"/"false" degerlerini de kabul eder. */
export function optionalBoolean(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return fail(field, `"${field}" true/false olmalıdır.`);
}

/**
 * YYYY-MM-DD bicimli tarih. Takvimde gercekten var olup olmadigi da kontrol edilir.
 * @returns {string | null}
 */
export function optionalDate(value, field) {
  if (value === undefined || value === null || value === '') return null;

  const text = requireString(value, field, { min: 10, max: 10 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) fail(field, `"${field}" YYYY-MM-DD biçiminde olmalıdır.`);

  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  if (!isRealDate) fail(field, `"${field}" takvimde geçerli bir tarih değil.`);

  return text;
}

/** E-posta icin pratik (asiri kati olmayan) dogrulama. */
export function optionalEmail(value, field) {
  const text = optionalString(value, field, { max: 254 });
  if (text === null) return null;
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(text)) fail(field, 'Geçerli bir e-posta adresi girin.');
  return text.toLowerCase();
}

/** URL yolundan gelen ":id" gibi parametreleri pozitif tam sayiya cevirir. */
export function requireId(value, field = 'id') {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, `"${field}" pozitif bir tam sayı olmalıdır.`, { field });
  }
  return parsed;
}
