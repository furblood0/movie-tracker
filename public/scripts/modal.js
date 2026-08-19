/**
 * Modal (diyalog) yoneticisi.
 *
 * Erisilebilirlik ozellikleri:
 *  - `role="dialog"` + `aria-modal="true"` + baslikla iliskilendirme
 *  - Esc ile kapatma, arka plana tiklayarak kapatma
 *  - Odak tuzagi (focus trap): Tab tusu modalin dISINA cikamaz
 *  - Kapaninca odak, modali acan ogeye geri doner
 */

import { appendChildren, el } from './dom.js';

const modalRoot = document.querySelector('#modal-root');

/** Odaklanabilir ogeleri bulmak icin secici. */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let openCount = 0;

/**
 * Modal acar.
 * @param {{
 *   title: string,
 *   subtitle?: string,
 *   body: Node | Node[],
 *   footer?: Node | Node[],
 *   wide?: boolean,
 *   onClose?: () => void
 * }} options
 * @returns {{ close: () => void, element: HTMLElement }}
 */
export function openModal({ title, subtitle, body, footer, wide = false, onClose }) {
  const previouslyFocused = document.activeElement;
  const titleId = `modal-title-${Date.now().toString(36)}`;

  const closeButton = el('button', {
    type: 'button',
    class: 'btn btn--ghost btn--icon modal__close',
    'aria-label': 'Kapat',
    text: '\u2715',
  });

  const header = el(
    'div',
    { class: 'modal__header' },
    el(
      'div',
      {},
      el('h2', { class: 'modal__title', id: titleId, text: title }),
      subtitle ? el('p', { class: 'modal__subtitle', text: subtitle }) : null,
    ),
    closeButton,
  );

  const bodyElement = el('div', { class: 'modal__body' });
  appendChildren(bodyElement, [body]);

  const modal = el('div', {
    class: `modal${wide ? ' modal--wide' : ''}`,
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': titleId,
  });
  modal.append(header, bodyElement);

  if (footer) {
    const footerElement = el('div', { class: 'modal__footer' });
    appendChildren(footerElement, [footer]);
    modal.append(footerElement);
  }

  const overlay = el('div', { class: 'modal-overlay' }, modal);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;

    document.removeEventListener('keydown', onKeyDown, true);
    overlay.remove();

    openCount -= 1;
    // Son modal kapandiysa sayfa kaydirmasini geri ac
    if (openCount === 0) document.body.style.overflow = '';

    if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    onClose?.();
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }

    if (event.key !== 'Tab') return;

    // Odak tuzagi: Tab dongusunu modal icinde tut
    const focusable = [...modal.querySelectorAll(FOCUSABLE_SELECTOR)].filter(
      (element) => element.offsetParent !== null,
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable.at(-1);

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  closeButton.addEventListener('click', close);
  overlay.addEventListener('mousedown', (event) => {
    // Yalnizca arka plana (modalin disina) tiklandiysa kapat
    if (event.target === overlay) close();
  });
  document.addEventListener('keydown', onKeyDown, true);

  modalRoot.append(overlay);
  openCount += 1;
  document.body.style.overflow = 'hidden'; // arka planin kaymasini engelle

  // Ilk odaklanabilir ogeye odaklan (yoksa modalin kendisine)
  const firstField = modal.querySelector(FOCUSABLE_SELECTOR);
  (firstField ?? modal).focus?.();

  return { close, element: modal };
}

/**
 * Onay diyalogu.
 * @param {{ title: string, message: string, confirmLabel?: string, danger?: boolean }} options
 * @returns {Promise<boolean>} Kullanici onayladiysa true
 */
export function confirmDialog({ title, message, confirmLabel = 'Onayla', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const cancelButton = el('button', { type: 'button', class: 'btn', text: 'Vazgec' });
    const confirmButton = el('button', {
      type: 'button',
      class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`,
      text: confirmLabel,
    });

    const { close } = openModal({
      title,
      body: el('p', { text: message }),
      // Ilk oge sola yaslanir (CSS), bu yuzden once "Vazgec" koyuyoruz
      footer: [cancelButton, confirmButton],
      onClose: () => finish(false),
    });

    cancelButton.addEventListener('click', () => {
      finish(false);
      close();
    });
    confirmButton.addEventListener('click', () => {
      finish(true);
      close();
    });

    confirmButton.focus();
  });
}
