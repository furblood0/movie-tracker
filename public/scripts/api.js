/**
 * Sunucu API istemcisi (Fetch API).
 *
 * - Oturum cerezi HttpOnly oldugu icin JS onu okumaz; tarayici otomatik
 *   gonderir (`credentials: 'same-origin'`).
 * - Tum hatalar `ApiError` olarak firlatilir; cagiran taraf `status` ve
 *   `details.field` bilgisine gore davranabilir (ornek: form alani hatasi).
 */

/** Sunucudan donen hatalari tasiyan hata sinifi. */
export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details ?? null;
  }

  /** Alan bazli dogrulama hatasi mi? */
  get field() {
    return this.details?.field ?? null;
  }
}

/**
 * Oturum dustugunde cagrilacak fonksiyon (app.js tarafindan atanir).
 * @type {(() => void) | null}
 */
let unauthorizedHandler = null;

/**
 * Oturumun gecersiz oldugu anlasildiginda calisacak isleyiciyi kaydeder.
 * Boylece her cagrida ayri ayri 401 kontrolu yapmak gerekmez.
 */
export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler;
}

/**
 * Ortak istek fonksiyonu.
 * @param {string} method
 * @param {string} path
 * @param {unknown} [body]
 */
async function request(method, path, body) {
  /** @type {RequestInit} */
  const options = {
    method,
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  };

  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(path, options);
  } catch {
    // Ag kopmasi / sunucu kapali
    throw new ApiError(0, 'Sunucuya ulasilamiyor. Baglantinizi kontrol edin.');
  }

  // 204 gibi govdesiz yanitlar
  if (response.status === 204) return null;

  const rawText = await response.text();
  let payload = null;
  if (rawText !== '') {
    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    // Oturum sona ermis olabilir: uygulamayi giris ekranina dondur.
    // /api/auth/* uclari haric tutulur; oradaki 401 "sifre hatali" anlamina
    // gelir ve kullaniciyi ekrandan atmak yanlis olur.
    if (response.status === 401 && !path.startsWith('/api/auth/')) {
      unauthorizedHandler?.();
    }

    const message = payload?.error ?? `Beklenmeyen hata (HTTP ${response.status})`;
    throw new ApiError(response.status, message, payload?.details);
  }

  return payload;
}

/** Sorgu dizesi olusturur; bos/null degerler atlanir. */
function buildQuery(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === null || value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const queryString = search.toString();
  return queryString === '' ? '' : `?${queryString}`;
}

export const api = {
  // --- Kimlik dogrulama ---
  me: () => request('GET', '/api/auth/me'),
  register: (payload) => request('POST', '/api/auth/register', payload),
  login: (payload) => request('POST', '/api/auth/login', payload),
  logout: () => request('POST', '/api/auth/logout'),
  changePassword: (payload) => request('POST', '/api/auth/password', payload),

  // --- TMDb proxy ---
  searchTmdb: (params) => request('GET', `/api/tmdb/search${buildQuery(params)}`),
  trending: (params) => request('GET', `/api/tmdb/trending${buildQuery(params)}`),
  tmdbDetails: (mediaType, tmdbId) => request('GET', `/api/tmdb/${mediaType}/${tmdbId}`),

  // --- Izleme gunlugu ---
  listEntries: (filters) => request('GET', `/api/entries${buildQuery(filters)}`),
  getEntry: (id) => request('GET', `/api/entries/${id}`),
  userGenres: () => request('GET', '/api/entries/genres'),
  createEntry: (payload) => request('POST', '/api/entries', payload),
  updateEntry: (id, payload) => request('PATCH', `/api/entries/${id}`, payload),
  deleteEntry: (id) => request('DELETE', `/api/entries/${id}`),

  // --- Durum ---
  health: () => request('GET', '/api/health'),
};
