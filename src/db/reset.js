/**
 * Gelistirme yardimcisi: veritabani dosyasini siler.
 * Bir sonraki sunucu acilisinda sema sifirdan olusturulur.
 *
 * Kullanim: npm run db:reset
 */

import { rmSync } from 'node:fs';

import { config } from '../config.js';

if (config.isProduction) {
  console.error('Guvenlik: production ortaminda veritabani sifirlanamaz.');
  process.exit(1);
}

for (const suffix of ['', '-wal', '-shm', '-journal']) {
  rmSync(`${config.dbPath}${suffix}`, { force: true });
}

console.log(`Silindi: ${config.dbPath} (ve WAL/SHM yan dosyalari)`);
