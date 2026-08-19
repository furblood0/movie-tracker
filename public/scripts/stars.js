/**
 * Yildiz puanlama bilesenleri.
 *
 *  - `renderStars(value)`      : salt okunur gosterim (kartlarda)
 *  - `createRatingInput(...)`  : etkilesimli 10 yildiz, yarim yildiz adimlariyla
 *
 * Yarim yildiz nasil calisiyor?
 *  Her yildiz iki seffaf dugmeye bolunur: sol yari X.5, sag yari X.0 verir.
 *  Fare ile ustunde gezinildiginde onizleme gosterilir, tiklaninca puan sabitlenir.
 */

import { el, formatRating } from './dom.js';

const STAR_COUNT = 10;
const STAR_GLYPH = '\u2605'; // dolu yildiz karakteri
const MAX_RATING = 10;
const STEP = 0.5;

/**
 * Salt okunur yildiz gosterimi.
 * Gri yildiz seridinin uzerine altin serit bindirilir; altin seridin genisligi
 * puan yuzdesine gore ayarlandigi icin yarim yildizlar dogru gorunur.
 *
 * @param {number | null} value 0-10 arasi puan
 * @param {{ small?: boolean }} [options]
 */
export function renderStars(value, options = {}) {
  const safeValue = typeof value === 'number' ? Math.min(Math.max(value, 0), MAX_RATING) : 0;
  const fillPercent = (safeValue / MAX_RATING) * 100;
  const glyphs = STAR_GLYPH.repeat(STAR_COUNT);

  return el(
    'span',
    {
      class: `stars${options.small ? ' stars--sm' : ''}`,
      role: 'img',
      'aria-label': value ? `${formatRating(value)} / 10 puan` : 'Puanlanmamis',
      style: { '--stars-fill': `${fillPercent}%` },
    },
    el('span', { class: 'stars__base', 'aria-hidden': 'true', text: glyphs }),
    el('span', { class: 'stars__fill', 'aria-hidden': 'true', text: glyphs }),
  );
}

/**
 * Etkilesimli puanlama alani.
 *
 * @param {{ value?: number | null, onChange?: (value: number | null) => void }} [options]
 * @returns {{ element: HTMLElement, getValue: () => number | null, setValue: (value: number | null) => void }}
 */
export function createRatingInput({ value = null, onChange } = {}) {
  let currentValue = normalize(value);

  const valueLabel = el('span', { class: 'rating__value' });
  const clearButton = el('button', {
    type: 'button',
    class: 'btn btn--ghost',
    text: 'Temizle',
    'aria-label': 'Puani temizle',
  });

  const starsWrapper = el('div', {
    class: 'rating__stars',
    role: 'slider',
    tabindex: '0',
    'aria-label': 'Puan (1-10, yarim yildiz adimlariyla)',
    'aria-valuemin': '0',
    'aria-valuemax': String(MAX_RATING),
  });

  /** @type {HTMLElement[]} */
  const starElements = [];

  for (let index = 0; index < STAR_COUNT; index += 1) {
    const fullValue = index + 1;
    const halfValue = fullValue - STEP;

    const glyph = el('span', { class: 'rating__glyph', 'aria-hidden': 'true', text: STAR_GLYPH });

    // Tab ile 20 dugme dolasmak yorucu olur: dugmeler tabindex="-1",
    // klavye ile puanlama ok tuslariyla kapsayici uzerinden yapilir.
    const leftHalf = el('button', {
      type: 'button',
      class: 'rating__half rating__half--left',
      tabindex: '-1',
      'aria-label': `${formatRating(halfValue)} puan ver`,
      onclick: () => commit(halfValue),
      onmouseenter: () => paint(halfValue),
    });

    const rightHalf = el('button', {
      type: 'button',
      class: 'rating__half rating__half--right',
      tabindex: '-1',
      'aria-label': `${fullValue} puan ver`,
      onclick: () => commit(fullValue),
      onmouseenter: () => paint(fullValue),
    });

    const star = el('span', { class: 'rating__star' }, leftHalf, rightHalf, glyph);
    starElements.push(star);
    starsWrapper.append(star);
  }

  // Fare alandan cikinca gercek puana geri don
  starsWrapper.addEventListener('mouseleave', () => paint(currentValue));

  // Klavye ile puanlama
  starsWrapper.addEventListener('keydown', (event) => {
    const keyActions = {
      ArrowRight: () => commit(Math.min((currentValue ?? 0) + STEP, MAX_RATING)),
      ArrowUp: () => commit(Math.min((currentValue ?? 0) + STEP, MAX_RATING)),
      ArrowLeft: () => stepDown(),
      ArrowDown: () => stepDown(),
      Home: () => commit(1),
      End: () => commit(MAX_RATING),
      Delete: () => commit(null),
      Backspace: () => commit(null),
    };

    const action = keyActions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  });

  /** Bir adim asagi: 1'in altina inince puan temizlenir. */
  function stepDown() {
    if (currentValue === null) return;
    const next = currentValue - STEP;
    commit(next < 1 ? null : next);
  }

  clearButton.addEventListener('click', () => commit(null));

  /** Yildizlari verilen degere gore boyar (onizleme veya gercek deger). */
  function paint(previewValue) {
    const displayValue = previewValue ?? 0;

    starElements.forEach((star, index) => {
      const fullThreshold = index + 1;
      star.classList.toggle('is-full', displayValue >= fullThreshold);
      star.classList.toggle('is-half', displayValue >= fullThreshold - STEP && displayValue < fullThreshold);
    });

    const hasValue = previewValue !== null && previewValue !== undefined;
    valueLabel.textContent = hasValue ? `${formatRating(previewValue)}/10` : 'Puanlanmadi';
    valueLabel.classList.toggle('rating__value--empty', !hasValue);
  }

  /** Puani sabitler ve degisikligi bildirir. */
  function commit(newValue) {
    currentValue = normalize(newValue);
    starsWrapper.setAttribute('aria-valuenow', String(currentValue ?? 0));
    starsWrapper.setAttribute(
      'aria-valuetext',
      currentValue === null ? 'Puanlanmadi' : `${formatRating(currentValue)} / 10`,
    );
    paint(currentValue);
    onChange?.(currentValue);
  }

  const element = el('div', { class: 'rating' }, starsWrapper, valueLabel, clearButton);

  commit(currentValue); // baslangic durumunu ciz

  return {
    element,
    getValue: () => currentValue,
    setValue: (newValue) => commit(newValue),
  };
}

/** Puani gecerli araliga ve 0.5 adimina oturtur. */
function normalize(value) {
  if (value === null || value === undefined || value === '') return null;

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;

  const rounded = Math.round(numeric / STEP) * STEP;
  return Math.min(Math.max(rounded, 1), MAX_RATING);
}
