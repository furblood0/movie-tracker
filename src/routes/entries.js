/**
 * Izleme gunlugu uclari (hepsi oturum gerektirir).
 *
 *   GET    /api/entries              listeleme + filtreleme + siralama + sayfalama
 *   GET    /api/entries/genres       kullanicinin gunlugundeki turler (filtre menusu)
 *   POST   /api/entries              yeni kayit
 *   GET    /api/entries/:id          tek kayit
 *   PATCH  /api/entries/:id          kismi guncelleme
 *   DELETE /api/entries/:id          silme
 *
 * Not: "/api/entries/genres" rotasi "/api/entries/:id" ROTASINDAN ONCE
 * kaydedilir; router kayit sirasina gore esleser, aksi halde "genres"
 * kelimesi :id parametresi sanilirdi.
 */

import { HttpError, sendEmpty, sendJson } from '../lib/http.js';
import {
  optionalBoolean,
  optionalDate,
  optionalNumber,
  optionalString,
  requireEnum,
  requireId,
  requireNumber,
  requireString,
} from '../lib/validate.js';
import { requireAuth } from '../middleware/auth.js';
import {
  ENTRY_STATUSES,
  MEDIA_TYPES,
  createEntry,
  deleteEntry,
  findEntry,
  listEntries,
  listUserGenres,
  updateEntry,
} from '../services/entries.js';

const SORT_FIELDS = /** @type {const} */ (['updated', 'created', 'rating', 'title', 'watched', 'year']);
const MAX_GENRES_PER_ENTRY = 20;
const MAX_REVIEW_LENGTH = 5000;

// Puan 1-10 arasi, yarim yildiz adimlariyla (7.5 gecerli, 7.3 degil)
const RATING_RULES = { min: 1, max: 10, step: 0.5 };

/** Bugunun UTC tarihi (YYYY-MM-DD). */
function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Yarinin UTC tarihi - izleme tarihi icin ust sinir.
 *
 * Neden bugun degil de yarin?
 *   Sunucu UTC calisir, kullanici ise kendi saat diliminde. Ornek: Turkiye
 *   (UTC+3) saatiyle 20 Agustos 01:00'de UTC hala 19 Agustos'tur. "Bugun"u
 *   sinir alsaydik kullanici gece yarisindan sonra izledigi bir yapimi
 *   kaydedemezdi. Bir gunluk tolerans en genis saat dilimi farkini (UTC+14)
 *   kapsar ve "gecen yil izledim" gibi anlamli hatalari yakalamaya devam eder.
 */
function maxWatchedIsoDate() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * TMDb afis yolu dogrulamasi.
 * Yalnizca "/abc123.jpg" bicimindeki goreli yollar kabul edilir; boylece
 * veritabanina "javascript:" veya baska bir alan adina isaret eden bir deger
 * yazilamaz (arayuzde <img src> olarak kullanildigi icin onemli).
 */
function readPosterPath(value) {
  const posterPath = optionalString(value, 'posterPath', { max: 255 });
  if (posterPath === null) return null;

  if (!/^\/[A-Za-z0-9._-]+$/.test(posterPath)) {
    throw new HttpError(400, 'posterPath yalnizca TMDb goreli yolu olabilir (ornek: /abc123.jpg).', {
      field: 'posterPath',
    });
  }
  return posterPath;
}

/** Izleme tarihi: gecerli takvim tarihi ve gelecekte olmamali. */
function readWatchedAt(value) {
  const watchedAt = optionalDate(value, 'watchedAt');
  if (watchedAt === null) return null;

  if (watchedAt > maxWatchedIsoDate()) {
    throw new HttpError(400, 'Izleme tarihi gelecekte olamaz.', { field: 'watchedAt' });
  }
  return watchedAt;
}

/**
 * Tur listesini dogrular: [{ id: number, name: string }]
 * @returns {{ id: number, name: string }[]}
 */
function readGenres(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new HttpError(400, 'genres bir dizi olmalidir.', { field: 'genres' });
  }
  if (value.length > MAX_GENRES_PER_ENTRY) {
    throw new HttpError(400, `Bir kayitta en fazla ${MAX_GENRES_PER_ENTRY} tur olabilir.`, { field: 'genres' });
  }

  return value.map((genre, index) => ({
    id: requireNumber(genre?.id, `genres[${index}].id`, { min: 1, integer: true }),
    name: requireString(genre?.name, `genres[${index}].name`, { min: 1, max: 60 }),
  }));
}

/**
 * @param {ReturnType<import('../lib/router.js').createRouter>} router
 */
export function registerEntryRoutes(router) {
  // ------------------------------------------------------------------
  // Listeleme
  // ------------------------------------------------------------------
  router.get('/api/entries', (ctx) => {
    const user = requireAuth(ctx);
    const query = ctx.query;

    const filters = {
      status: query.has('status') ? requireEnum(query.get('status'), 'status', ENTRY_STATUSES) : null,
      mediaType: query.has('mediaType')
        ? requireEnum(query.get('mediaType'), 'mediaType', MEDIA_TYPES)
        : null,
      genreId: query.has('genreId')
        ? requireNumber(query.get('genreId'), 'genreId', { min: 1, integer: true })
        : null,
      minRating: query.has('minRating')
        ? requireNumber(query.get('minRating'), 'minRating', { min: 1, max: 10 })
        : null,
      maxRating: query.has('maxRating')
        ? requireNumber(query.get('maxRating'), 'maxRating', { min: 1, max: 10 })
        : null,
      unrated: query.get('unrated') === 'true' ? true : null,
      favorite: query.get('favorite') === 'true' ? true : null,
      search: optionalString(query.get('search'), 'search', { max: 100 }),
      sort: query.has('sort') ? requireEnum(query.get('sort'), 'sort', SORT_FIELDS) : 'updated',
      order: query.has('order') ? requireEnum(query.get('order'), 'order', ['asc', 'desc']) : 'desc',
      page: query.has('page') ? requireNumber(query.get('page'), 'page', { min: 1, integer: true }) : 1,
      limit: query.has('limit')
        ? requireNumber(query.get('limit'), 'limit', { min: 1, max: 100, integer: true })
        : 24,
    };

    if (filters.minRating !== null && filters.maxRating !== null && filters.minRating > filters.maxRating) {
      throw new HttpError(400, 'minRating, maxRating degerinden buyuk olamaz.', { field: 'minRating' });
    }

    sendJson(ctx.res, 200, listEntries(user.id, filters));
  });

  // ------------------------------------------------------------------
  // Kullanicinin turleri (filtre menusu icin) - :id rotasindan ONCE
  // ------------------------------------------------------------------
  router.get('/api/entries/genres', (ctx) => {
    const user = requireAuth(ctx);
    sendJson(ctx.res, 200, { genres: listUserGenres(user.id) });
  });

  // ------------------------------------------------------------------
  // Yeni kayit
  // ------------------------------------------------------------------
  router.post('/api/entries', async (ctx) => {
    const user = requireAuth(ctx);
    const body = await ctx.body();

    const status = body.status === undefined ? 'watchlist' : requireEnum(body.status, 'status', ENTRY_STATUSES);
    let watchedAt = readWatchedAt(body.watchedAt);

    // Kolaylik: "izledim" olarak eklenen ama tarihi girilmeyen kayitlarda
    // izleme tarihi bugun kabul edilir.
    if (status === 'watched' && watchedAt === null) watchedAt = todayIsoDate();

    const entry = createEntry(user.id, {
      tmdbId: requireNumber(body.tmdbId, 'tmdbId', { min: 1, integer: true }),
      mediaType: requireEnum(body.mediaType, 'mediaType', MEDIA_TYPES),
      title: requireString(body.title, 'title', { min: 1, max: 300 }),
      originalTitle: optionalString(body.originalTitle, 'originalTitle', { max: 300 }),
      overview: optionalString(body.overview, 'overview', { max: 5000 }),
      posterPath: readPosterPath(body.posterPath),
      releaseYear: optionalNumber(body.releaseYear, 'releaseYear', {
        min: 1870, // sinemanin baslangicindan once bir tarih anlamsiz olurdu
        max: new Date().getUTCFullYear() + 10, // henuz cikmamis yapimlar icin pay
        integer: true,
      }),
      status,
      rating: optionalNumber(body.rating, 'rating', RATING_RULES),
      review: optionalString(body.review, 'review', { max: MAX_REVIEW_LENGTH }),
      watchedAt,
      favorite: optionalBoolean(body.favorite, 'favorite') ?? false,
      genres: readGenres(body.genres),
    });

    sendJson(ctx.res, 201, { entry });
  });

  // ------------------------------------------------------------------
  // Tek kayit
  // ------------------------------------------------------------------
  router.get('/api/entries/:id', (ctx) => {
    const user = requireAuth(ctx);
    const entry = findEntry(user.id, requireId(ctx.params.id));

    // Baska kullanicinin kaydi da ayni 404'u alir: kaydin varligi sizdirilmaz.
    if (!entry) throw new HttpError(404, 'Kayit bulunamadi.');

    sendJson(ctx.res, 200, { entry });
  });

  // ------------------------------------------------------------------
  // Guncelleme (kismi)
  // ------------------------------------------------------------------
  router.patch('/api/entries/:id', async (ctx) => {
    const user = requireAuth(ctx);
    const entryId = requireId(ctx.params.id);
    const body = await ctx.body();

    const existing = findEntry(user.id, entryId);
    if (!existing) throw new HttpError(404, 'Kayit bulunamadi.');

    /** @type {Record<string, unknown>} */
    const changes = {};

    // Yalnizca govdede GERCEKTEN gonderilen alanlar guncellenir.
    // `null` gonderilmesi "bu alani temizle" anlamina gelir.
    if ('status' in body) changes.status = requireEnum(body.status, 'status', ENTRY_STATUSES);
    if ('rating' in body) changes.rating = optionalNumber(body.rating, 'rating', RATING_RULES);
    if ('review' in body) changes.review = optionalString(body.review, 'review', { max: MAX_REVIEW_LENGTH });
    if ('watchedAt' in body) changes.watchedAt = readWatchedAt(body.watchedAt);
    if ('favorite' in body) changes.favorite = optionalBoolean(body.favorite, 'favorite') ?? false;
    if ('genres' in body) changes.genres = readGenres(body.genres);

    if (Object.keys(changes).length === 0) {
      throw new HttpError(400, 'Guncellenecek en az bir alan gondermelisiniz.');
    }

    // "izlenmedi" -> "izledim" gecisinde tarih bos ise bugunu yaz.
    if (changes.status === 'watched' && !('watchedAt' in body) && existing.watchedAt === null) {
      changes.watchedAt = todayIsoDate();
    }

    sendJson(ctx.res, 200, { entry: updateEntry(user.id, entryId, changes) });
  });

  // ------------------------------------------------------------------
  // Silme
  // ------------------------------------------------------------------
  router.delete('/api/entries/:id', (ctx) => {
    const user = requireAuth(ctx);
    const deleted = deleteEntry(user.id, requireId(ctx.params.id));

    if (!deleted) throw new HttpError(404, 'Kayit bulunamadi.');

    sendEmpty(ctx.res, 204);
  });
}
