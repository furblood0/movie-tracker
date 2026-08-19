/**
 * TMDb (The Movie Database) API v3 istemcisi.
 *
 * Onemli tasarim kararlari:
 *  - API anahtari YALNIZCA sunucuda kalir. Istemci hicbir zaman TMDb'ye
 *    dogrudan istek atmaz; /api/tmdb/* uclari uzerinden proxy'lenir.
 *  - Yanitlar TMDb'den geldigi gibi degil, TEMIZLENMIS (normalize edilmis)
 *    halde dondurulur: hem gereksiz alanlar tasinmaz hem de istemci sabit
 *    bir sozlesmeye guvenir.
 *  - Tekrarlanan istekler `tmdb_cache` tablosunda onbelleklenir (kota tasarrufu).
 *  - Ag istekleri icin Node'un yerlesik global `fetch`i kullanilir (harici
 *    axios/node-fetch paketi yok), zaman asimi `AbortSignal.timeout` ile.
 */

import { config, hasTmdbCredentials } from '../config.js';
import { db } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import { logger } from '../lib/logger.js';

const REQUEST_TIMEOUT_MS = 8000;
const GENRE_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // tur listesi cok nadir degisir

// Afis/arka plan gorsel boyutlari (TMDb'nin destekledigi hazir olcekler)
const POSTER_SIZE = 'w342';
const BACKDROP_SIZE = 'w780';
const PROFILE_SIZE = 'w185';

const selectCacheStatement = db.prepare('SELECT payload, created_at FROM tmdb_cache WHERE cache_key = ?');
const upsertCacheStatement = db.prepare(`
  INSERT INTO tmdb_cache (cache_key, payload, created_at)
  VALUES (?, ?, ?)
  ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, created_at = excluded.created_at
`);

/** Unix saniye cinsinden simdiki zaman. */
function unixNow() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Onbellekten okur; kayit yoksa veya bayatlamissa null doner.
 * @param {string} cacheKey
 * @param {number} ttlSeconds
 */
function readCache(cacheKey, ttlSeconds) {
  const row = selectCacheStatement.get(cacheKey);
  if (!row) return null;
  if (unixNow() - row.created_at > ttlSeconds) return null;

  try {
    return JSON.parse(row.payload);
  } catch {
    return null; // bozuk kayit: onbellek yok say
  }
}

/** Onbellege yazar (ayni anahtar varsa gunceller). */
function writeCache(cacheKey, value) {
  upsertCacheStatement.run(cacheKey, JSON.stringify(value), unixNow());
}

/**
 * TMDb'ye HTTP istegi atar.
 * @param {string} endpoint Ornek: "/search/movie"
 * @param {Record<string, string | number>} [params] Sorgu parametreleri
 * @returns {Promise<any>} Ham TMDb yaniti
 */
async function requestTmdb(endpoint, params = {}) {
  if (!hasTmdbCredentials()) {
    throw new HttpError(503, 'TMDb API anahtari sunucuda tanimli degil. .env dosyasini doldurun.');
  }

  const url = new URL(config.tmdb.baseUrl + endpoint);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }

  /** @type {Record<string, string>} */
  const headers = { Accept: 'application/json' };

  // v4 Bearer token varsa onu kullan; yoksa v3 anahtarini sorguya ekle.
  if (config.tmdb.bearerToken) headers.Authorization = `Bearer ${config.tmdb.bearerToken}`;
  else url.searchParams.set('api_key', config.tmdb.apiKey);

  let response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    // Ag hatasi / zaman asimi: kendi hatamiz degil, yukari 504 olarak bildir.
    // Not: hata mesajinda URL yok -> anahtar loglara sizmaz.
    logger.warn(`TMDb istegi basarisiz (${endpoint}): ${error.name}`);
    throw new HttpError(504, 'TMDb servisine su anda ulasilamiyor. Lutfen tekrar deneyin.');
  }

  if (response.ok) return response.json();

  // Hata gövdesini okumaya calis (TMDb aciklayici mesaj dondurur)
  let tmdbMessage = '';
  try {
    const errorBody = await response.json();
    tmdbMessage = typeof errorBody?.status_message === 'string' ? errorBody.status_message : '';
  } catch {
    /* govde okunamadi, onemli degil */
  }

  logger.warn(`TMDb ${response.status} (${endpoint}): ${tmdbMessage}`);

  if (response.status === 404) throw new HttpError(404, 'TMDb uzerinde boyle bir icerik bulunamadi.');
  if (response.status === 401 || response.status === 403) {
    // Yapilandirma hatasi kullaniciya "anahtar gecersiz" olarak sizdirilmaz.
    throw new HttpError(502, 'TMDb kimlik dogrulamasi basarisiz. Sunucu yapilandirmasini kontrol edin.');
  }
  if (response.status === 429) throw new HttpError(429, 'TMDb istek siniri asildi. Kisa bir sure sonra deneyin.');

  throw new HttpError(502, 'TMDb beklenmeyen bir yanit dondurdu.');
}

/**
 * Onbellekli TMDb istegi.
 * @param {string} cacheKey
 * @param {string} endpoint
 * @param {Record<string, string | number>} params
 * @param {number} [ttlSeconds]
 */
async function requestWithCache(cacheKey, endpoint, params, ttlSeconds = config.tmdb.cacheTtlSeconds) {
  const cached = readCache(cacheKey, ttlSeconds);
  if (cached !== null) {
    logger.debug(`TMDb onbellek isabeti: ${cacheKey}`);
    return { data: cached, cached: true };
  }

  const data = await requestTmdb(endpoint, params);
  writeCache(cacheKey, data);
  return { data, cached: false };
}

/** Gorsel yolunu tam URL'ye cevirir (yol yoksa null). */
function imageUrl(imagePath, size) {
  if (typeof imagePath !== 'string' || imagePath === '') return null;
  return `${config.tmdb.imageBaseUrl}/${size}${imagePath}`;
}

/** "2019-05-24" -> 2019 (gecersizse null). */
function extractYear(dateText) {
  if (typeof dateText !== 'string') return null;
  const year = Number.parseInt(dateText.slice(0, 4), 10);
  return Number.isInteger(year) ? year : null;
}

/**
 * Tur (genre) kimligi -> adi haritasini getirir.
 * Uzun sureli onbelleklenir; arama sonuclarinda yalnizca `genre_ids` geldigi
 * icin tur ADLARINI burada cozeriz (gunluk kayitlari ad ile saklanir).
 * @param {'movie' | 'tv'} mediaType
 * @returns {Promise<Map<number, string>>}
 */
export async function getGenreMap(mediaType) {
  const cacheKey = `genres:${mediaType}:${config.tmdb.language}`;
  const { data } = await requestWithCache(
    cacheKey,
    `/genre/${mediaType}/list`,
    { language: config.tmdb.language },
    GENRE_CACHE_TTL_SECONDS,
  );

  const map = new Map();
  for (const genre of data?.genres ?? []) {
    if (Number.isInteger(genre?.id) && typeof genre?.name === 'string') map.set(genre.id, genre.name);
  }
  return map;
}

/**
 * TMDb arama/liste ogesini istemciye gidecek sade bicime cevirir.
 * @param {any} raw
 * @param {{ forcedType?: 'movie' | 'tv', genreMaps?: { movie: Map<number, string>, tv: Map<number, string> } }} [options]
 */
function normalizeListItem(raw, options = {}) {
  const mediaType = raw?.media_type ?? options.forcedType;

  // "person" gibi desteklemedigimiz turleri disla
  if (mediaType !== 'movie' && mediaType !== 'tv') return null;
  if (!Number.isInteger(raw?.id)) return null;

  const releaseDate = raw.release_date ?? raw.first_air_date ?? null;
  const genreMap = options.genreMaps?.[mediaType];

  return {
    tmdbId: raw.id,
    mediaType,
    title: raw.title ?? raw.name ?? 'Bilinmeyen baslik',
    originalTitle: raw.original_title ?? raw.original_name ?? null,
    overview: raw.overview || null,
    posterPath: raw.poster_path ?? null, // veritabaninda bu goreli yol saklanir
    posterUrl: imageUrl(raw.poster_path, POSTER_SIZE),
    backdropUrl: imageUrl(raw.backdrop_path, BACKDROP_SIZE),
    releaseDate,
    releaseYear: extractYear(releaseDate),
    voteAverage: typeof raw.vote_average === 'number' ? Math.round(raw.vote_average * 10) / 10 : null,
    voteCount: raw.vote_count ?? 0,
    popularity: raw.popularity ?? 0,
    genres: (raw.genre_ids ?? [])
      .filter((id) => genreMap?.has(id))
      .map((id) => ({ id, name: genreMap.get(id) })),
  };
}

/** Sayfalanmis TMDb yanitini normalize eder. */
function normalizePagedResponse(data, options) {
  const results = (data?.results ?? [])
    .map((item) => normalizeListItem(item, options))
    .filter((item) => item !== null);

  return {
    page: data?.page ?? 1,
    totalPages: Math.min(data?.total_pages ?? 1, 500), // TMDb 500. sayfadan sonrasini vermez
    totalResults: data?.total_results ?? results.length,
    results,
  };
}

/**
 * Film/dizi arar.
 * @param {{ query: string, type?: 'multi' | 'movie' | 'tv', page?: number }} params
 */
export async function searchTitles({ query, type = 'multi', page = 1 }) {
  // Onbellek anahtari: kucuk harfe indirilmis ve sadelestirilmis sorgu
  const normalizedQuery = query.trim().toLowerCase().replace(/\s+/g, ' ');
  const cacheKey = `search:${type}:${config.tmdb.language}:${normalizedQuery}:${page}`;

  const [movieGenres, tvGenres] = await Promise.all([getGenreMap('movie'), getGenreMap('tv')]);

  const { data, cached } = await requestWithCache(cacheKey, `/search/${type}`, {
    query: normalizedQuery,
    page,
    language: config.tmdb.language,
    include_adult: 'false',
    region: config.tmdb.region,
  });

  return {
    ...normalizePagedResponse(data, {
      genreMaps: { movie: movieGenres, tv: tvGenres },
      // /search/movie ve /search/tv yanitlarinda `media_type` alani GELMEZ;
      // turu istegin kendisinden biliyoruz. Yalnizca /search/multi her ogede
      // media_type dondurur.
      forcedType: type === 'multi' ? undefined : type,
    }),
    query: normalizedQuery,
    type,
    cached,
  };
}

/**
 * Gunun/haftanin one cikan icerikleri (arama yapilmadan gosterilecek kesif listesi).
 * @param {{ window?: 'day' | 'week' }} [params]
 */
export async function getTrending({ window = 'week' } = {}) {
  const cacheKey = `trending:${window}:${config.tmdb.language}`;
  const [movieGenres, tvGenres] = await Promise.all([getGenreMap('movie'), getGenreMap('tv')]);

  const { data, cached } = await requestWithCache(
    cacheKey,
    `/trending/all/${window}`,
    { language: config.tmdb.language },
    60 * 60, // 1 saat: gundem hizli degisir
  );

  return {
    ...normalizePagedResponse(data, { genreMaps: { movie: movieGenres, tv: tvGenres } }),
    window,
    cached,
  };
}

/**
 * Tek bir icerigin detayini getirir (tur adlari, sure, oyuncular vb.).
 * @param {'movie' | 'tv'} mediaType
 * @param {number} tmdbId
 */
export async function getDetails(mediaType, tmdbId) {
  const cacheKey = `details:${mediaType}:${tmdbId}:${config.tmdb.language}`;

  const { data, cached } = await requestWithCache(cacheKey, `/${mediaType}/${tmdbId}`, {
    language: config.tmdb.language,
    // Tek istekte oyuncu kadrosunu da al (ek HTTP gidis-gelisi olmasin)
    append_to_response: 'credits',
  });

  const releaseDate = data.release_date ?? data.first_air_date ?? null;

  return {
    tmdbId: data.id,
    mediaType,
    title: data.title ?? data.name ?? 'Bilinmeyen baslik',
    originalTitle: data.original_title ?? data.original_name ?? null,
    tagline: data.tagline || null,
    overview: data.overview || null,
    posterPath: data.poster_path ?? null,
    posterUrl: imageUrl(data.poster_path, POSTER_SIZE),
    backdropUrl: imageUrl(data.backdrop_path, BACKDROP_SIZE),
    releaseDate,
    releaseYear: extractYear(releaseDate),
    status: data.status ?? null,
    voteAverage: typeof data.vote_average === 'number' ? Math.round(data.vote_average * 10) / 10 : null,
    voteCount: data.vote_count ?? 0,
    // Film: dakika cinsinden sure. Dizi: bolum suresi dizisinin ilk degeri.
    runtime: data.runtime ?? data.episode_run_time?.[0] ?? null,
    numberOfSeasons: data.number_of_seasons ?? null,
    numberOfEpisodes: data.number_of_episodes ?? null,
    genres: (data.genres ?? [])
      .filter((genre) => Number.isInteger(genre?.id) && typeof genre?.name === 'string')
      .map((genre) => ({ id: genre.id, name: genre.name })),
    // Ilk 10 oyuncu arayuzde yeterli
    cast: (data.credits?.cast ?? []).slice(0, 10).map((person) => ({
      id: person.id,
      name: person.name,
      character: person.character || null,
      profileUrl: imageUrl(person.profile_path, PROFILE_SIZE),
    })),
    cached,
  };
}
