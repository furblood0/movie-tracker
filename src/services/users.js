/**
 * Kullanici veri erisim katmani.
 *
 * Tum sorgular prepared statement + bagli parametre kullanir; kullanici
 * girdisi asla SQL metnine eklenmez (SQL Injection korumasi).
 */

import { db, nowIso } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import { hashPassword } from '../lib/password.js';

// Sorgular modul yuklenirken bir kez hazirlanir (prepare), her cagrida yeniden
// derlenmez. Bu hem daha hizli hem de enjeksiyona kapali bir yaklasimdir.
const insertUserStatement = db.prepare(`
  INSERT INTO users (username, email, display_name, password_hash, password_salt, password_algo)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const selectByUsernameStatement = db.prepare(`
  SELECT id, username, email, display_name, password_hash, password_salt, password_algo, created_at
    FROM users
   WHERE username = ?
`);

const selectByEmailStatement = db.prepare(`
  SELECT id FROM users WHERE email = ?
`);

const selectByIdStatement = db.prepare(`
  SELECT id, username, email, display_name, created_at
    FROM users
   WHERE id = ?
`);

const updatePasswordStatement = db.prepare(`
  UPDATE users
     SET password_hash = ?, password_salt = ?, password_algo = ?, updated_at = ?
   WHERE id = ?
`);

/**
 * Yeni kullanici olusturur.
 * @param {{ username: string, password: string, email?: string | null, displayName?: string | null }} input
 * @returns {{ id: number, username: string, email: string | null, display_name: string | null, created_at: string }}
 */
export function createUser({ username, password, email = null, displayName = null }) {
  const { hash, salt, algo } = hashPassword(password);

  try {
    const result = insertUserStatement.run(username, email, displayName ?? username, hash, salt, algo);
    return findUserById(Number(result.lastInsertRowid));
  } catch (error) {
    // UNIQUE kisiti: kullanici adi veya e-posta zaten kayitli.
    if (String(error.message).includes('UNIQUE constraint failed')) {
      const field = String(error.message).includes('users.email') ? 'email' : 'username';
      throw new HttpError(
        409,
        field === 'email' ? 'Bu e-posta adresi zaten kayitli.' : 'Bu kullanici adi zaten alinmis.',
        { field },
      );
    }
    throw error;
  }
}

/** Kullanici adina gore kaydi (hash alanlari dahil) getirir. */
export function findUserByUsername(username) {
  return selectByUsernameStatement.get(username) ?? null;
}

/** E-posta zaten kullaniliyor mu? */
export function isEmailTaken(email) {
  return selectByEmailStatement.get(email) !== undefined;
}

/** Id'ye gore kullanicinin herkese acik alanlarini getirir. */
export function findUserById(id) {
  return selectByIdStatement.get(id) ?? null;
}

/** Sifreyi degistirir (yeni salt ile yeniden hash'lenir). */
export function updateUserPassword(userId, newPassword) {
  const { hash, salt, algo } = hashPassword(newPassword);
  updatePasswordStatement.run(hash, salt, algo, nowIso(), userId);
}

/**
 * Veritabani satirini istemciye gonderilebilir hale getirir.
 * Hash/salt gibi alanlar buradan ASLA disari cikmaz.
 */
export function toPublicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email ?? null,
    displayName: row.display_name ?? row.username,
    createdAt: row.created_at,
  };
}
