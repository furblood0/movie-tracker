/**
 * Sifre hash'leme (node:crypto, harici bcrypt/argon2 paketi YOK).
 *
 * Yaklasim:
 *  - Her kullanici icin 16 baytlik rastgele salt uretilir (rainbow table savunmasi).
 *  - `scryptSync` bellek-yogun bir KDF'dir; GPU ile kaba kuvvet denemesini pahalilastirir.
 *  - Karsilastirma `timingSafeEqual` ile yapilir (zamanlama saldirisi savunmasi).
 *  - Duz sifre hicbir yerde saklanmaz veya loglanmaz.
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const ALGORITHM = 'scrypt';
const KEY_LENGTH = 64; // uretilecek anahtarin bayt uzunlugu
const SALT_LENGTH = 16;

/**
 * scrypt maliyet parametreleri.
 * N=2^15 varsayilan maxmem (32 MB) sinirini astigi icin maxmem'i de yukseltiyoruz.
 */
const SCRYPT_OPTIONS = {
  N: 32_768, // CPU/bellek maliyeti
  r: 8, // blok boyutu
  p: 1, // paralellik
  maxmem: 128 * 1024 * 1024,
};

/**
 * Duz sifreyi hash'ler.
 * @param {string} plainPassword
 * @returns {{ hash: string, salt: string, algo: string }} hex kodlu degerler
 */
export function hashPassword(plainPassword) {
  const salt = randomBytes(SALT_LENGTH);
  const derivedKey = scryptSync(plainPassword, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return {
    hash: derivedKey.toString('hex'),
    salt: salt.toString('hex'),
    algo: ALGORITHM,
  };
}

/**
 * Duz sifreyi kayitli hash ile karsilastirir.
 * @param {string} plainPassword
 * @param {{ hash: string, salt: string, algo?: string }} stored
 * @returns {boolean}
 */
export function verifyPassword(plainPassword, stored) {
  if (!stored?.hash || !stored?.salt) return false;
  if (stored.algo && stored.algo !== ALGORITHM) return false;

  try {
    const expected = Buffer.from(stored.hash, 'hex');
    const actual = scryptSync(plainPassword, Buffer.from(stored.salt, 'hex'), expected.length, SCRYPT_OPTIONS);
    // Uzunluk farkliysa timingSafeEqual hata firlatir; onceden kontrol et.
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// Kullanici bulunamadiginda da ayni maliyette bir hesaplama yapmak icin
// kullanilan sahte kayit. Boylece "kullanici var mi?" sorusu yanit suresinden
// anlasilamaz (user enumeration savunmasi).
const DUMMY_RECORD = hashPassword(randomBytes(24).toString('hex'));

/** Kullanici yoksa cagrilir: zamanlamayi esitler, her zaman false doner. */
export function fakeVerify(plainPassword) {
  verifyPassword(plainPassword, DUMMY_RECORD);
  return false;
}
