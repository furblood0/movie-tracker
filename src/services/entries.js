/**
 * Izleme gunlugu veri erisim katmani.
 *
 * SQL Injection notu: filtreleme/siralama dinamik SQL uretir, ancak
 *  - kullanici DEGERLERI daima `?` yer tutucularla baglanir,
 *  - siralama alani/yonu gibi SQL metnine girmesi gereken parcalar yalnizca
 *    beyaz listeden (SORTABLE_COLUMNS) secilir; kullanici metni SQL'e girmez.
 */

import { config } from '../config.js';
import { db, transaction } from '../db/index.js';
import { HttpError } from '../lib/http.js';

const POSTER_SIZE = 'w342';

/** Izin verilen degerler (veritabanindaki CHECK kisitlariyla ayni). */
export const ENTRY_STATUSES = /** @type {const} */ (['watched', 'watchlist', 'dropped']);
export const MEDIA_TYPES = /** @type {const} */ (['movie', 'tv']);

/**
 * Siralama icin beyaz liste: istemciden gelen ad -> gercek SQL ifadesi.
 * Bu harita sayesinde `sort` parametresi asla dogrudan SQL'e yazilmaz.
 */
const SORTABLE_COLUMNS = {
  updated: 'e.updated_at',
  created: 'e.created_at',
  rating: 'e.rating',
  title: 'e.title',
  watched: 'e.watched_at',
  year: 'e.release_year',
};

const insertEntryStatement = db.prepare(`
  INSERT INTO entries (
    user_id, tmdb_id, media_type, title, original_title, overview,
    poster_path, release_year, status, rating, review, watched_at, favorite
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertGenreStatement = db.prepare(`
  INSERT OR IGNORE INTO entry_genres (entry_id, genre_id, genre_name) VALUES (?, ?, ?)
`);

const deleteGenresStatement = db.prepare('DELETE FROM entry_genres WHERE entry_id = ?');

// Kayitlar daima user_id ile birlikte sorgulanir: bir kullanici baskasinin
// kaydina id'yi bilse bile erisemez (yatay yetki yukseltme savunmasi).
const selectEntryByIdStatement = db.prepare('SELECT * FROM entries WHERE id = ? AND user_id = ?');

const selectEntryByTmdbStatement = db.prepare(`
  SELECT * FROM entries WHERE user_id = ? AND media_type = ? AND tmdb_id = ?
`);

const deleteEntryStatement = db.prepare('DELETE FROM entries WHERE id = ? AND user_id = ?');

const selectUserGenresStatement = db.prepare(`
  SELECT g.genre_id AS id, g.genre_name AS name, COUNT(*) AS count
    FROM entry_genres g
    JOIN entries e ON e.id = g.entry_id
   WHERE e.user_id = ?
   GROUP BY g.genre_id, g.genre_name
   ORDER BY count DESC, name ASC
`);

/**
 * LIKE kalibindaki ozel karakterleri kacirir (`\` ile).
 * SQL tarafinda `ESCAPE '\'` ile birlikte kullanilir.
 */
function escapeLikePattern(text) {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** Afis yolunu tam URL'ye cevirir. */
function posterUrl(posterPath) {
  if (!posterPath) return null;
  return `${config.tmdb.imageBaseUrl}/${POSTER_SIZE}${posterPath}`;
}

/**
 * Veritabani satirini istemci sozlesmesine (camelCase) cevirir.
 * @param {any} row
 * @param {{ id: number, name: string }[]} [genres]
 */
function toApiEntry(row, genres = []) {
  return {
    id: row.id,
    tmdbId: row.tmdb_id,
    mediaType: row.media_type,
    title: row.title,
    originalTitle: row.original_title ?? null,
    overview: row.overview ?? null,
    posterPath: row.poster_path ?? null,
    posterUrl: posterUrl(row.poster_path),
    releaseYear: row.release_year ?? null,
    status: row.status,
    rating: row.rating ?? null,
    review: row.review ?? null,
    watchedAt: row.watched_at ?? null,
    favorite: row.favorite === 1,
    genres,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Verilen kayitlarin turlerini TEK sorguda getirir (N+1 sorgu problemini onler).
 * @param {number[]} entryIds
 * @returns {Map<number, { id: number, name: string }[]>}
 */
function loadGenresFor(entryIds) {
  const genresByEntry = new Map();
  if (entryIds.length === 0) return genresByEntry;

  // Yer tutucu sayisi kayit SAYISINDAN uretilir; kullanici metni SQL'e girmez.
  const placeholders = entryIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT entry_id, genre_id, genre_name
         FROM entry_genres
        WHERE entry_id IN (${placeholders})
        ORDER BY genre_name`,
    )
    .all(...entryIds);

  for (const row of rows) {
    if (!genresByEntry.has(row.entry_id)) genresByEntry.set(row.entry_id, []);
    genresByEntry.get(row.entry_id).push({ id: row.genre_id, name: row.genre_name });
  }
  return genresByEntry;
}

/** Kaydin tur listesini bastan yazar (transaction icinde cagrilir). */
function replaceGenres(entryId, genres) {
  deleteGenresStatement.run(entryId);
  for (const genre of genres) {
    insertGenreStatement.run(entryId, genre.id, genre.name);
  }
}

/**
 * Yeni kayit olusturur.
 * @param {number} userId
 * @param {{
 *   tmdbId: number, mediaType: 'movie' | 'tv', title: string, originalTitle?: string | null,
 *   overview?: string | null, posterPath?: string | null, releaseYear?: number | null,
 *   status: 'watched' | 'watchlist' | 'dropped', rating?: number | null, review?: string | null,
 *   watchedAt?: string | null, favorite?: boolean, genres?: { id: number, name: string }[]
 * }} input
 */
export function createEntry(userId, input) {
  const existing = selectEntryByTmdbStatement.get(userId, input.mediaType, input.tmdbId);
  if (existing) {
    // Arayuz bu id ile dogrudan duzenleme moduna gecebilsin diye geri veriyoruz.
    throw new HttpError(409, 'Bu icerik gunlugunuzde zaten var.', {
      field: 'tmdbId',
      existingEntryId: existing.id,
    });
  }

  return transaction(() => {
    const result = insertEntryStatement.run(
      userId,
      input.tmdbId,
      input.mediaType,
      input.title,
      input.originalTitle ?? null,
      input.overview ?? null,
      input.posterPath ?? null,
      input.releaseYear ?? null,
      input.status,
      input.rating ?? null,
      input.review ?? null,
      input.watchedAt ?? null,
      input.favorite ? 1 : 0,
    );

    const entryId = Number(result.lastInsertRowid);
    replaceGenres(entryId, input.genres ?? []);

    return findEntry(userId, entryId);
  });
}

/**
 * Tek kaydi getirir (baska kullanicinin kaydiysa null).
 * @param {number} userId
 * @param {number} entryId
 */
export function findEntry(userId, entryId) {
  const row = selectEntryByIdStatement.get(entryId, userId);
  if (!row) return null;

  const genres = loadGenresFor([row.id]).get(row.id) ?? [];
  return toApiEntry(row, genres);
}

/**
 * Kaydi kismi olarak guncelleer (PATCH).
 * `undefined` olan alanlara DOKUNULMAZ; `null` gonderilen alanlar temizlenir.
 * @param {number} userId
 * @param {number} entryId
 * @param {Record<string, unknown>} changes
 */
export function updateEntry(userId, entryId, changes) {
  const existing = selectEntryByIdStatement.get(entryId, userId);
  if (!existing) throw new HttpError(404, 'Kayit bulunamadi.');

  // Istemciden gelen alan adi -> veritabani kolonu eslesmesi (beyaz liste)
  const COLUMN_MAP = {
    status: 'status',
    rating: 'rating',
    review: 'review',
    watchedAt: 'watched_at',
    favorite: 'favorite',
    title: 'title',
    posterPath: 'poster_path',
    releaseYear: 'release_year',
  };

  const assignments = [];
  const values = [];

  for (const [field, column] of Object.entries(COLUMN_MAP)) {
    if (!(field in changes) || changes[field] === undefined) continue;

    const value = changes[field];
    assignments.push(`${column} = ?`);
    values.push(field === 'favorite' ? (value ? 1 : 0) : value);
  }

  return transaction(() => {
    if (assignments.length > 0) {
      values.push(entryId, userId);
      // Kolon adlari beyaz listeden geldi; degerler yer tutucuyla baglandi.
      db.prepare(`UPDATE entries SET ${assignments.join(', ')} WHERE id = ? AND user_id = ?`).run(...values);
    }

    // Turler yalnizca acikca gonderildiyse degistirilir.
    if (Array.isArray(changes.genres)) replaceGenres(entryId, changes.genres);

    return findEntry(userId, entryId);
  });
}

/**
 * Kaydi siler.
 * @returns {boolean} Silindiyse true, kayit yoksa false
 */
export function deleteEntry(userId, entryId) {
  // entry_genres kayitlari ON DELETE CASCADE ile birlikte silinir.
  return deleteEntryStatement.run(entryId, userId).changes > 0;
}

/**
 * Filtrelenmis, siralanmis ve sayfalanmis kayit listesi.
 * @param {number} userId
 * @param {{
 *   status?: string | null, mediaType?: string | null, genreId?: number | null,
 *   minRating?: number | null, maxRating?: number | null, favorite?: boolean | null,
 *   unrated?: boolean | null, search?: string | null,
 *   sort?: keyof typeof SORTABLE_COLUMNS, order?: 'asc' | 'desc',
 *   page?: number, limit?: number
 * }} [filters]
 */
export function listEntries(userId, filters = {}) {
  const conditions = ['e.user_id = ?'];
  /** @type {unknown[]} */
  const values = [userId];

  if (filters.status) {
    conditions.push('e.status = ?');
    values.push(filters.status);
  }
  if (filters.mediaType) {
    conditions.push('e.media_type = ?');
    values.push(filters.mediaType);
  }
  if (typeof filters.minRating === 'number') {
    conditions.push('e.rating IS NOT NULL AND e.rating >= ?');
    values.push(filters.minRating);
  }
  if (typeof filters.maxRating === 'number') {
    conditions.push('e.rating IS NOT NULL AND e.rating <= ?');
    values.push(filters.maxRating);
  }
  if (filters.unrated === true) {
    conditions.push('e.rating IS NULL');
  }
  if (filters.favorite === true) {
    conditions.push('e.favorite = 1');
  }
  if (filters.search) {
    // Degerler yer tutucuyla baglanir; ancak LIKE kaliplarinda `%` ve `_`
    // joker karakter oldugu icin kullanicinin yazdigi bu karakterler kacirilir.
    // Aksi halde "%" aramasi tum kayitlari getirirdi.
    conditions.push("(e.title LIKE ? ESCAPE '\\' OR e.original_title LIKE ? ESCAPE '\\')");
    const pattern = `%${escapeLikePattern(filters.search)}%`;
    values.push(pattern, pattern);
  }
  if (typeof filters.genreId === 'number') {
    // EXISTS: kaydi tekrarlamadan tur filtresi uygular (JOIN ile satir cogalmasi olmaz)
    conditions.push('EXISTS (SELECT 1 FROM entry_genres g WHERE g.entry_id = e.id AND g.genre_id = ?)');
    values.push(filters.genreId);
  }

  const whereClause = conditions.join(' AND ');

  const total = db.prepare(`SELECT COUNT(*) AS n FROM entries e WHERE ${whereClause}`).get(...values).n;

  const sortColumn = SORTABLE_COLUMNS[filters.sort ?? 'updated'] ?? SORTABLE_COLUMNS.updated;
  const direction = filters.order === 'asc' ? 'ASC' : 'DESC';

  const limit = filters.limit ?? 24;
  const page = filters.page ?? 1;
  const offset = (page - 1) * limit;

  // NULL degerler her zaman sona: puansiz kayitlar listenin basini doldurmasin.
  const rows = db
    .prepare(
      `SELECT e.*
         FROM entries e
        WHERE ${whereClause}
        ORDER BY (${sortColumn} IS NULL), ${sortColumn} ${direction}, e.id DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...values, limit, offset);

  const genresByEntry = loadGenresFor(rows.map((row) => row.id));

  return {
    items: rows.map((row) => toApiEntry(row, genresByEntry.get(row.id) ?? [])),
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

/** Kullanicinin gunlugundeki turler (filtre menusunu doldurmak icin). */
export function listUserGenres(userId) {
  return selectUserGenresStatement.all(userId).map((row) => ({
    id: row.id,
    name: row.name,
    count: row.count,
  }));
}
