/**
 * TMDb proxy uclari.
 *
 *   GET /api/tmdb/search?query=matrix&type=multi&page=1
 *   GET /api/tmdb/trending?window=week
 *   GET /api/tmdb/:mediaType/:tmdbId          (mediaType: movie | tv)
 *
 * Neden oturum zorunlu?
 *   Bu uclar sunucunun API anahtarini kullanir. Acik biraksaydik, uygulama
 *   herkesin serbestce kullanabildigi bir "anahtar dagitim servisi" olurdu
 *   ve kotamiz tukenirdi. Bu yuzden requireAuth + kullanici bazli hiz siniri.
 */

import { sendJson } from '../lib/http.js';
import { consumeRateLimit } from '../lib/rate-limit.js';
import { requireEnum, requireNumber, requireString } from '../lib/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { getDetails, getTrending, searchTitles } from '../services/tmdb.js';

const MEDIA_TYPES = /** @type {const} */ (['movie', 'tv']);
const SEARCH_TYPES = /** @type {const} */ (['multi', 'movie', 'tv']);

/** Kullanici bazli hiz siniri: dakikada 60 TMDb istegi fazlasiyla yeterli. */
function limitTmdbUsage(userId) {
  consumeRateLimit(`tmdb:${userId}`, {
    limit: 60,
    windowMs: 60 * 1000,
    message: 'Çok hızlı arama yapıyorsunuz. Lütfen bir dakika bekleyin.',
  });
}

/**
 * @param {ReturnType<import('../lib/router.js').createRouter>} router
 */
export function registerTmdbRoutes(router) {
  // ------------------------------------------------------------------
  // Arama
  // ------------------------------------------------------------------
  router.get('/api/tmdb/search', async (ctx) => {
    const user = requireAuth(ctx);
    limitTmdbUsage(user.id);

    // query zorunlu; bos aramayi TMDb'ye hic gondermeyiz
    const query = requireString(ctx.query.get('query'), 'query', { min: 1, max: 200 });

    const type = ctx.query.has('type')
      ? requireEnum(ctx.query.get('type'), 'type', SEARCH_TYPES)
      : 'multi';

    const page = ctx.query.has('page')
      ? requireNumber(ctx.query.get('page'), 'page', { min: 1, max: 500, integer: true })
      : 1;

    const result = await searchTitles({ query, type, page });
    sendJson(ctx.res, 200, result);
  });

  // ------------------------------------------------------------------
  // One cikanlar (arama kutusu bosken gosterilecek kesif listesi)
  // ------------------------------------------------------------------
  router.get('/api/tmdb/trending', async (ctx) => {
    const user = requireAuth(ctx);
    limitTmdbUsage(user.id);

    const window = ctx.query.has('window')
      ? requireEnum(ctx.query.get('window'), 'window', ['day', 'week'])
      : 'week';

    sendJson(ctx.res, 200, await getTrending({ window }));
  });

  // ------------------------------------------------------------------
  // Detay
  // ------------------------------------------------------------------
  router.get('/api/tmdb/:mediaType/:tmdbId', async (ctx) => {
    const user = requireAuth(ctx);
    limitTmdbUsage(user.id);

    const mediaType = requireEnum(ctx.params.mediaType, 'mediaType', MEDIA_TYPES);
    const tmdbId = requireNumber(ctx.params.tmdbId, 'tmdbId', {
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
      integer: true,
    });

    sendJson(ctx.res, 200, await getDetails(mediaType, tmdbId));
  });
}
