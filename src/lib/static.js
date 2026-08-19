/**
 * Statik dosya sunucusu.
 *
 * Guvenlik notlari:
 *  - Path Traversal: gelen yol once yuzde-cozumu yapilir, NUL bayti
 *    reddedilir, `path.normalize` + `path.resolve` ile mutlaklastirilir ve
 *    sonucun public/ klasorunun ICINDE oldugu dogrulanir.
 *  - MIME: uzantiya gore acik bir eslesme tablosu kullanilir; bilinmeyen
 *    uzantilar `application/octet-stream` olur (tarayicida calistirilmaz).
 *  - `X-Content-Type-Options: nosniff` ile MIME sniffing engellenir.
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

import { config } from '../config.js';
import { baseSecurityHeaders, sendText } from './http.js';

/** Uzanti -> Content-Type eslesmeleri. */
const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.avif', 'image/avif'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.webmanifest', 'application/manifest+json'],
]);

function contentTypeFor(filePath) {
  return MIME_TYPES.get(path.extname(filePath).toLowerCase()) ?? 'application/octet-stream';
}

/**
 * Istek yolunu public/ altindaki guvenli bir mutlak dosya yoluna cevirir.
 * @param {string} urlPathname Ornek: "/assets/app.js"
 * @returns {string | null} Guvenli mutlak yol; guvensizse null
 */
export function resolveSafePath(urlPathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPathname);
  } catch {
    return null; // bozuk yuzde kodlamasi (ornek: "%zz")
  }

  // NUL bayti enjeksiyonu ve ters egik cizgi hilelerini engelle
  if (decoded.includes('\0')) return null;
  decoded = decoded.replace(/\\/g, '/');

  // "/" ile baslamayan yollari kabul etme
  if (!decoded.startsWith('/')) return null;

  // "/a/../../etc/passwd" gibi girdileri sadelestir
  const normalized = path.normalize(decoded);
  const absolute = path.resolve(config.publicDir, `.${path.sep}${normalized}`);

  // Son kontrol: cozulen yol gercekten public/ icinde mi?
  const rootWithSep = config.publicDir.endsWith(path.sep)
    ? config.publicDir
    : config.publicDir + path.sep;
  if (absolute !== config.publicDir && !absolute.startsWith(rootWithSep)) return null;

  return absolute;
}

/** Dosya bilgisini getirir; yoksa/erisilemezse null doner. */
async function statOrNull(filePath) {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
}

/**
 * Statik dosyayi sunar.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} pathname
 * @returns {Promise<boolean>} Dosya sunulduysa true, bulunamadiysa false
 */
export async function serveStatic(req, res, pathname) {
  const safePath = resolveSafePath(pathname);
  if (safePath === null) {
    sendText(res, 400, '400 Gecersiz yol');
    return true;
  }

  let filePath = safePath;
  let fileStat = await statOrNull(filePath);

  // Klasor istendiyse icindeki index.html'e yonel
  if (fileStat?.isDirectory()) {
    filePath = path.join(filePath, 'index.html');
    fileStat = await statOrNull(filePath);
  }

  // Not: Uygulama URL tabanli yonlendirme (History API) kullanmadigi icin
  // "bulunamayan her yolu index.html'e dusur" davranisi YOK. Boylece
  // /bilinmeyen/yol gibi adresler dogru sekilde 404 doner.
  if (!fileStat?.isFile()) return false;

  // Zayif ETag: boyut + degistirme zamani yeterince ayirt edicidir.
  const etag = `W/"${fileStat.size.toString(16)}-${fileStat.mtimeMs.toString(16)}"`;
  const isHtml = path.extname(filePath).toLowerCase() === '.html';

  const headers = {
    ...baseSecurityHeaders(),
    'Content-Type': contentTypeFor(filePath),
    'Content-Length': fileStat.size,
    'Last-Modified': fileStat.mtime.toUTCString(),
    ETag: etag,
    // HTML her zaman dogrulanir (yeni surumu kacirmamak icin),
    // digerleri gelistirmede onbelleklenmez.
    'Cache-Control': isHtml || !config.isProduction ? 'no-cache' : 'public, max-age=3600',
  };

  // Istemcide guncel kopya varsa govde gondermeden 304 don
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }

  res.writeHead(200, headers);

  if (req.method === 'HEAD') {
    res.end();
    return true;
  }

  await new Promise((resolve) => {
    const stream = createReadStream(filePath);
    stream.on('error', () => {
      res.destroy(); // baslik gonderildikten sonra duzgun hata veremeyiz
      resolve();
    });
    stream.on('close', resolve);
    stream.pipe(res);
  });

  return true;
}
