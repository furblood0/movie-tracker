/**
 * =====================================================================
 *  Movie Tracker - HTTP sunucu cekirdegi
 * =====================================================================
 *  Tamamen yerlesik Node.js modulleri ile yazilmistir:
 *  node:http, node:url, node:fs, node:path, node:crypto, node:sqlite.
 *  Harici hicbir npm paketi kullanilmaz.
 *
 *  Akis:
 *    istek -> URL ayristirma -> /api/* ise router, degilse statik dosya
 *          -> hata olursa merkezi hata donusturucu -> JSON yanit
 * =====================================================================
 */

import http from 'node:http';

import { config, hasTmdbCredentials } from './config.js';
import { logger } from './lib/logger.js';
import { createRouter } from './lib/router.js';
import { serveStatic } from './lib/static.js';
import {
  HttpError,
  getClientIp,
  parseCookies,
  readJsonBody,
  sendEmpty,
  sendJson,
  sendText,
} from './lib/http.js';
import { cleanupExpired, closeDatabase } from './db/index.js';
import { registerRoutes } from './routes/index.js';

// ---------------------------------------------------------------------
// Router kurulumu
// ---------------------------------------------------------------------
const router = createRouter();
registerRoutes(router);

/**
 * Rota isleyicilerine gecirilen baglam (context) nesnesi.
 * Express'in `req/res` genisletmesi yerine acik, tahmin edilebilir bir nesne.
 *
 * @typedef {Object} RequestContext
 * @property {import('node:http').IncomingMessage} req
 * @property {import('node:http').ServerResponse} res
 * @property {URL} url
 * @property {URLSearchParams} query
 * @property {Record<string, string>} params
 * @property {Record<string, string>} cookies
 * @property {string} ip
 * @property {() => Promise<Record<string, unknown>>} body JSON govdeyi okur
 * @property {{ id: number, username: string, email: string | null, displayName: string, createdAt: string } | null} user
 *   Kimlik dogrulandiysa dolar (attachUser/requireAuth tarafindan)
 * @property {string | null} sessionId Aktif oturum kimligi (varsa)
 */

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {URL} url
 * @param {Record<string, string>} params
 * @returns {RequestContext}
 */
function createContext(req, res, url, params) {
  return {
    req,
    res,
    url,
    query: url.searchParams,
    params,
    cookies: parseCookies(req.headers.cookie),
    ip: getClientIp(req),
    body: () => readJsonBody(req),
    user: null,
    sessionId: null,
  };
}

// ---------------------------------------------------------------------
// Merkezi hata donusturucu
// ---------------------------------------------------------------------
/**
 * @param {unknown} error
 * @param {import('node:http').ServerResponse} res
 * @param {string} requestLabel Log icin "GET /api/x" bicimi
 */
function handleError(error, res, requestLabel) {
  if (res.headersSent) {
    // Yanit baslamissa yapacak bir sey yok: baglantiyi kapat.
    logger.error(`${requestLabel} - yanit basladiktan sonra hata:`, error);
    res.destroy();
    return;
  }

  if (error instanceof HttpError) {
    // Beklenen (is kurali) hatalari: istemciye mesaji gosterebiliriz.
    logger.debug(`${requestLabel} -> ${error.status} ${error.message}`);
    sendJson(
      res,
      error.status,
      {
        error: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
      error.headers ?? {},
    );
    return;
  }

  // Beklenmeyen hata: detay sizdirmadan 500 don, tam izi sunucuya logla.
  logger.error(`${requestLabel} - beklenmeyen hata:`, error);
  sendJson(res, 500, { error: 'Sunucu tarafinda beklenmeyen bir hata olustu.' });
}

// ---------------------------------------------------------------------
// Ana istek isleyici
// ---------------------------------------------------------------------
/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
async function handleRequest(req, res) {
  const startedAt = process.hrtime.bigint();
  const method = req.method ?? 'GET';

  // Mutlak URL sarti icin sahte bir taban kullaniyoruz; sadece
  // pathname ve query kismi bizi ilgilendiriyor.
  let url;
  try {
    url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  } catch {
    sendText(res, 400, '400 Gecersiz istek satiri');
    return;
  }

  const requestLabel = `${method} ${url.pathname}`;

  // Yanit tamamlandiginda tek satir erisim logu.
  // Gelistirmede DEBUG (ayrintili ciktinin arasinda kaybolmasin),
  // production'da INFO: erisim loglari orada gorunmek zorundadir.
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const line = `${requestLabel} ${res.statusCode} ${durationMs.toFixed(1)}ms`;
    if (config.isProduction) logger.info(line);
    else logger.debug(line);
  });

  try {
    const isApiRequest = url.pathname === '/api' || url.pathname.startsWith('/api/');

    if (isApiRequest) {
      // Ayni kaynak (same-origin) politikasi: CORS acmiyoruz.
      // Tarayici on kontrol istegi gelirse sadece izinli metotlari bildiririz.
      const matched = router.match(method === 'HEAD' ? 'GET' : method, url.pathname);

      if (matched === null) {
        throw new HttpError(404, `Bilinmeyen API adresi: ${url.pathname}`);
      }

      if ('allowedMethods' in matched) {
        const allow = matched.allowedMethods.join(', ');
        if (method === 'OPTIONS') {
          sendEmpty(res, 204, { Allow: allow });
          return;
        }
        throw new HttpError(405, `Bu adres ${method} metodunu desteklemiyor.`);
      }

      const ctx = createContext(req, res, url, matched.params);
      await matched.handler(ctx);

      // Isleyici yaniti kapatmadiysa bu bir programlama hatasidir.
      if (!res.writableEnded && !res.headersSent) {
        throw new Error(`Rota yanit dondurmedi: ${requestLabel}`);
      }
      return;
    }

    // --- Statik dosyalar ---
    if (method !== 'GET' && method !== 'HEAD') {
      sendText(res, 405, '405 Method Not Allowed', { Allow: 'GET, HEAD' });
      return;
    }

    const served = await serveStatic(req, res, url.pathname);
    if (!served) sendText(res, 404, '404 Bulunamadi');
  } catch (error) {
    handleError(error, res, requestLabel);
  }
}

// ---------------------------------------------------------------------
// Sunucuyu ayaga kaldir
// ---------------------------------------------------------------------
const server = http.createServer(handleRequest);

// Yavas istemcilere karsi makul zaman asimlari
server.headersTimeout = 30_000;
server.requestTimeout = 60_000;
server.keepAliveTimeout = 10_000;

// Bozuk HTTP istegi gonderen istemciler surecin cokmesine yol acmamali
server.on('clientError', (error, socket) => {
  // Tarayicilar sayfa acilirken yedek (preconnect) TCP baglantilari acar ve
  // uzerlerinden hic istek gondermez. Bu baglantilar headersTimeout dolunca
  // ERR_HTTP_REQUEST_TIMEOUT ile kapanir; normal davranistir, uyari degil.
  const isIdlePreconnect = error.code === 'ERR_HTTP_REQUEST_TIMEOUT' && socket.bytesRead === 0;

  if (isIdlePreconnect) logger.debug('Bos preconnect baglantisi kapatildi');
  else logger.warn(`Istemci protokol hatasi: ${error.code ?? error.message}`);

  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  else socket.destroy();
});

// Acilista bir kez, sonra saatte bir bakim temizligi
cleanupExpired();
const cleanupTimer = setInterval(cleanupExpired, 60 * 60 * 1000);
cleanupTimer.unref(); // surecin kapanmasini engellemesin

server.listen(config.port, config.host, () => {
  logger.info(`Movie Tracker calisiyor -> http://${config.host}:${config.port} (${config.env})`);
  logger.info(`Veritabani: ${config.dbPath}`);
  if (!hasTmdbCredentials()) {
    logger.warn('TMDB_API_KEY tanimli degil: arama uc noktasi 503 dondurecek. .env dosyasini doldurun.');
  }
});

// ---------------------------------------------------------------------
// Duzenli kapanma (graceful shutdown)
// ---------------------------------------------------------------------
let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} alindi, sunucu kapatiliyor...`);

  clearInterval(cleanupTimer);

  // Yeni baglantilari kes, acik istekleri bitmeye birak
  server.close(() => {
    closeDatabase();
    logger.info('Kapanis tamamlandi.');
    process.exit(0);
  });

  // Takilan baglantilar icin zorunlu cikis emniyeti
  setTimeout(() => {
    logger.warn('Zaman asimi: surec zorla kapatiliyor.');
    closeDatabase();
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Yakalanmamis hatalar: logla, veritabanini duzgun kapat, cik.
process.on('unhandledRejection', (reason) => {
  logger.error('Yakalanmamis promise reddi:', reason);
});
process.on('uncaughtException', (error) => {
  logger.error('Yakalanmamis istisna:', error);
  closeDatabase();
  process.exit(1);
});
