/**
 * Kucuk DOM yardimcilari.
 *
 * GUVENLIK NOTU: Bu modul bilincli olarak `innerHTML` KULLANMAZ. Tum metinler
 * `textContent` ile yazilir, boylece kullanici verisi (baslik, yorum, kullanici
 * adi) hicbir zaman HTML olarak yorumlanmaz -> XSS yuzeyi kapatilir.
 */

/**
 * Eleman olusturur.
 *
 * @param {string} tag Etiket adi ("div", "button", ...)
 * @param {Record<string, unknown>} [props]
 *   - `class`: sinif adi
 *   - `text`: textContent
 *   - `on<Event>`: olay dinleyici (ornek: onclick)
 *   - `dataset`: data-* nitelikleri nesnesi
 *   - `style`: CSSOM uzerinden uygulanan stil nesnesi
 *   - digerleri: nitelik (attribute) olarak yazilir; false/null ise atlanir
 * @param {...(Node | string | null | undefined | Array<Node | string | null | undefined>)} children
 * @returns {HTMLElement}
 */
export function el(tag, props = {}, ...children) {
  const element = document.createElement(tag);

  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'class') {
      element.className = String(value);
    } else if (key === 'text') {
      element.textContent = String(value);
    } else if (key === 'dataset') {
      Object.assign(element.dataset, value);
    } else if (key === 'style') {
      // Nitelik olarak degil, CSSOM uzerinden: CSP style-src ile uyumlu kalir.
      for (const [property, propertyValue] of Object.entries(value)) {
        if (property.startsWith('--')) element.style.setProperty(property, String(propertyValue));
        else element.style[property] = String(propertyValue);
      }
    } else if (key.startsWith('on') && typeof value === 'function') {
      element.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) {
      element.setAttribute(key, '');
    } else {
      element.setAttribute(key, String(value));
    }
  }

  appendChildren(element, children);
  return element;
}

/** Cocuk ogeleri (ic ice dizileri de duzleyerek) ekler. */
export function appendChildren(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Elemanin tum icerigini temizler. */
export function clear(element) {
  element.replaceChildren();
  return element;
}

/**
 * Fonksiyonu geciktirir: son cagridan `waitMs` sonra bir kez calisir.
 * Arama kutusunda her tus vurusunda istek atmamak icin kullanilir.
 *
 * Donen fonksiyonun `cancel()` metodu bekleyen cagriyi iptal eder. Kullanici
 * Enter'a basip aramayi hemen tetikledigimizde bunu cagirmak gerekir; aksi
 * halde bekleyen zamanlayici da atesler ve ayni istek iki kez gider.
 */
export function debounce(fn, waitMs = 350) {
  let timerId;

  const debounced = (...args) => {
    clearTimeout(timerId);
    timerId = setTimeout(() => fn(...args), waitMs);
  };

  debounced.cancel = () => clearTimeout(timerId);
  return debounced;
}

/** "2024-03-15" -> "15 Mart 2024" */
export function formatDate(isoDate) {
  if (!isoDate) return '';
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;

  return date.toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Puani gosterim icin bicimlendirir: 8 -> "8", 8.5 -> "8.5" */
export function formatRating(rating) {
  if (rating === null || rating === undefined) return '';
  return Number.isInteger(rating) ? String(rating) : rating.toFixed(1);
}

/** Izleme durumu -> Turkce etiket */
export const STATUS_LABELS = {
  watched: 'Izlendi',
  watchlist: 'Izlenecek',
  dropped: 'Birakildi',
};

/** Icerik turu -> Turkce etiket */
export const MEDIA_TYPE_LABELS = {
  movie: 'Film',
  tv: 'Dizi',
};
