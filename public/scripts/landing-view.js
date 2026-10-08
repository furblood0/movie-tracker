/**
 * Karsilama sayfasi. Oturum yokken sitenin ilk yuzu budur:
 * hesap istemeden urunun ne oldugunu anlatir.
 */

import { el } from './dom.js';

/**
 * @param {{ registrationMode?: 'open' | 'invite' | 'closed' }} [options]
 * @returns {HTMLElement}
 */
export function createLandingView({ registrationMode = 'open' } = {}) {
  const canRegister = registrationMode !== 'closed';

  const registerLink = canRegister
    ? el('a', { class: 'btn btn--primary', href: '/kayit', text: 'Günlüğe başla' })
    : null;

  const note =
    registrationMode === 'closed'
      ? 'Yeni kayıtlar şu anda kapalı.'
      : registrationMode === 'invite'
        ? 'Kayıt davet koduyla açılır.'
        : 'Hesap ücretsizdir. Günlüğün yalnızca sana görünür.';

  return el(
    'section',
    { class: 'landing' },
    el(
      'div',
      { class: 'landing__hero' },
      el('p', { class: 'page-head__eyebrow label-mono', text: 'Kişisel sinema defteri' }),
      el('h1', { class: 'landing__title', text: 'İzlediğin her şey, tek defterde.' }),
      el('p', {
        class: 'landing__lead',
        text: 'Film ve dizileri puanla, kısa bir not düş, izleyeceklerini kaybetme. Arama TMDb arşivinden gelir; puanların ve notların bu günlükte kalır.',
      }),
      el(
        'div',
        { class: 'landing__actions' },
        registerLink,
        el('a', { class: 'btn', href: '/giris', text: 'Giriş yap' }),
      ),
      el('p', { class: 'landing__note', text: note }),
    ),
    el(
      'ol',
      { class: 'landing__steps' },
      step('01', 'Ara', 'Keşfet’te bir film veya dizi bul.'),
      step('02', 'Ekle', 'İzlendi ya da izlenecek olarak günlüğe al.'),
      step('03', 'Puanla', 'Yarım yıldız ver, tarihini ve notunu yaz.'),
    ),
    el(
      'div',
      { class: 'landing__grid' },
      feature('Günlük', 'İzlendi, izlenecek ve favoriler. Tür, puan ve ada göre süz.'),
      feature('Keşfet', 'Haftanın öne çıkanları, arama ve oyuncu kadrosuna kadar detay.'),
      feature('Özet', 'Kaç yapım izledin, ortalaman kaç, hangi tür ağır basıyor.'),
    ),
    el(
      'p',
      { class: 'landing__trust' },
      'Şifren hash’lenerek saklanır. Günlüğünü indirebilir, hesabını istediğin an silebilirsin.',
    ),
  );
}

/**
 * @param {string} number
 * @param {string} title
 * @param {string} text
 */
function step(number, title, text) {
  return el(
    'li',
    { class: 'landing__step' },
    el('span', { class: 'label-mono', text: number }),
    el('strong', { text: title }),
    el('span', { text }),
  );
}

/**
 * @param {string} title
 * @param {string} text
 */
function feature(title, text) {
  return el(
    'section',
    { class: 'landing__feature' },
    el('h2', { text: title }),
    el('p', { text }),
  );
}
