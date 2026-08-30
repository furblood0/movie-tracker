/**
 * "Gunlugum" gorunumu: filtreleme, siralama, sayfalama ve kart izgarasi.
 *
 * Durum yonetimi: modul icinde tutulan `state` nesnesi tek dogruluk kaynagidir.
 * Her filtre degisikliginde sayfa 1'e doner ve `load()` yeniden cagrilir.
 */

import { api } from './api.js';
import { createEmptyState, createEntryCard, createSkeletonCards } from './card.js';
import { clear, debounce, el } from './dom.js';
import { openEntryForm } from './entry-form.js';

const STATUS_FILTERS = [
  { value: '', label: 'Tümü' },
  { value: 'watched', label: 'İzlendi' },
  { value: 'watchlist', label: 'İzlenecek' },
  { value: 'dropped', label: 'Bırakıldı' },
];

const SORT_OPTIONS = [
  { value: 'updated', label: 'Son güncellenen' },
  { value: 'created', label: 'Eklenme tarihi' },
  { value: 'rating', label: 'Puan' },
  { value: 'watched', label: 'İzleme tarihi' },
  { value: 'title', label: 'Başlık' },
  { value: 'year', label: 'Yapım yılı' },
];

/**
 * Gunluk gorunumunu olusturur.
 * @param {{ onNavigateDiscover: () => void }} options
 * @returns {HTMLElement}
 */
export function createLibraryView({ onNavigateDiscover }) {
  const state = {
    status: '',
    mediaType: '',
    genreId: '',
    minRating: '',
    favorite: false,
    unrated: false,
    search: '',
    sort: 'updated',
    order: 'desc',
    page: 1,
    limit: 24,
  };

  const grid = el('div', { class: 'card-grid' });
  const resultCount = el('p', { class: 'result-count label-mono', 'aria-live': 'polite' });
  const paginationHost = el('div');

  // --- Durum cipleri ---
  const chipRow = el('div', { class: 'chips', role: 'group', 'aria-label': 'Duruma göre filtrele' });
  const chipButtons = STATUS_FILTERS.map((filter) => {
    const chip = el('button', {
      type: 'button',
      class: `chip${filter.value === state.status ? ' is-active' : ''}`,
      text: filter.label,
      onclick: () => {
        state.status = filter.value;
        chipButtons.forEach((button, index) => {
          button.classList.toggle('is-active', STATUS_FILTERS[index].value === filter.value);
        });
        resetAndLoad();
      },
    });
    chipRow.append(chip);
    return chip;
  });

  // --- Acilir menuler ---
  const mediaTypeSelect = createSelect('Tür', [
    { value: '', label: 'Film + Dizi' },
    { value: 'movie', label: 'Sadece film' },
    { value: 'tv', label: 'Sadece dizi' },
  ], (value) => {
    state.mediaType = value;
    resetAndLoad();
  });

  const genreSelect = createSelect('Kategori', [{ value: '', label: 'Tüm kategoriler' }], (value) => {
    state.genreId = value;
    resetAndLoad();
  });

  const minRatingSelect = createSelect('Puan', buildRatingOptions(), (value) => {
    // "unrated" ozel bir deger: puansiz kayitlari getirir
    state.unrated = value === 'unrated';
    state.minRating = value === 'unrated' ? '' : value;
    resetAndLoad();
  });

  const sortSelect = createSelect(
    'Sırala',
    SORT_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
    (value) => {
      state.sort = value;
      resetAndLoad();
    },
  );

  const orderButton = el('button', {
    type: 'button',
    class: 'btn btn--icon',
    title: 'Sıralama yönünü değiştir',
    'aria-label': 'Sıralama yönünü değiştir',
    text: '\u2193',
    onclick: () => {
      state.order = state.order === 'desc' ? 'asc' : 'desc';
      orderButton.textContent = state.order === 'desc' ? '\u2193' : '\u2191';
      resetAndLoad();
    },
  });

  const favoriteChip = el('button', {
    type: 'button',
    class: 'chip',
    text: '\u2665 Favoriler',
    'aria-pressed': 'false',
    onclick: () => {
      state.favorite = !state.favorite;
      favoriteChip.classList.toggle('is-active', state.favorite);
      favoriteChip.setAttribute('aria-pressed', String(state.favorite));
      resetAndLoad();
    },
  });

  const searchInput = el('input', {
    class: 'input filters__search',
    type: 'search',
    placeholder: 'Günlüğümde ara...',
    'aria-label': 'Günlüğümde başlık ara',
  });

  // Her tus vurusunda istek atmamak icin 300 ms geciktirilir
  searchInput.addEventListener(
    'input',
    debounce(() => {
      state.search = searchInput.value.trim();
      resetAndLoad();
    }, 300),
  );

  const clearFiltersButton = el('button', {
    type: 'button',
    class: 'btn btn--ghost',
    text: 'Filtreleri temizle',
    onclick: () => resetFilters(),
  });

  // Kayit sayaci filtre cubugunun sagina oturur: eskiden cubukla izgara
  // arasinda tek basina bir satir kaplayip afisleri asagi itiyordu.
  const filters = el(
    'section',
    { class: 'filters', 'aria-label': 'Filtreler' },
    el('div', { class: 'filters__row' }, chipRow, favoriteChip, resultCount),
    el(
      'div',
      { class: 'filters__row filters__row--meta' },
      searchInput,
      mediaTypeSelect.wrapper,
      genreSelect.wrapper,
      minRatingSelect.wrapper,
      sortSelect.wrapper,
      orderButton,
      clearFiltersButton,
    ),
  );

  const view = el(
    'div',
    {},
    el(
      'div',
      { class: 'page-head' },
      el(
        'div',
        {},
        el('span', { class: 'page-head__eyebrow label-mono', text: 'Film & Dizi Günlüğü' }),
        el('h1', { class: 'page-head__title', text: 'Günlüğüm' }),
        el('p', { class: 'page-head__subtitle', text: 'İzlediklerinizi ve izleyeceklerinizi yönetin.' }),
      ),
      el(
        'div',
        { class: 'page-head__actions' },
        el('button', {
          type: 'button',
          class: 'btn btn--primary',
          text: '+ İçerik ekle',
          onclick: onNavigateDiscover,
        }),
      ),
    ),
    filters,
    grid,
    paginationHost,
  );

  /** Filtreleri baslangic haline dondurur. */
  function resetFilters() {
    Object.assign(state, {
      status: '',
      mediaType: '',
      genreId: '',
      minRating: '',
      favorite: false,
      unrated: false,
      search: '',
      sort: 'updated',
      order: 'desc',
      page: 1,
    });

    chipButtons.forEach((button, index) => button.classList.toggle('is-active', STATUS_FILTERS[index].value === ''));
    favoriteChip.classList.remove('is-active');
    favoriteChip.setAttribute('aria-pressed', 'false');
    mediaTypeSelect.select.value = '';
    genreSelect.select.value = '';
    minRatingSelect.select.value = '';
    sortSelect.select.value = 'updated';
    orderButton.textContent = '\u2193';
    searchInput.value = '';

    load();
  }

  function resetAndLoad() {
    state.page = 1;
    load();
  }

  /** Kullanicinin turlerini cekip kategori menusunu doldurur. */
  async function loadGenres() {
    try {
      const { genres } = await api.userGenres();
      const previousValue = genreSelect.select.value;

      clear(genreSelect.select);
      genreSelect.select.append(el('option', { value: '', text: 'Tüm kategoriler' }));
      for (const genre of genres) {
        genreSelect.select.append(
          el('option', { value: String(genre.id), text: `${genre.name} (${genre.count})` }),
        );
      }
      // Secili kategori halen listede varsa korunur
      genreSelect.select.value = [...genreSelect.select.options].some((option) => option.value === previousValue)
        ? previousValue
        : '';
    } catch {
      // Kategori menusu ikincil bir ozellik: hata durumunda sessizce gecilir.
    }
  }

  // Ayni anda birden fazla istek havada olabilir (hizli filtre degisimi veya
  // arama kutusuna yazmak). Her istege artan bir numara veriyoruz; yanit
  // dondugunde numara halen en guncel degilse cizim atlanir. Aksi halde yavas
  // bir baglantida onceki filtrenin sonucu, yenisinin uzerine yazilabilir.
  let requestSequence = 0;

  /** Listeyi sunucudan ceker ve izgarayi cizer. */
  async function load() {
    const requestId = (requestSequence += 1);

    clear(grid).append(...createSkeletonCards(8));
    resultCount.textContent = 'Yükleniyor...';
    clear(paginationHost);

    try {
      const response = await api.listEntries({
        status: state.status || null,
        mediaType: state.mediaType || null,
        genreId: state.genreId || null,
        minRating: state.minRating || null,
        favorite: state.favorite ? 'true' : null,
        unrated: state.unrated ? 'true' : null,
        search: state.search || null,
        sort: state.sort,
        order: state.order,
        page: state.page,
        limit: state.limit,
      });

      // Bu istek beklerken daha yenisi baslatildiysa sonucu yok say.
      if (requestId !== requestSequence) return;

      renderList(response);
    } catch (error) {
      if (requestId !== requestSequence) return;

      clear(grid);
      resultCount.textContent = '';
      grid.append(
        createEmptyState({
          icon: '\u26a0',
          title: 'Liste yüklenemedi',
          text: error?.message ?? 'Bilinmeyen bir hata oluştu.',
          action: el('button', { type: 'button', class: 'btn', text: 'Tekrar dene', onclick: () => load() }),
        }),
      );
    }
  }

  /** Sunucu yanitini izgaraya cevirir. */
  function renderList(response) {
    // Son sayfadaki kayitlar silindiginde sunucu bos liste dondurur (OFFSET
    // artik veri araliginin disinda). Bu durumda bos izgara gostermek yerine
    // gecerli son sayfaya cekilip yeniden yukluyoruz.
    if (response.items.length === 0 && response.total > 0 && response.page > response.totalPages) {
      state.page = response.totalPages;
      load();
      return;
    }

    clear(grid);
    clear(paginationHost);

    const hasActiveFilter =
      state.status !== '' ||
      state.mediaType !== '' ||
      state.genreId !== '' ||
      state.minRating !== '' ||
      state.favorite ||
      state.unrated ||
      state.search !== '';

    if (response.total === 0) {
      resultCount.textContent = '';

      grid.append(
        hasActiveFilter
          ? createEmptyState({
              icon: '\u{1F50D}',
              title: 'Bu filtrelerle kayıt bulunamadı',
              text: 'Filtreleri gevşetmeyi veya temizlemeyi deneyin.',
              action: el('button', {
                type: 'button',
                class: 'btn btn--primary',
                text: 'Filtreleri temizle',
                onclick: resetFilters,
              }),
            })
          : createEmptyState({
              icon: '\u{1F3AC}',
              title: 'Günlüğünüz henüz boş',
              text: 'Keşfet sekmesinden film veya dizi arayıp ilk kaydınızı oluşturun.',
              action: el('button', {
                type: 'button',
                class: 'btn btn--primary',
                text: 'İçerik keşfet',
                onclick: onNavigateDiscover,
              }),
            }),
      );
      return;
    }

    resultCount.textContent = `${response.total} kayıt \u00b7 sayfa ${response.page}/${response.totalPages}`;

    for (const entry of response.items) {
      grid.append(
        createEntryCard(entry, {
          onEdit: (selected) =>
            openEntryForm({
              mode: 'edit',
              source: selected,
              entry: selected,
              // Kaydetme/silme sonrasi liste ve kategori menusu tazelenir
              onSaved: () => {
                load();
                loadGenres();
              },
              onDeleted: () => {
                load();
                loadGenres();
              },
            }),
        }),
      );
    }

    if (response.totalPages > 1) paginationHost.append(buildPagination(response));
  }

  /** Onceki/sonraki sayfa denetimleri. */
  function buildPagination(response) {
    const previousButton = el('button', {
      type: 'button',
      class: 'btn',
      text: '\u2190 Önceki',
      disabled: response.page <= 1,
      onclick: () => {
        state.page -= 1;
        load();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
    });

    const nextButton = el('button', {
      type: 'button',
      class: 'btn',
      text: 'Sonraki \u2192',
      disabled: response.page >= response.totalPages,
      onclick: () => {
        state.page += 1;
        load();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
    });

    return el(
      'nav',
      { class: 'pagination', 'aria-label': 'Sayfalama' },
      previousButton,
      el('span', { class: 'pagination__info', text: `${response.page} / ${response.totalPages}` }),
      nextButton,
    );
  }

  // Ilk yukleme
  load();
  loadGenres();

  // Diger gorunumler (Kesfet) kayit ekledikten sonra tazeleyebilsin
  view.refresh = () => {
    load();
    loadGenres();
  };

  return view;
}

/** Etiketli acilir menu olusturur. */
function createSelect(label, options, onChange) {
  const select = el('select', { class: 'select', 'aria-label': label });
  for (const option of options) {
    select.append(el('option', { value: option.value, text: option.label }));
  }
  select.addEventListener('change', () => onChange(select.value));

  const wrapper = el('div', { class: 'filters__group' }, el('span', { text: label }), select);
  return { wrapper, select };
}

/** Puan filtresi secenekleri. */
function buildRatingOptions() {
  const options = [
    { value: '', label: 'Tüm puanlar' },
    { value: 'unrated', label: 'Puanlanmamış' },
  ];
  for (let threshold = 9; threshold >= 5; threshold -= 1) {
    options.push({ value: String(threshold), label: `${threshold}+ puan` });
  }
  return options;
}
