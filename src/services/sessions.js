/**
 * Oturum yonetimi (sunucu tarafli).
 *
 * Tasarim: cerezde imzali/kodlanmis veri (JWT gibi) TASINMAZ; yalnizca
 * tahmin edilemez rastgele bir kimlik tasinir. Yetki dogrulamasi her istekte
 * veritabanindan yapilir -> oturum aninda iptal edilebilir.
 */

import { randomBytes } from 'node:crypto';

import { config } from '../config.js';
import { db, isoFromNow, nowIso } from '../db/index.js';

const insertSessionStatement = db.prepare(`
  INSERT INTO sessions (id, user_id, expires_at, user_agent, ip_address)
  VALUES (?, ?, ?, ?, ?)
`);

// Oturum ve kullanicisi tek sorguda: her istekte iki gidis-gelis olmasin.
const selectSessionStatement = db.prepare(`
  SELECT s.id          AS session_id,
         s.expires_at  AS expires_at,
         s.last_seen_at AS last_seen_at,
         u.id          AS id,
         u.username    AS username,
         u.email       AS email,
         u.display_name AS display_name,
         u.created_at  AS created_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
   WHERE s.id = ?
     AND s.expires_at > ?
`);

const touchSessionStatement = db.prepare(`
  UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?
`);

const deleteSessionStatement = db.prepare('DELETE FROM sessions WHERE id = ?');
const deleteUserSessionsStatement = db.prepare('DELETE FROM sessions WHERE user_id = ?');

/** Oturum cerezinin saniye cinsinden omru. */
export const SESSION_MAX_AGE_SECONDS = config.session.ttlDays * 24 * 60 * 60;

/**
 * Yeni oturum olusturur.
 * @param {number} userId
 * @param {{ userAgent?: string, ip?: string }} [meta]
 * @returns {string} Cereze yazilacak oturum kimligi
 */
export function createSession(userId, meta = {}) {
  // 32 bayt = 256 bit entropi; kaba kuvvetle tahmin edilemez.
  const sessionId = randomBytes(32).toString('hex');

  insertSessionStatement.run(
    sessionId,
    userId,
    isoFromNow(config.session.ttlDays),
    (meta.userAgent ?? '').slice(0, 255), // asiri uzun basliklari kirp
    meta.ip ?? '',
  );

  return sessionId;
}

/**
 * Gecerli (suresi dolmamis) oturumu ve kullanicisini getirir.
 * @param {string} sessionId
 */
export function findActiveSession(sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length !== 64) return null;
  return selectSessionStatement.get(sessionId, nowIso()) ?? null;
}

/**
 * Oturumu tazeler (kayan sona erme / sliding expiration).
 * Her istekte yazma yapmamak icin yalnizca son gorulme 15 dakikadan eskiyse
 * guncelleme yapilir.
 * @param {{ session_id: string, last_seen_at: string }} session
 */
export function touchSession(session) {
  const lastSeen = Date.parse(session.last_seen_at);
  if (Number.isFinite(lastSeen) && Date.now() - lastSeen < 15 * 60 * 1000) return;

  touchSessionStatement.run(nowIso(), isoFromNow(config.session.ttlDays), session.session_id);
}

/** Tek oturumu sonlandirir (cikis). */
export function destroySession(sessionId) {
  return deleteSessionStatement.run(sessionId).changes;
}

/** Kullanicinin tum oturumlarini sonlandirir (sifre degisimi vb.). */
export function destroyUserSessions(userId) {
  return deleteUserSessionsStatement.run(userId).changes;
}
