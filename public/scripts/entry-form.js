/**
 * Gunluge ekleme / kayit duzenleme formu (modal icinde).
 *
 * Ayni bilesen iki senaryoda kullanilir:
 *  - "create": Kesfet ekranindan gelen TMDb sonucu gunluge eklenir.
 *  - "edit"  : Mevcut gunluk kaydi duzenlenir.
 *
 * Boylece durum/puan/not alanlari tek yerde tanimli kalir.
 */

import { api, ApiError } from './api.js';
import { setLoading } from './auth-view.js';
import { MEDIA_TYPE_LABELS, STATUS_LABELS, el } from './dom.js';
import { confirmDialog, openModal } from './modal.js';
import { createRatingInput } from './stars.js';
import { showApiError, showToast } from './toast.js';

const STATUS_ORDER = ['watchlist', 'watched', 'dropped'];

/**
 * Kullanicinin YEREL tarihi (YYYY-MM-DD) - tarih alaninin ust siniri.
 *
 * `toISOString()` UTC dondurdugu icin burada kullanilamaz: UTC+3'te gece
 * 01:00'de UTC tarihi bir gun geride kalir ve kullanici "bugun"u secemez.
 */
function today() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Icerik onizlemesi: afis + baslik + ozet. */
function buildPreview(source) {
  const poster = source.posterUrl
    ? el('img', {
        src: source.posterUrl,
        alt: `${source.title} afisi`,
        loading: 'lazy',
        decoding: 'async',
      })
    : el('div', { class: 'card__poster-fallback', text: source.title.slice(0, 1).toUpperCase() });

  const metaParts = [
    MEDIA_TYPE_LABELS[source.mediaType] ?? source.mediaType,
    source.releaseYear ? String(source.releaseYear) : null,
    source.genres?.length ? source.genres.map((genre) => genre.name).join(', ') : null,
  ].filter(Boolean);

  return el(
    'div',
    { class: 'entry-preview' },
    el('div', { class: 'entry-preview__poster' }, poster),
    el(
      'div',
      {},
      el('h3', { class: 'entry-preview__title', text: source.title }),
      el('p', { class: 'entry-preview__meta', text: metaParts.join(' \u00b7 ') }),
      source.overview ? el('p', { class: 'entry-preview__overview', text: source.overview }) : null,
    ),
  );
}

/** Durum secici (segmentli radyo grubu). */
function buildStatusSelector(currentStatus) {
  const groupName = `status-${Date.now().toString(36)}`;

  const options = STATUS_ORDER.map((status) => {
    const inputId = `${groupName}-${status}`;
    const input = el('input', {
      type: 'radio',
      name: groupName,
      id: inputId,
      value: status,
      checked: status === currentStatus,
    });

    return el(
      'div',
      { class: 'segmented__option' },
      input,
      el('label', { class: 'segmented__label', for: inputId, text: STATUS_LABELS[status] }),
    );
  });

  const wrapper = el('div', { class: 'segmented' }, ...options);

  return {
    element: wrapper,
    getValue: () => wrapper.querySelector('input:checked')?.value ?? 'watchlist',
    onChange: (handler) => wrapper.addEventListener('change', handler),
  };
}

/**
 * Ekleme/duzenleme modalini acar.
 *
 * @param {{
 *   mode: 'create' | 'edit',
 *   source: { tmdbId: number, mediaType: 'movie' | 'tv', title: string, originalTitle?: string | null,
 *             overview?: string | null, posterPath?: string | null, posterUrl?: string | null,
 *             releaseYear?: number | null, genres?: { id: number, name: string }[] },
 *   entry?: object,
 *   onSaved?: (entry: object) => void,
 *   onDeleted?: (entryId: number) => void
 * }} options
 */
export function openEntryForm({ mode, source, entry, onSaved, onDeleted }) {
  const isEdit = mode === 'edit';
  const initial = isEdit ? entry : {};

  // --- Alanlar ---
  const status = buildStatusSelector(initial.status ?? 'watchlist');

  const rating = createRatingInput({ value: initial.rating ?? null });

  const watchedAtInput = el('input', {
    class: 'input',
    type: 'date',
    id: 'entry-watched-at',
    max: today(), // gelecek tarih secilemez (sunucu da reddeder)
    value: initial.watchedAt ?? '',
  });

  const reviewInput = el('textarea', {
    class: 'textarea',
    id: 'entry-review',
    maxlength: '5000',
    placeholder: 'Bu yapim hakkinda notunuz... (istege bagli)',
  });
  reviewInput.value = initial.review ?? '';

  const favoriteInput = el('input', { type: 'checkbox', checked: Boolean(initial.favorite) });

  const errorBox = el('div', { class: 'form-alert', role: 'alert', hidden: true });

  const watchedAtField = el(
    'div',
    { class: 'field' },
    el('label', { class: 'field__label', for: 'entry-watched-at', text: 'Izleme tarihi' }),
    watchedAtInput,
  );

  // "Izlenecek" durumundayken izleme tarihi anlamsiz: alani gizle.
  function syncWatchedAtVisibility() {
    watchedAtField.hidden = status.getValue() === 'watchlist';
  }
  status.onChange(syncWatchedAtVisibility);
  syncWatchedAtVisibility();

  const body = [
    errorBox,
    buildPreview({ ...source, posterUrl: source.posterUrl ?? entry?.posterUrl ?? null }),
    el(
      'div',
      { class: 'field' },
      el('span', { class: 'field__label', text: 'Durum' }),
      status.element,
    ),
    el('div', { class: 'field' }, el('span', { class: 'field__label', text: 'Puan' }), rating.element),
    watchedAtField,
    el(
      'div',
      { class: 'field' },
      el('label', { class: 'field__label', for: 'entry-review', text: 'Notunuz' }),
      reviewInput,
    ),
    el(
      'label',
      { class: 'checkbox' },
      favoriteInput,
      el('span', { text: 'Favorilerime ekle' }),
    ),
  ];

  // --- Dugmeler ---
  const deleteButton = isEdit
    ? el('button', { type: 'button', class: 'btn btn--danger', text: 'Sil' })
    : el('span'); // hizalamayi korumak icin bos yer tutucu

  const cancelButton = el('button', { type: 'button', class: 'btn', text: 'Vazgec' });
  const saveButton = el('button', {
    type: 'button',
    class: 'btn btn--primary',
    text: isEdit ? 'Degisiklikleri kaydet' : 'Gunluge ekle',
  });

  const { close } = openModal({
    title: isEdit ? 'Kaydi duzenle' : 'Gunluge ekle',
    subtitle: source.title,
    body,
    footer: [deleteButton, cancelButton, saveButton],
  });

  cancelButton.addEventListener('click', close);

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  /** Formdaki degerleri API sozlesmesine cevirir. */
  function collectValues() {
    const selectedStatus = status.getValue();
    return {
      status: selectedStatus,
      rating: rating.getValue(),
      review: reviewInput.value.trim() === '' ? null : reviewInput.value.trim(),
      // Izlenecek listesindeki kayitlarda izleme tarihi tutulmaz
      watchedAt: selectedStatus === 'watchlist' ? null : watchedAtInput.value || null,
      favorite: favoriteInput.checked,
    };
  }

  saveButton.addEventListener('click', async () => {
    errorBox.hidden = true;

    const values = collectValues();

    // Sunucu da ayni kurali uygular; burada onceden kontrol edip gereksiz
    // istegi ve bekleme suresini kullaniciya yasatmiyoruz.
    if (values.watchedAt && values.watchedAt > today()) {
      showError('Izleme tarihi gelecekte olamaz.');
      watchedAtInput.focus();
      return;
    }

    setLoading(saveButton, true);

    try {
      if (isEdit) {
        const result = await api.updateEntry(entry.id, values);
        showToast('Kayit guncellendi.', 'success');
        onSaved?.(result.entry);
      } else {
        const result = await api.createEntry({
          tmdbId: source.tmdbId,
          mediaType: source.mediaType,
          title: source.title,
          originalTitle: source.originalTitle ?? null,
          overview: source.overview ?? null,
          posterPath: source.posterPath ?? null,
          releaseYear: source.releaseYear ?? null,
          genres: source.genres ?? [],
          ...values,
        });
        showToast(`"${source.title}" gunluge eklendi.`, 'success');
        onSaved?.(result.entry);
      }
      close();
    } catch (error) {
      setLoading(saveButton, false);

      // Ayni icerik zaten kayitliysa sunucu 409 + mevcut kayit kimligi doner:
      // kullaniciyi dogrudan duzenleme formuna gecirmeyi teklif ediyoruz.
      if (error instanceof ApiError && error.status === 409 && error.details?.existingEntryId) {
        close();
        await offerEditExisting(error.details.existingEntryId, source, onSaved, onDeleted);
        return;
      }

      if (error instanceof ApiError) showError(error.message);
      else showApiError(error);
    }
  });

  if (isEdit) {
    deleteButton.addEventListener('click', async () => {
      const confirmed = await confirmDialog({
        title: 'Kaydi sil',
        message: `"${entry.title}" gunlugunuzden kaldirilacak. Bu islem geri alinamaz.`,
        confirmLabel: 'Sil',
        danger: true,
      });
      if (!confirmed) return;

      try {
        await api.deleteEntry(entry.id);
        showToast('Kayit silindi.', 'success');
        close();
        onDeleted?.(entry.id);
      } catch (error) {
        showApiError(error);
      }
    });
  }
}

/**
 * Zaten kayitli bir icerik tekrar eklenmek istendiginde calisir:
 * kullaniciya mevcut kaydi duzenlemeyi teklif eder.
 */
async function offerEditExisting(entryId, source, onSaved, onDeleted) {
  const confirmed = await confirmDialog({
    title: 'Bu icerik zaten gunlugunuzde',
    message: `"${source.title}" listenizde kayitli. Mevcut kaydi duzenlemek ister misiniz?`,
    confirmLabel: 'Duzenle',
  });
  if (!confirmed) return;

  try {
    const { entry } = await api.getEntry(entryId);
    openEntryForm({ mode: 'edit', source: entry, entry, onSaved, onDeleted });
  } catch (error) {
    showApiError(error);
  }
}
