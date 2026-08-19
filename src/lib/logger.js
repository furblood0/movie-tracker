/**
 * Minimal, bagimlilik icermeyen loglayici.
 * `debug` seviyesi yalnizca gelistirme ortaminda yazdirilir.
 */

import { config } from '../config.js';

/** HH:MM:SS formatinda yerel saat (log satirlarini kisa tutmak icin). */
function timestamp() {
  return new Date().toISOString().slice(11, 23);
}

function write(stream, level, args) {
  stream.write(`[${timestamp()}] ${level} ${args.map(format).join(' ')}\n`);
}

function format(value) {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export const logger = {
  debug: (...args) => {
    if (!config.isProduction) write(process.stdout, 'DEBUG', args);
  },
  info: (...args) => write(process.stdout, 'INFO ', args),
  warn: (...args) => write(process.stderr, 'WARN ', args),
  error: (...args) => write(process.stderr, 'ERROR', args),
};
