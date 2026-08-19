/**
 * "Kesfet" gorunumu: TMDb'de arama ve gunluge ekleme.
 *
 * Arama kutusu bosken haftanin one cikan icerikleri gosterilir; kullanici
 * yazmaya basladiginda 400 ms gecikmeyle (debounce) arama istegi atilir.
 * Istekler sunucudaki /api/tmdb proxy'sine gider; API anahtari istemcide yok.
 */

import { api } from './api.js';
import { createEmptyState, createResultCard, createSkeletonCards } from './card.js';
import { MEDIA_TYPE_LABELS, clear, debounce, el, formatRating } from './dom.js';
import { openEntryForm } from './entry-form.js';
import { openModal } from './modal.js';

const SEARCH_TYPES = [
  { value: 'multi', label: 'Hepsi' },
  { value: 'movie', label: 'Film' },
  { value: 'tv', label: 'Dizi' },
];

/**
 * @param {{ onEntrySaved: () => void }} options
 * @returns {HTMLElement}
 */
export function createDiscoverView({ onEntrySaved }) {
  const state = { query: '', type: 'multi', page: 1, totalPages: 1 };

  const grid = el('div', { class: 'card-grid' });
  const sectionTitle = el('h2', { class: 'section-head__title', text: 'Bu hafta one cikanlar' });
  const resultCount = el('p', { class: 'result-count', 'aria-live': 'polite' });
  const paginationHost = el('div');

  const searchInput = el('input', {
    class: 'input filters__search',
    type: 'search',
    placeholder: 'Film veya dizi adi yazin...',
    'aria-label': 'TMDb uzerinde film veya dizi ara',
    autocomplete: 'off',
  });

  const debouncedSearch = debounce(() => {
    state.query = searchInput.value.trim();
    state.page = 1;
    load();
  }, 400);

  searchInput.addEventListener('input', debouncedSearch);

  // Enter'a basildiginda gecikmeyi beklemeden ara.
  // Bekleyen debounce cagrisi iptal edilmezse ayni arama 400 ms sonra
  // ikinci kez gider ve TMDb kotasi bosa harcanir.
  searchInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    debouncedSearch.cancel();
    state.query = searchInput.value.trim();
    state.page = 1;
    load();
  });

  // Icerik turu secimi (cipler)
  const typeChips = el('div', { class: 'chips', role: 'group', 'aria-label': 'Icerik turu' });
  const chipButtons = SEARCH_TYPES.map((option) => {
    const chip = el('button', {
      type: 'button',
      class: `chip${option.value === state.type ? ' is-active' : ''}`,
      text: option.label,
      onclick: () => {
        state.type = option.value;
        state.page = 1;
        chipButtons.forEach((button, index) => {
          button.classList.toggle('is-active', SEARCH_TYPES[index].value === option.value);
        });
        load();
      },
    });
    typeChips.append(chip);
    return chip;
  });

  const view = el(
    'div',
    {},
    el(
      'div',
      { class: 'page-head' },
      el(
        'div',
        {},
        el('h1', { class: 'page-head__title', text: 'Kesfet' }),
        el('p', {
          class: 'page-head__subtitle',
          text: 'TMDb arsivinde arayin, begendiginizi gunlugunuze ekleyin.',
        }),
      ),
    ),
    el(
      'section',
      { class: 'filters', 'aria-label': 'Arama' },
      el('div', { class: 'filters__row' }, searchInput, typeChips),
    ),
    el('div', { class: 'section-head' }, sectionTitle, resultCount),
    grid,
    paginationHost,
  );

  // Ayni sorgunun (ornek: Enter'a iki kez basmak) tekrar istenmesini engeller.
  let lastRequestKey = '';
  // Yanitlarin sirasini korur: yalnizca en son baslatilan istek ekrani cizer.
  let requestSequence = 0;

  /**
   * Arama sonucunu / one cikanlari yukler.
   * @param {{ force?: boolean }} [options] `force` ile ayni sorgu yeniden istenebilir
   */
  async function load({ force = false } = {}) {
    const requestKey = `${state.query}|${state.type}|${state.page}`;
    if (!force && requestKey === lastRequestKey) return;
    lastRequestKey = requestKey;

    // Yazarken birden fazla arama havada olabilir; "matri" yaniti "matrix"
    // yanitindan sonra donerse ekrana eski sonuc yazilmasin.
    const requestId = (requestSequence += 1);

    clear(grid).append(...createSkeletonCards(10));
    clear(paginationHost);
    resultCount.textContent = '';

    const isSearch = state.query !== '';
    sectionTitle.textContent = isSearch ? `"${state.query}" icin sonuclar` : 'Bu hafta one cikanlar';

    try {
      const response = isSearch
        ? await api.searchTmdb({ query: state.query, type: state.type, page: state.page })
        : await api.trending({ window: 'week' });

      if (requestId !== requestSequence) return;

      state.totalPages = response.totalPages ?? 1;
      renderResults(response, isSearch);
    } catch (error) {
      if (requestId !== requestSequence) return;

      clear(grid);
      grid.append(
        createEmptyState({
          icon: '\u26a0',
          title: 'Sonuclar getirilemedi',
          text: error?.message ?? 'Bilinmeyen bir hata olustu.',
          action: el('button', {
            type: 'button',
            class: 'btn',
            text: 'Tekrar dene',
            onclick: () => load({ force: true }),
          }),
        }),
      );
    }
  }

  function renderResults(response, isSearch) {
    clear(grid);
    clear(paginationHost);

    if (response.results.length === 0) {
      grid.append(
        createEmptyState({
          icon: '\u{1F50E}',
          title: 'Sonuc bulunamadi',
          text: 'Baska bir yazim denemeyi veya icerik turu filtresini degistirmeyi deneyin.',
        }),
      );
      return;
    }

    resultCount.textContent = isSearch ? `${response.totalResults} sonuc` : '';

    for (const item of response.results) {
      grid.append(
        createResultCard(item, {
          onAdd: (selected) =>
            openEntryForm({
              mode: 'create',
              source: selected,
              onSaved: () => onEntrySaved?.(),
            }),
          onDetails: (selected) => openDetailsModal(selected, onEntrySaved),
        }),
      );
    }

    // TMDb sayfalama: yalnizca aramada anlamli
    if (isSearch && response.totalPages > 1) {
      paginationHost.append(
        el(
          'nav',
          { class: 'pagination', 'aria-label': 'Sayfalama' },
          el('button', {
            type: 'button',
            class: 'btn',
            text: '\u2190 Onceki',
            disabled: response.page <= 1,
            onclick: () => {
              state.page -= 1;
              load();
              window.scrollTo({ top: 0, behavior: 'smooth' });
            },
          }),
          el('span', { class: 'pagination__info', text: `${response.page} / ${response.totalPages}` }),
          el('button', {
            type: 'button',
            class: 'btn',
            text: 'Sonraki \u2192',
            disabled: response.page >= response.totalPages,
            onclick: () => {
              state.page += 1;
              load();
              window.scrollTo({ top: 0, behavior: 'smooth' });
            },
          }),
        ),
      );
    }
  }

  load();
  searchInput.focus();

  return view;
}

/**
 * Icerik detay modali: TMDb'den ek bilgi (sure, sezon, oyuncular) ceker.
 * @param {object} item Normalize edilmis liste ogesi
 * @param {() => void} [onEntrySaved]
 */
async function openDetailsModal(item, onEntrySaved) {
  const bodyHost = el('div', { text: 'Yukleniyor...' });

  const addButton = el('button', { type: 'button', class: 'btn btn--primary', text: 'Gunluge ekle' });
  const closeButton = el('button', { type: 'button', class: 'btn', text: 'Kapat' });

  const { close } = openModal({
    title: item.title,
    subtitle: [MEDIA_TYPE_LABELS[item.mediaType], item.releaseYear].filter(Boolean).join(' \u00b7 '),
    body: bodyHost,
    footer: [el('span'), closeButton, addButton],
    wide: true,
  });

  closeButton.addEventListener('click', close);

  let details = item;
  addButton.addEventListener('click', () => {
    close();
    openEntryForm({ mode: 'create', source: details, onSaved: () => onEntrySaved?.() });
  });

  try {
    details = await api.tmdbDetails(item.mediaType, item.tmdbId);
  } catch (error) {
    clear(bodyHost);
    bodyHost.append(el('p', { class: 'form-alert', text: error?.message ?? 'Detaylar alinamadi.' }));
    return;
  }

  const metaParts = [
    details.releaseYear ? String(details.releaseYear) : null,
    details.runtime ? `${details.runtime} dk` : null,
    details.numberOfSeasons ? `${details.numberOfSeasons} sezon` : null,
    details.numberOfEpisodes ? `${details.numberOfEpisodes} bolum` : null,
    details.voteAverage ? `TMDb ${formatRating(details.voteAverage)}` : null,
  ].filter(Boolean);

  clear(bodyHost);
  bodyHost.append(
    el(
      'div',
      { class: 'entry-preview' },
      el(
        'div',
        { class: 'entry-preview__poster' },
        details.posterUrl
          ? el('img', { src: details.posterUrl, alt: `${details.title} afisi`, loading: 'lazy' })
          : el('div', { class: 'card__poster-fallback', text: details.title.slice(0, 1).toUpperCase() }),
      ),
      el(
        'div',
        {},
        details.tagline ? el('p', { class: 'entry-preview__meta', text: details.tagline }) : null,
        el('p', { class: 'entry-preview__meta', text: metaParts.join(' \u00b7 ') }),
        details.genres.length > 0
          ? el('p', { class: 'card__genres', text: details.genres.map((genre) => genre.name).join(', ') })
          : null,
        details.overview ? el('p', { class: 'entry-preview__overview', text: details.overview }) : null,
      ),
    ),
  );

  if (details.cast.length > 0) {
    bodyHost.append(
      el('h3', { class: 'section-head__title', text: 'Oyuncular' }),
      el('p', {
        class: 'card__meta',
        text: details.cast
          .map((person) => (person.character ? `${person.name} (${person.character})` : person.name))
          .join(', '),
      }),
    );
  }
}
