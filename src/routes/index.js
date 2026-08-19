/**
 * Tum API rotalarinin tek kayit noktasi.
 *
 * Her modul kendi rotalarini `router` uzerine ekler; server.js yalnizca
 * bu fonksiyonu cagirir. Boylece cekirdek (HTTP katmani) ile is kurallari
 * birbirinden ayri kalir.
 */

import { sendJson } from '../lib/http.js';
import { hasTmdbCredentials, config } from '../config.js';
import { registerAuthRoutes } from './auth.js';
import { registerEntryRoutes } from './entries.js';
import { registerTmdbRoutes } from './tmdb.js';

/**
 * @param {ReturnType<import('../lib/router.js').createRouter>} router
 */
export function registerRoutes(router) {
  // Saglik kontrolu: sunucu ayakta mi, veritabani ve TMDb anahtari hazir mi?
  router.get('/api/health', (ctx) => {
    sendJson(ctx.res, 200, {
      ok: true,
      env: config.env,
      tmdbConfigured: hasTmdbCredentials(),
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  // Kimlik dogrulama ve oturum yonetimi -> /api/auth/*
  registerAuthRoutes(router);

  // TMDb proxy (arama, one cikanlar, detay) -> /api/tmdb/*
  registerTmdbRoutes(router);

  // Izleme gunlugu (CRUD + filtreleme) -> /api/entries*
  registerEntryRoutes(router);
}
