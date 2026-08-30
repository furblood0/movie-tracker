/**
 * Poster kartlari.
 *
 *  - `createEntryCard`  : gunluk kaydi karti (bilet kocani duzeni)
 *  - `createResultCard` : TMDb arama sonucu karti (ekle / detay dugmeleri)
 *  - `createSkeletonCards` : icerik yuklenirken gosterilen yer tutucular
 */

import { MEDIA_TYPE_LABELS, STATUS_LABELS, el, formatDate, formatRating } from './dom.js';

/**
 * Afis alani; gorsel yoksa baslikta gecen ilk harfi gosterir.
 * `overlay` afisin uzerine binen ogeler (durum, puan, tur) icin serbest alandir.
 */
function buildPoster(title, posterUrl, overlay = [], favorite = false) {
  const inner = posterUrl
    ? el('img', {
        src: posterUrl,
        alt: `${title} afişi`,
        loading: 'lazy',
        decoding: 'async',
      })
    : el('div', { class: 'card__poster-fallback', 'aria-hidden': 'true', text: title.slice(0, 1).toUpperCase() });

  return el(
    'div',
    { class: 'card__poster' },
    inner,
    overlay,
    favorite ? el('span', { class: 'card__favorite', title: 'Favori', text: '\u2665' }) : null,
  );
}

/**
 * Gunluk kaydi karti: bilet kocani duzeni.
 *
 * Bilgi hiyerarsisi bilincli olarak sadelestirildi. Onceden afisin ustunde uc
 * rozet (durum + tur + puan) ustuste duruyor, puan bir de govdedeki yildiz
 * siralarinda tekrar ediyordu. Simdi her bilgi tek bir yerde:
 *   afis ustu    -> durum (renkli nokta), tur, puan, favori
 *   govde        -> baslik, yil, turler, not
 *   kocan seridi -> izleme tarihi + duzenle
 */
export function createEntryCard(entry, { onEdit }) {
  const statusLabel = STATUS_LABELS[entry.status] ?? entry.status;

  const posterOverlay = [
    el(
      'div',
      { class: 'card__flags' },
      el('span', {
        class: 'card__status label-mono',
        dataset: { status: entry.status },
        text: statusLabel,
      }),
    ),
    el(
      'div',
      { class: 'card__poster-foot' },
      entry.rating !== null
        ? el(
            'span',
            { class: 'card__score', 'aria-label': `Puanınız: ${formatRating(entry.rating)} / 10` },
            el('span', { class: 'card__score-mark', 'aria-hidden': 'true', text: '\u2605' }),
            el('span', { 'aria-hidden': 'true', text: formatRating(entry.rating) }),
          )
        : null,
      el('span', {
        class: 'card__type label-mono',
        text: MEDIA_TYPE_LABELS[entry.mediaType] ?? entry.mediaType,
      }),
    ),
  ];

  // Kocan seridi izleme tarihini tasir; henuz izlenmemis kayitlarda tarih
  // yoktur, o zaman durumu yazariz ki serit bos kalmasin.
  const stubText = entry.watchedAt ? formatDate(entry.watchedAt) : statusLabel;

  return el(
    'article',
    { class: 'card', dataset: { entryId: String(entry.id) } },
    buildPoster(entry.title, entry.posterUrl, posterOverlay, entry.favorite),
    el(
      'div',
      { class: 'card__body' },
      el('h3', { class: 'card__title', title: entry.title, text: entry.title }),
      el(
        'p',
        { class: 'card__meta label-mono' },
        entry.releaseYear ? String(entry.releaseYear) : '\u2014',
      ),
      entry.genres.length > 0
        ? el('p', {
            class: 'card__genres',
            text: entry.genres.map((genre) => genre.name).join(', '),
          })
        : null,
      entry.review ? el('p', { class: 'card__review', text: entry.review }) : null,
    ),
    el(
      'div',
      { class: 'card__stub' },
      el('span', { class: 'card__stub-date label-mono', text: stubText }),
      el('button', {
        type: 'button',
        class: 'card__stub-action label-mono',
        text: 'Düzenle',
        'aria-label': `${entry.title} kaydını düzenle`,
        onclick: () => onEdit(entry),
      }),
    ),
  );
}

/**
 * TMDb arama sonucu karti.
 * @param {object} item Normalize edilmis TMDb ogesi
 * @param {{ onAdd: (item: object) => void, onDetails: (item: object) => void }} handlers
 */
export function createResultCard(item, { onAdd, onDetails }) {
  const badges = [el('span', { class: 'badge badge--type', text: MEDIA_TYPE_LABELS[item.mediaType] ?? item.mediaType })];

  if (item.voteAverage) {
    badges.push(
      el('span', { class: 'badge', title: 'TMDb kullanıcı puanı' }, el('span', { 'aria-hidden': 'true', text: '\u2605' }), ` ${formatRating(item.voteAverage)}`),
    );
  }

  return el(
    'article',
    { class: 'card', dataset: { tmdbId: String(item.tmdbId) } },
    buildPoster(item.title, item.posterUrl, el('div', { class: 'card__badges' }, ...badges)),
    el(
      'div',
      { class: 'card__body' },
      el('h3', { class: 'card__title', title: item.title, text: item.title }),
      el('p', {
        class: 'card__meta label-mono',
        text: [item.releaseYear ? String(item.releaseYear) : null, item.genres.map((genre) => genre.name)[0] ?? null]
          .filter(Boolean)
          .join(' \u00b7 '),
      }),
      el(
        'div',
        { class: 'card__footer' },
        el('button', {
          type: 'button',
          class: 'btn btn--primary',
          text: 'Ekle',
          'aria-label': `${item.title} içeriğini günlüğe ekle`,
          onclick: () => onAdd(item),
        }),
        el('button', {
          type: 'button',
          class: 'btn',
          text: 'Detay',
          'aria-label': `${item.title} detaylarını gör`,
          onclick: () => onDetails(item),
        }),
      ),
    ),
  );
}

/** Yuklenirken gosterilen iskelet kartlar. */
export function createSkeletonCards(count = 8) {
  return Array.from({ length: count }, () =>
    el(
      'div',
      { class: 'skeleton-card', 'aria-hidden': 'true' },
      el('div', { class: 'skeleton-card__poster' }),
      el('div', { class: 'skeleton-card__line' }),
      el('div', { class: 'skeleton-card__line skeleton-card__line--short' }),
    ),
  );
}

/**
 * Bos durum bileseni.
 * @param {{ icon: string, title: string, text: string, action?: HTMLElement }} options
 */
export function createEmptyState({ icon, title, text, action }) {
  return el(
    'div',
    { class: 'empty-state' },
    el('div', { class: 'empty-state__icon', 'aria-hidden': 'true', text: icon }),
    el('h3', { class: 'empty-state__title', text: title }),
    el('p', { class: 'empty-state__text', text }),
    action ?? null,
  );
}
