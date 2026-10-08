/**
 * Ozet sayfasi: izleme sayilari, tur dagilimi, yillar ve en yuksek puanlar.
 * Paylasilacak ekran budur; veri yalnizca oturum sahibine aittir.
 */

import { api } from './api.js';
import { createEmptyState } from './card.js';
import { MEDIA_TYPE_LABELS, clear, el, formatRating } from './dom.js';
import { showApiError } from './toast.js';

/**
 * @param {{ onNavigateDiscover: () => void }} options
 * @returns {HTMLElement}
 */
export function createStatsView({ onNavigateDiscover }) {
  const body = el('div', { 'aria-busy': 'true' });
  const root = el(
    'section',
    { class: 'stats' },
    el(
      'div',
      { class: 'page-head' },
      el(
        'div',
        {},
        el('span', { class: 'page-head__eyebrow label-mono', text: 'Günlüğün' }),
        el('h1', { class: 'page-head__title', text: 'Özet' }),
        el('p', { class: 'page-head__subtitle', text: 'İzlediklerinin sayısı, ortalaman ve ağır basan türler.' }),
      ),
      el(
        'div',
        { class: 'page-head__actions' },
        el('a', { class: 'btn', href: '/api/entries/export?format=csv', download: 'movie-tracker.csv', text: 'CSV indir' }),
        el('a', { class: 'btn', href: '/api/entries/export?format=json', download: 'movie-tracker.json', text: 'JSON indir' }),
      ),
    ),
    body,
  );

  async function load() {
    body.setAttribute('aria-busy', 'true');
    clear(body);
    body.append(el('p', { class: 'stats__loading', text: 'Özet hazırlanıyor…' }));

    try {
      const summary = await api.stats();
      clear(body);
      body.append(renderSummary(summary, onNavigateDiscover));
    } catch (error) {
      clear(body);
      showApiError(error);
      body.append(el('p', { class: 'stats__loading', text: 'Özet yüklenemedi.' }));
    } finally {
      body.setAttribute('aria-busy', 'false');
    }
  }

  root.refresh = load;
  load();
  return root;
}

/**
 * @param {object} summary
 * @param {() => void} onNavigateDiscover
 */
function renderSummary(summary, onNavigateDiscover) {
  const totals = summary.totals;
  if (totals.total === 0) {
    return createEmptyState({
      icon: '✶',
      title: 'Özet için bir kayıt gerek',
      text: 'Keşfet’ten bir film veya dizi ekleyince sayılar burada belirir.',
      action: el('button', {
        type: 'button',
        class: 'btn btn--primary',
        text: 'Keşfet’e git',
        onclick: onNavigateDiscover,
      }),
    });
  }

  const average = totals.averageRating === null ? '—' : formatRating(totals.averageRating);
  const watchedLine = `${totals.watchedMovies} film, ${totals.watchedShows} dizi izlendi.`;

  const blocks = [
    el(
      'div',
      { class: 'stat-grid' },
      statCard(String(totals.watched), 'İzlendi'),
      statCard(String(totals.watchlist), 'İzlenecek'),
      statCard(String(totals.favorites), 'Favori'),
      statCard(average, totals.ratedCount > 0 ? `${totals.ratedCount} puanın ortalaması` : 'Ortalama puan'),
    ),
    el('p', { class: 'stats__line', text: watchedLine }),
  ];

  if (summary.genres.length > 0) {
    const max = summary.genres[0].count;
    blocks.push(
      el(
        'section',
        { class: 'stats__block' },
        el('h2', { class: 'section-head__title', text: 'İzlenen türler' }),
        el(
          'div',
          { class: 'meters' },
          ...summary.genres.map((genre) => meter(genre.name, genre.count, max)),
        ),
      ),
    );
  }

  if (summary.years.length > 0) {
    blocks.push(
      el(
        'section',
        { class: 'stats__block' },
        el('h2', { class: 'section-head__title', text: 'Yıllara göre' }),
        el(
          'ul',
          { class: 'year-list' },
          ...summary.years.map((year) =>
            el(
              'li',
              {},
              el('span', { class: 'label-mono', text: year.year }),
              el('span', { text: `${year.count} yapım` }),
              el('span', {
                text: year.averageRating === null ? 'puansız' : `ort. ${formatRating(year.averageRating)}`,
              }),
            ),
          ),
        ),
      ),
    );
  }

  if (summary.topRated.length > 0) {
    blocks.push(
      el(
        'section',
        { class: 'stats__block' },
        el('h2', { class: 'section-head__title', text: 'En yüksek puanların' }),
        el(
          'ol',
          { class: 'top-list' },
          ...summary.topRated.map((entry) =>
            el(
              'li',
              {},
              el('span', { class: 'top-list__score label-mono', text: formatRating(entry.rating) }),
              el(
                'span',
                { class: 'top-list__title' },
                el('span', { text: entry.title }),
                el('span', {
                  class: 'top-list__meta',
                  text: [MEDIA_TYPE_LABELS[entry.mediaType], entry.releaseYear].filter(Boolean).join(' · '),
                }),
              ),
            ),
          ),
        ),
      ),
    );
  }

  return el('div', { class: 'stats__body' }, ...blocks);
}

/**
 * @param {string} value
 * @param {string} label
 */
function statCard(value, label) {
  return el(
    'div',
    { class: 'stat-card' },
    el('p', { class: 'stat-card__value', text: value }),
    el('p', { class: 'stat-card__label', text: label }),
  );
}

/**
 * @param {string} name
 * @param {number} count
 * @param {number} max
 */
function meter(name, count, max) {
  const width = max > 0 ? Math.max(4, Math.round((count / max) * 100)) : 0;
  return el(
    'div',
    { class: 'meter' },
    el('span', { class: 'meter__name', text: name }),
    el(
      'span',
      { class: 'meter__track', 'aria-hidden': 'true' },
      el('span', { class: 'meter__fill', style: { width: `${width}%` } }),
    ),
    el('span', { class: 'meter__count label-mono', text: String(count) }),
  );
}
