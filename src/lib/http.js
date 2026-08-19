/**
 * HTTP yardimcilari: yanit gonderme, istek govdesi okuma, cerez isleme.
 * Tamami saf node:http uzerine kuruludur (Express/body-parser/cors YOK).
 */

import { config } from './../config.js';

/**
 * Kontrollu HTTP hatasi. Rotalarda `throw new HttpError(404, 'Bulunamadi')`
 * seklinde kullanilir; server.js bunu duzgun JSON yanitina cevirir.
 */
export class HttpError extends Error {
  /**
   * @param {number} status HTTP durum kodu
   * @param {string} message Istemciye gosterilebilir mesaj
   * @param {Record<string, unknown>} [details] Alan bazli dogrulama hatalari vb.
   */
  constructor(status, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
    /** Yanita eklenecek ek basliklar (ornek: 429 icin Retry-After). */
    this.headers = undefined;
  }
}

/** Tum yanitlara eklenen temel guvenlik basliklari. */
export function baseSecurityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    // Uygulama kendi kendine yeterli; sadece TMDb gorselleri disaridan gelir.
    'Content-Security-Policy': [
      "default-src 'self'",
      "img-src 'self' https://image.tmdb.org data:",
      "style-src 'self'",
      "script-src 'self'",
      "connect-src 'self'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  };
}

/**
 * JSON yanit gonderir.
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} payload
 * @param {Record<string, string | string[]>} [headers]
 */
export function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload ?? null);
  res.writeHead(status, {
    ...baseSecurityHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

/** Govdesiz yanit (ornek: 204 No Content). */
export function sendEmpty(res, status, headers = {}) {
  res.writeHead(status, { ...baseSecurityHeaders(), ...headers });
  res.end();
}

/** Duz metin yanit (hata sayfalari, health check vb.). */
export function sendText(res, status, text, headers = {}) {
  const body = Buffer.from(text, 'utf8');
  res.writeHead(status, {
    ...baseSecurityHeaders(),
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': body.length,
    ...headers,
  });
  res.end(body);
}

/**
 * Istek govdesini akis (stream) olarak okur ve JSON'a cevirir.
 *
 * - Bos govde `{}` olarak dondurulur.
 * - `maxRequestBodyBytes` sinirini gecen istek 413 ile reddedilir.
 * - Bozuk JSON try-catch ile yakalanip 400'e cevrilir.
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<Record<string, unknown>>}
 */
export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    // Content-Length ile gelen erken uyari: daha veri okumadan reddet.
    const declaredLength = Number.parseInt(req.headers['content-length'] ?? '', 10);
    if (Number.isFinite(declaredLength) && declaredLength > config.maxRequestBodyBytes) {
      reject(new HttpError(413, 'Istek govdesi cok buyuk.'));
      return;
    }

    /** @type {Buffer[]} */
    const chunks = [];
    let receivedBytes = 0;
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };

    const onData = (chunk) => {
      receivedBytes += chunk.length;
      if (receivedBytes > config.maxRequestBodyBytes) {
        finish(reject, new HttpError(413, 'Istek govdesi cok buyuk.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    };

    const onEnd = () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (raw === '') {
        finish(resolve, {});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        // Dizi veya skaler govdeleri reddet: tum uc noktalarimiz nesne bekler.
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          finish(reject, new HttpError(400, 'Istek govdesi bir JSON nesnesi olmalidir.'));
          return;
        }
        finish(resolve, parsed);
      } catch {
        finish(reject, new HttpError(400, 'Istek govdesi gecerli bir JSON degil.'));
      }
    };

    const onError = (error) => {
      finish(reject, new HttpError(400, `Istek govdesi okunamadi: ${error.message}`));
    };

    function cleanup() {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
    }

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

/**
 * `Cookie` basligini ayristirir.
 * @param {string | undefined} cookieHeader
 * @returns {Record<string, string>}
 */
export function parseCookies(cookieHeader) {
  /** @type {Record<string, string>} */
  const cookies = {};
  if (!cookieHeader) return cookies;

  for (const part of cookieHeader.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex === -1) continue;
    const name = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (name === '') continue;
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value; // bozuk yuzde kodlamasi varsa ham degeri kullan
    }
  }
  return cookies;
}

/**
 * `Set-Cookie` basligi olusturur.
 * HttpOnly + SameSite=Strict: XSS ile cerez okunamaz, CSRF yuzeyi daralir.
 * @param {string} name
 * @param {string} value
 * @param {{ maxAgeSeconds?: number, path?: string, httpOnly?: boolean, sameSite?: 'Strict' | 'Lax' | 'None', secure?: boolean }} [options]
 */
export function buildSetCookie(name, value, options = {}) {
  const {
    maxAgeSeconds,
    path = '/',
    httpOnly = true,
    sameSite = 'Strict',
    secure = config.session.secure,
  } = options;

  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `SameSite=${sameSite}`];
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  if (typeof maxAgeSeconds === 'number') {
    parts.push(`Max-Age=${Math.floor(maxAgeSeconds)}`);
    parts.push(`Expires=${new Date(Date.now() + maxAgeSeconds * 1000).toUTCString()}`);
  }
  return parts.join('; ');
}

/** Cerezi silmek icin gecmis tarihli Set-Cookie degeri uretir. */
export function buildClearCookie(name, path = '/') {
  return `${name}=; Path=${path}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict`;
}

/**
 * Istemci IP adresi (ters proxy arkasinda X-Forwarded-For'un ilk degeri).
 * @param {import('node:http').IncomingMessage} req
 */
export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded !== '') {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? '';
}
