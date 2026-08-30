/**
 * Giris / kayit ekrani.
 *
 * Tek bir kart icinde iki sekme: "Giris yap" ve "Kayit ol".
 * Sunucudan gelen alan bazli hatalar (`details.field`) ilgili alanin altina
 * yazilir; genel hatalar kartin ustunde uyari olarak gosterilir.
 */

import { api, ApiError } from './api.js';
import { clear, el } from './dom.js';

/** Marka logosu (giris kartinin ustu): bilet kocani. */
function brandMark() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('aria-hidden', 'true');

  const body = document.createElementNS(ns, 'path');
  body.setAttribute(
    'd',
    'M5 7h22a2 2 0 0 1 2 2v3.2a3.8 3.8 0 0 0 0 7.6V23a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3.2a3.8 3.8 0 0 0 0-7.6V9a2 2 0 0 1 2-2Z',
  );

  const perforation = document.createElementNS(ns, 'path');
  perforation.setAttribute('class', 'brand__mark-perf');
  perforation.setAttribute('d', 'M21.5 10.5v11');

  svg.append(body, perforation);
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

  const loginTab = el('button', { type: 'button', class: 'auth__tab is-active', text: 'Giriş yap' });
  const registerTab = el('button', { type: 'button', class: 'auth__tab', text: 'Kayıt ol' });

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
      label: 'Kullanıcı adı',
      autocomplete: 'username',
      hint: isRegister ? '3-32 karakter; harf, rakam, nokta, alt tire ve tire' : undefined,
    });

    const password = createField({
      name: 'password',
      label: 'Şifre',
      type: 'password',
      autocomplete: isRegister ? 'new-password' : 'current-password',
      hint: isRegister ? 'En az 8 karakter' : undefined,
    });

    const email = isRegister
      ? createField({
          name: 'email',
          label: 'E-posta (isteğe bağlı)',
          type: 'email',
          autocomplete: 'email',
          required: false,
        })
      : null;

    const submitButton = el('button', {
      type: 'submit',
      class: 'btn btn--primary btn--block',
      text: isRegister ? 'Hesap oluştur' : 'Giriş yap',
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
          showAlert('Beklenmeyen bir hata oluştu.');
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
      text: 'İzlediklerinizi puanlayın, izleyeceklerinizi unutmayın.',
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
    button.append(el('span', { class: 'btn__spinner', 'aria-hidden': 'true' }), 'Lütfen bekleyin');
  } else {
    button.disabled = false;
    button.textContent = button.dataset.label ?? button.textContent;
  }
}
