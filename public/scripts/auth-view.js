/**
 * Giris / kayit ekrani.
 *
 * Tek bir kart icinde iki sekme: "Giris yap" ve "Kayit ol".
 * Sunucudan gelen alan bazli hatalar (`details.field`) ilgili alanin altina
 * yazilir; genel hatalar kartin ustunde uyari olarak gosterilir.
 */

import { api, ApiError } from './api.js';
import { clear, el } from './dom.js';

/** Marka logosu (giris kartinin ustu). */
function brandMark() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('aria-hidden', 'true');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M16 4l3.4 7.2 7.8 1.1-5.7 5.5 1.4 7.8L16 21.9 9.1 25.6l1.4-7.8-5.7-5.5 7.8-1.1z');
  svg.append(path);

  return svg;
}

/**
 * Etiketli metin alani olusturur.
 * @returns {{ wrapper: HTMLElement, input: HTMLInputElement, error: HTMLElement }}
 */
function createField({ name, label, type = 'text', autocomplete, hint, required = true }) {
  const inputId = `field-${name}`;

  const input = el('input', {
    class: 'input',
    id: inputId,
    name,
    type,
    autocomplete,
    required,
  });

  const error = el('p', { class: 'field__error', 'aria-live': 'polite' });

  const wrapper = el(
    'div',
    { class: 'field' },
    el('label', { class: 'field__label', for: inputId, text: label }),
    input,
    hint ? el('p', { class: 'field__hint', text: hint }) : null,
    error,
  );

  return { wrapper, input, error };
}

/**
 * Kimlik dogrulama ekranini olusturur.
 * @param {{ onAuthenticated: (user: object) => void }} options
 * @returns {HTMLElement}
 */
export function createAuthView({ onAuthenticated }) {
  /** @type {'login' | 'register'} */
  let mode = 'login';

  const alertBox = el('div', { class: 'form-alert', role: 'alert', hidden: true });
  const formHost = el('div');

  const loginTab = el('button', { type: 'button', class: 'auth__tab is-active', text: 'Giris yap' });
  const registerTab = el('button', { type: 'button', class: 'auth__tab', text: 'Kayit ol' });

  loginTab.addEventListener('click', () => switchMode('login'));
  registerTab.addEventListener('click', () => switchMode('register'));

  function switchMode(nextMode) {
    if (mode === nextMode) return;
    mode = nextMode;

    loginTab.classList.toggle('is-active', mode === 'login');
    registerTab.classList.toggle('is-active', mode === 'register');
    hideAlert();
    renderForm();
  }

  function showAlert(message) {
    alertBox.textContent = message;
    alertBox.hidden = false;
  }

  function hideAlert() {
    alertBox.hidden = true;
    alertBox.textContent = '';
  }

  /** Aktif moda gore formu yeniden cizer. */
  function renderForm() {
    clear(formHost);

    const isRegister = mode === 'register';

    const username = createField({
      name: 'username',
      label: 'Kullanici adi',
      autocomplete: 'username',
      hint: isRegister ? '3-32 karakter; harf, rakam, nokta, alt tire ve tire' : undefined,
    });

    const password = createField({
      name: 'password',
      label: 'Sifre',
      type: 'password',
      autocomplete: isRegister ? 'new-password' : 'current-password',
      hint: isRegister ? 'En az 8 karakter' : undefined,
    });

    const email = isRegister
      ? createField({
          name: 'email',
          label: 'E-posta (istege bagli)',
          type: 'email',
          autocomplete: 'email',
          required: false,
        })
      : null;

    const submitButton = el('button', {
      type: 'submit',
      class: 'btn btn--primary btn--block',
      text: isRegister ? 'Hesap olustur' : 'Giris yap',
    });

    const fields = [username, password, email].filter(Boolean);

    const form = el(
      'form',
      { class: 'auth__form', novalidate: true },
      ...fields.map((field) => field.wrapper),
      submitButton,
    );

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      hideAlert();

      // Onceki hata isaretlerini temizle
      for (const field of fields) {
        field.error.textContent = '';
        field.input.removeAttribute('aria-invalid');
      }

      const payload = {
        username: username.input.value.trim(),
        password: password.input.value,
      };
      if (email && email.input.value.trim() !== '') payload.email = email.input.value.trim();

      setLoading(submitButton, true);
      try {
        const result = isRegister ? await api.register(payload) : await api.login(payload);
        onAuthenticated(result.user);
      } catch (error) {
        setLoading(submitButton, false);

        if (!(error instanceof ApiError)) {
          showAlert('Beklenmeyen bir hata olustu.');
          return;
        }

        // Alan bazli hata varsa ilgili alanin altina yaz
        const targetField = fields.find((field) => field.input.name === error.field);
        if (targetField) {
          targetField.error.textContent = error.message;
          targetField.input.setAttribute('aria-invalid', 'true');
          targetField.input.focus();
        } else {
          showAlert(error.message);
        }
      }
    });

    formHost.append(form);
    username.input.focus();
  }

  const card = el(
    'div',
    { class: 'auth__card' },
    el('div', { class: 'auth__brand' }, brandMark(), el('span', { text: 'Movie Tracker' })),
    el('p', {
      class: 'auth__tagline',
      text: 'Izlediklerinizi puanlayin, izleyeceklerinizi unutmayin.',
    }),
    el('div', { class: 'auth__tabs', role: 'tablist' }, loginTab, registerTab),
    alertBox,
    formHost,
  );

  renderForm();

  return el('div', { class: 'auth' }, card);
}

/** Dugmeyi yukleniyor durumuna alir/cikarir. */
export function setLoading(button, isLoading) {
  if (isLoading) {
    button.disabled = true;
    button.dataset.label = button.textContent;
    clear(button);
    button.append(el('span', { class: 'btn__spinner', 'aria-hidden': 'true' }), 'Lutfen bekleyin');
  } else {
    button.disabled = false;
    button.textContent = button.dataset.label ?? button.textContent;
  }
}
