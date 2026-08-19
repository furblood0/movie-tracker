/**
 * Kisa bildirim (toast) katmani.
 * Kullanicinin yaptigi islemin sonucunu sayfayi bozmadan bildirir.
 */

import { el } from './dom.js';

const stack = document.querySelector('#toast-stack');
const DEFAULT_DURATION_MS = 3600;

/**
 * Bildirim gosterir.
 * @param {string} message
 * @param {'info' | 'success' | 'error' | 'warning'} [type]
 * @param {number} [durationMs]
 */
export function showToast(message, type = 'info', durationMs = DEFAULT_DURATION_MS) {
  const icons = { info: 'i', success: '\u2713', error: '!', warning: '!' };

  const toast = el(
    'div',
    { class: `toast toast--${type}`, role: type === 'error' ? 'alert' : 'status' },
    el('span', { class: 'toast__icon', 'aria-hidden': 'true', text: icons[type] ?? 'i' }),
    el('span', { class: 'toast__message', text: message }),
  );

  stack.append(toast);

  const remove = () => {
    toast.classList.add('is-leaving');
    // Cikis animasyonu bitince DOM'dan kaldir
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    setTimeout(() => toast.remove(), 400); // animasyon calismazsa emniyet
  };

  const timerId = setTimeout(remove, durationMs);

  // Tiklayarak erken kapatma
  toast.addEventListener('click', () => {
    clearTimeout(timerId);
    remove();
  });

  return remove;
}

/** Hata nesnesini kullaniciya uygun mesajla gosterir. */
export function showApiError(error) {
  const message = error?.message ?? 'Beklenmeyen bir hata olustu.';
  showToast(message, 'error', 5000);
}
