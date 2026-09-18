/**
 * Sifre sifirlama araci (yonetici icin).
 *
 * Uygulamada "sifremi unuttum" akisi yok: e-posta gondermek harici bir servis
 * gerektirirdi ve projenin "sifir bagimlilik" kurali bunu disarida birakiyor.
 * Onun yerine sunucuya erisebilen kisi bu betikle sifreyi sifirlar.
 *
 * Kullanim:
 *   node scripts/reset-password.mjs <kullaniciadi>               # rastgele sifre uretir
 *   node scripts/reset-password.mjs <kullaniciadi> <yeni-sifre>  # verilen sifreyi atar
 *
 * Sifre degistikten sonra kullanicinin TUM oturumlari dusurulur: hesap ele
 * gecirildigi icin sifirlaniyorsa saldirganin acik oturumu da kapanir.
 */

import { randomBytes } from 'node:crypto';

import { closeDatabase } from '../src/db/index.js';
import { destroyUserSessions } from '../src/services/sessions.js';
import { findUserByUsername, updateUserPassword } from '../src/services/users.js';

const MIN_PASSWORD_LENGTH = 8;

/** Okunabilir, karistirilmasi zor karakterlerden rastgele sifre uretir. */
function generatePassword(length = 20) {
  // Benzer gorunen karakterler (0/O, 1/l/I) bilincli olarak disarida:
  // sifre buyuk ihtimalle telefonda okunup elle yazilacak.
  const alphabet = 'abcdefghijkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789';

  let password = '';
  for (const byte of randomBytes(length)) password += alphabet[byte % alphabet.length];
  return password;
}

function fail(message) {
  console.error(`\nHata: ${message}\n`);
  closeDatabase();
  process.exit(1);
}

const [username, providedPassword] = process.argv.slice(2);

if (!username) {
  console.error('\nKullanim: node scripts/reset-password.mjs <kullaniciadi> [yeni-sifre]\n');
  closeDatabase();
  process.exit(1);
}

const user = findUserByUsername(username);
if (!user) fail(`"${username}" adli kullanici bulunamadi.`);

if (providedPassword !== undefined && providedPassword.length < MIN_PASSWORD_LENGTH) {
  fail(`Sifre en az ${MIN_PASSWORD_LENGTH} karakter olmali.`);
}

const newPassword = providedPassword ?? generatePassword();

updateUserPassword(user.id, newPassword);
const closedSessions = destroyUserSessions(user.id);

console.log(`\nSifre guncellendi: ${user.username} (id: ${user.id})`);
if (providedPassword === undefined) {
  console.log(`Yeni sifre       : ${newPassword}`);
  console.log('Bu sifreyi guvenli bir kanaldan iletin; tekrar goruntulenemez.');
}
console.log(`Dusurulen oturum : ${closedSessions}\n`);

closeDatabase();
