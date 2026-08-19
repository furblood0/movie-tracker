/**
 * Veritabani baglantisi ve migrasyon calistirici.
 *
 * ORM YOK: Node.js'in yerlesik `node:sqlite` modulundeki DatabaseSync
 * kullanilir. Tum sorgular prepared statement (`db.prepare(...)`) ile
 * yazilir; kullanici girdisi hicbir zaman SQL metnine string olarak
 * eklenmez (SQL Injection korumasi).
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { config } from '../config.js';
import { migrations } from './migrations.js';
import { logger } from '../lib/logger.js';

/** ISO-8601 UTC zaman damgasi (veritabanindaki tarih formatiyla ayni). */
export function nowIso() {
  return new Date().toISOString();
}

/** Verilen gun sayisi kadar ileri tarihli ISO-8601 UTC zaman damgasi. */
export function isoFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Veritabani dosyasini acar ve performans/tutarlilik ayarlarini yapar.
 * @returns {DatabaseSync}
 */
function openDatabase() {
  // data/ klasoru yoksa olustur (ilk calistirma senaryosu)
  mkdirSync(path.dirname(config.dbPath), { recursive: true });

  const database = new DatabaseSync(config.dbPath);

  // WAL: okuma/yazmanin birbirini bloklamasini azaltir.
  database.exec('PRAGMA journal_mode = WAL');
  // Yabanci anahtar kisitlari SQLite'ta varsayilan olarak KAPALIDIR.
  database.exec('PRAGMA foreign_keys = ON');
  // Kilit beklerken hemen hata vermek yerine 5 saniye tekrar dene.
  database.exec('PRAGMA busy_timeout = 5000');
  // Dayaniklilik/hiz dengesi: WAL ile birlikte guvenli kabul edilir.
  database.exec('PRAGMA synchronous = NORMAL');

  return database;
}

/**
 * Bekleyen migrasyonlari sirayla uygular.
 * Her migrasyon tek bir transaction icinde calisir: hata olursa geri alinir.
 * @param {DatabaseSync} database
 */
function runMigrations(database) {
  const { user_version: currentVersion } = database.prepare('PRAGMA user_version').get();

  const pending = migrations
    .filter((migration) => migration.version > currentVersion)
    .sort((a, b) => a.version - b.version);

  if (pending.length === 0) {
    logger.debug(`Veritabani guncel (sema surumu: ${currentVersion})`);
    return;
  }

  for (const migration of pending) {
    // Guvenlik: PRAGMA parametre kabul etmedigi icin deger SQL metnine
    // gomulmek zorunda. Bu yuzden tam sayi oldugunu dogruluyoruz.
    if (!Number.isInteger(migration.version)) {
      throw new Error(`Gecersiz migrasyon surumu: ${migration.version}`);
    }

    logger.info(`Migrasyon uygulaniyor: v${migration.version} (${migration.name})`);
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(migration.sql);
      database.exec(`PRAGMA user_version = ${migration.version}`);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw new Error(`Migrasyon v${migration.version} basarisiz: ${error.message}`, { cause: error });
    }
  }

  logger.info(`Sema surumu guncellendi: v${pending.at(-1).version}`);
}

/** Uygulama genelinde paylasilan tek baglanti (SQLite icin ideal olan yaklasim). */
export const db = openDatabase();

runMigrations(db);

/**
 * Suresi gecmis oturumlari ve bayatlamis TMDb onbellek kayitlarini siler.
 * Sunucu acilisinda ve periyodik olarak cagrilir.
 */
export function cleanupExpired() {
  const removedSessions = db
    .prepare('DELETE FROM sessions WHERE expires_at <= ?')
    .run(nowIso()).changes;

  const cacheCutoff = Math.floor(Date.now() / 1000) - config.tmdb.cacheTtlSeconds;
  const removedCache = db
    .prepare('DELETE FROM tmdb_cache WHERE created_at <= ?')
    .run(cacheCutoff).changes;

  if (removedSessions > 0 || removedCache > 0) {
    logger.debug(`Temizlik: ${removedSessions} oturum, ${removedCache} onbellek kaydi silindi`);
  }
  return { removedSessions, removedCache };
}

/**
 * Bir fonksiyonu transaction icinde calistirir.
 * Coklu tablo yazan islemler (ornek: kayit + turleri) icin kullanilir.
 * @template T
 * @param {() => T} callback
 * @returns {T}
 */
export function transaction(callback) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** Baglantiyi kapatir (graceful shutdown sirasinda cagrilir). */
export function closeDatabase() {
  try {
    db.close();
    logger.debug('Veritabani baglantisi kapatildi');
  } catch (error) {
    logger.error('Veritabani kapatilirken hata:', error.message);
  }
}
