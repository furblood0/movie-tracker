/**
 * Kimlik dogrulama ara katmani.
 *
 * Express middleware zinciri yerine, rota isleyicisinin basinda cagrilan
 * basit fonksiyonlar kullaniyoruz: `const user = requireAuth(ctx);`
 * Bu yaklasim daha az sihir, daha okunur bir akis saglar.
 */

import { config } from '../config.js';
import { HttpError } from '../lib/http.js';
import { findActiveSession, touchSession } from '../services/sessions.js';
import { toPublicUser } from '../services/users.js';

/**
 * Cerezdeki oturumu cozer ve `ctx.user` alanini doldurur.
 * Oturum yoksa hata FIRLATMAZ; sadece null birakir (acik uclar icin).
 * @param {import('../server.js').RequestContext} ctx
 */
export function attachUser(ctx) {
  const sessionId = ctx.cookies[config.session.cookieName];
  if (!sessionId) return null;

  const session = findActiveSession(sessionId);
  if (!session) return null;

  // Kullanici aktif oldukca oturum omrunu uzat
  touchSession(session);

  ctx.sessionId = session.session_id;
  ctx.user = toPublicUser(session);
  return ctx.user;
}

/**
 * Oturum zorunlu olan uclarda kullanilir.
 * @param {import('../server.js').RequestContext} ctx
 * @returns {{ id: number, username: string, email: string | null, displayName: string, createdAt: string }}
 */
export function requireAuth(ctx) {
  const user = ctx.user ?? attachUser(ctx);
  if (!user) {
    throw new HttpError(401, 'Bu işlem için giriş yapmalısınız.');
  }
  return user;
}
