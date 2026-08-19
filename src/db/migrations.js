/**
 * Migrasyon tanimlari.
 *
 * Surum takibi SQLite'in yerlesik `PRAGMA user_version` degeri ile yapilir;
 * ayri bir migration tablosuna gerek yoktur.
 *
 * Yeni bir sema degisikligi gerektiginde bu dizinin sonuna yeni bir kayit
 * eklenir (version numarasi bir artirilir). Var olan migrasyonlar ASLA
 * degistirilmez, boylece calisan kurulumlar bozulmaz.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));

/** @type {{ version: number, name: string, sql: string }[]} */
export const migrations = [
  {
    version: 1,
    name: 'initial-schema',
    sql: readFileSync(path.join(CURRENT_DIR, 'schema.sql'), 'utf8'),
  },
];
