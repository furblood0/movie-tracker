/**
 * Poster kartlari.
 *
 *  - `createEntryCard`  : gunluk kaydi karti (durum rozeti, puan, notlar, dugmeler)
 *  - `createResultCard` : TMDb arama sonucu karti (ekle / detay dugmeleri)
 *  - `createSkeletonCards` : icerik yuklenirken gosterilen yer tutucular
 */

import { MEDIA_TYPE_LABELS, STATUS_LABELS, el, formatDate, formatRating } from './dom.js';
import { renderStars } from './stars.js';

/** Afis alani; gorsel yoksa baslikta gecen ilk harfi gosterir. */
function buildPoster(title, posterUrl, badges = [], favorite = false) {
  const inner = posterUrl
    ? el('img', {
        src: posterUrl,
        alt: `${title} afisi`,
        loading: 'lazy',
        decoding: 'async',
      })
    : el('div', { class: 'card__poster-fallback', 'aria-hidden': 'true', text: title.slice(0, 1).toUpperCase() });

  return el(
    'div',
    { class: 'card__poster' },
    inner,
    badges.length > 0 ? el('div', { class: 'card__badges' }, ...badges) : null,
    favorite ? el('span', { class: 'card__favorite', title: 'Favori', text: '\u2665' }) : null,
  );
}

/**
 * Gunluk kaydi karti.
 * @param {object} entry API'den gelen kayit
 * @param {{ onEdit: (entry: object) => void }} handlers
 */
export function createEntryCard(entry, { onEdit }) {
  const badges = [
    el('span', { class: `badge badge--${entry.status}`, text: STATUS_LABELS[entry.status] ?? entry.status }),
    el('span', { class: 'badge badge--type', text: MEDIA_TYPE_LABELS[entry.mediaType] ?? entry.mediaType }),
  ];

  if (entry.rating !== null) {
    badges.push(
      el('span', { class: 'badge badge--score' }, el('span', { 'aria-hidden': 'true', text: '\u2605' }), formatRating(entry.rating)),
    );
  }

  const metaParts = [
    entry.releaseYear ? String(entry.releaseYear) : null,
    entry.watchedAt ? formatDate(entry.watchedAt) : null,
  ].filter(Boolean);

  const editButton = el('button', {
    type: 'button',
    class: 'btn',
    text: 'Duzenle',
    'aria-label': `${entry.title} kaydini duzenle`,
    onclick: () => onEdit(entry),
  });

  return el(
    'article',
    { class: 'card', dataset: { entryId: String(entry.id) } },
    buildPoster(entry.title, entry.posterUrl, badges, entry.favorite),
    el(
      'div',
      { class: 'card__body' },
      el('h3', { class: 'card__title', title: entry.title, text: entry.title }),
      metaParts.length > 0 ? el('p', { class: 'card__meta', text: metaParts.join(' \u00b7 ') }) : null,
      entry.rating !== null ? renderStars(entry.rating, { small: true }) : null,
      entry.genres.length > 0
        ? el('p', {
            class: 'card__genres',
            text: entry.genres.map((genre) => genre.name).join(', '),
          })
        : null,
      entry.review ? el('p', { class: 'card__review', text: entry.review }) : null,
      el('div', { class: 'card__footer' }, editButton),
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
      el('span', { class: 'badge', title: 'TMDb kullanici puani' }, el('span', { 'aria-hidden': 'true', text: '\u2605' }), ` ${formatRating(item.voteAverage)}`),
    );
  }

  return el(
    'article',
    { class: 'card', dataset: { tmdbId: String(item.tmdbId) } },
    buildPoster(item.title, item.posterUrl, badges),
    el(
      'div',
      { class: 'card__body' },
      el('h3', { class: 'card__title', title: item.title, text: item.title }),
      el('p', {
        class: 'card__meta',
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
          'aria-label': `${item.title} icerigini gunluge ekle`,
          onclick: () => onAdd(item),
        }),
        el('button', {
          type: 'button',
          class: 'btn',
          text: 'Detay',
          'aria-label': `${item.title} detaylarini gor`,
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
