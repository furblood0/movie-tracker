/**
 * Uygulama yapilandirmasi.
 *
 * `dotenv` gibi harici bir paket kullanmadan, .env dosyasini kendimiz
 * ayristiriyoruz. Oncelik sirasi: gercek ortam degiskenleri > .env dosyasi > varsayilan.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// src/ klasorunun bir ustu = proje koku
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Cok basit bir .env ayristirici.
 * - `#` ile baslayan satirlar ve bos satirlar atlanir.
 * - `KEY=VALUE` formati beklenir, degerdeki tek/cift tirnaklar soyulur.
 * @param {string} filePath
 * @returns {Record<string, string>}
 */
function parseEnvFile(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (error) {
    // .env yoksa sorun degil: sadece ortam degiskenleri ve varsayilanlar kullanilir.
    if (error.code === 'ENOENT') return {};
    throw error;
  }

  const result = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    // "deger" veya 'deger' seklindeki tirnaklari kaldir
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    if (key !== '') result[key] = value;
  }
  return result;
}

const fileEnv = parseEnvFile(path.join(ROOT_DIR, '.env'));

/**
 * Once gercek ortam degiskenine, sonra .env dosyasina, en son varsayilana bakar.
 * @param {string} key
 * @param {string} [fallback]
 */
function readValue(key, fallback = '') {
  const fromProcess = process.env[key];
  if (fromProcess !== undefined && fromProcess !== '') return fromProcess;
  const fromFile = fileEnv[key];
  if (fromFile !== undefined && fromFile !== '') return fromFile;
  return fallback;
}

/** Sayisal ortam degiskeni okur, gecersizse varsayilani dondurur. */
function readNumber(key, fallback) {
  const parsed = Number.parseInt(readValue(key, ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const nodeEnv = readValue('NODE_ENV', 'development');
const dbPathValue = readValue('DB_PATH', 'data/movie-tracker.sqlite');

export const config = {
  rootDir: ROOT_DIR,
  publicDir: path.join(ROOT_DIR, 'public'),

  env: nodeEnv,
  isProduction: nodeEnv === 'production',

  host: readValue('HOST', '127.0.0.1'),
  port: readNumber('PORT', 3000),

  // Veritabani dosyasinin mutlak yolu (relatif verildiyse proje kokune gore cozulur)
  dbPath: path.isAbsolute(dbPathValue) ? dbPathValue : path.join(ROOT_DIR, dbPathValue),

  session: {
    cookieName: 'session_id',
    ttlDays: readNumber('SESSION_TTL_DAYS', 30),
    // Uretimde HTTPS varsayildigi icin Secure bayragi eklenir
    secure: nodeEnv === 'production',
  },

  tmdb: {
    apiKey: readValue('TMDB_API_KEY', ''),
    bearerToken: readValue('TMDB_BEARER_TOKEN', ''),
    baseUrl: 'https://api.themoviedb.org/3',
    imageBaseUrl: 'https://image.tmdb.org/t/p',
    language: readValue('TMDB_LANGUAGE', 'tr-TR'),
    region: readValue('TMDB_REGION', 'TR'),
    // Ayni arama tekrar edildiginde TMDb'ye gitmemek icin onbellek suresi (saniye)
    cacheTtlSeconds: readNumber('TMDB_CACHE_TTL', 60 * 60 * 6),
  },

  // Istek govdesi icin ust sinir (1 MB) - bellek tasmasina karsi koruma
  maxRequestBodyBytes: 1024 * 1024,
};

/** TMDb kimlik bilgisi tanimli mi? */
export function hasTmdbCredentials() {
  return config.tmdb.bearerToken !== '' || config.tmdb.apiKey !== '';
}
