/**
 * Giris / kayit ekrani.
 *
 * Istenenler bilincli olarak az:
 *   Giris: kullanici adi + sifre
 *   Kayit: kullanici adi + sifre
 *   Davet kodu yalnizca sunucu invite modundaysa
 * E-posta sorulmaz; gonderilecek bir posta yok ve alan kaydi uzatir.
 *
 * Sekme yok. /giris ve /kayit ayri adresler; alttaki baglanti digerine gecer.
 */

import { api, ApiError } from './api.js';
import { clear, el } from './dom.js';

/**
 * Etiketli metin alani.
 * @returns {{ wrapper: HTMLElement, input: HTMLInputElement, error: HTMLElement }}
 */
function createField({ name, label, type = 'text', autocomplete, hint, required = true, reveal = false }) {
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

  let control = input;
  if (reveal) {
    const toggle = el('button', {
      type: 'button',
      class: 'field__reveal',
      text: 'Göster',
      'aria-label': 'Şifreyi göster',
    });
    toggle.addEventListener('click', () => {
      const visible = input.type === 'text';
      input.type = visible ? 'password' : 'text';
      toggle.textContent = visible ? 'Göster' : 'Gizle';
      toggle.setAttribute('aria-label', visible ? 'Şifreyi göster' : 'Şifreyi gizle');
    });
    control = el('div', { class: 'field__control' }, input, toggle);
  }

  const wrapper = el(
    'div',
    { class: 'field' },
    el('label', { class: 'field__label', for: inputId, text: label }),
    control,
    hint ? el('p', { class: 'field__hint', text: hint }) : null,
    error,
  );

  return { wrapper, input, error };
}

/**
 * Kimlik dogrulama ekranini olusturur.
 * @param {{
 *   onAuthenticated: (user: object) => void,
 *   registrationMode?: 'open' | 'invite' | 'closed',
 *   initialMode?: 'login' | 'register'
 * }} options
 * @returns {HTMLElement}
 */
export function createAuthView({ onAuthenticated, registrationMode = 'open', initialMode = 'login' }) {
  const canRegister = registrationMode !== 'closed';
  const needsInviteCode = registrationMode === 'invite';
  const isRegister = canRegister && initialMode === 'register';

  const alertBox = el('div', { class: 'form-alert', role: 'alert', hidden: true });

  const username = createField({
    name: 'username',
    label: 'Kullanıcı adı',
    autocomplete: 'username',
  });

  const password = createField({
    name: 'password',
    label: 'Şifre',
    type: 'password',
    autocomplete: isRegister ? 'new-password' : 'current-password',
    reveal: true,
  });

  const inviteCode =
    isRegister && needsInviteCode
      ? createField({
          name: 'inviteCode',
          label: 'Davet kodu',
          autocomplete: 'off',
          hint: 'Kodu site sahibinden alın.',
        })
      : null;

  const submitButton = el('button', {
    type: 'submit',
    class: 'btn btn--primary btn--block',
    text: isRegister ? 'Günlüğe başla' : 'Giriş yap',
  });

  const fields = [username, password, inviteCode].filter(Boolean);

  const form = el(
    'form',
    { class: 'auth__form', novalidate: true },
    ...fields.map((field) => field.wrapper),
    isRegister
      ? el('p', { class: 'field__hint', text: 'Kullanıcı adı 3–32 karakter. Şifre en az 8 karakter ve kullanıcı adından farklı.' })
      : null,
    submitButton,
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    alertBox.hidden = true;
    alertBox.textContent = '';

    for (const field of fields) {
      field.error.textContent = '';
      field.input.removeAttribute('aria-invalid');
    }

    const payload = {
      username: username.input.value.trim(),
      password: password.input.value,
    };
    if (inviteCode) payload.inviteCode = inviteCode.input.value.trim();

    setLoading(submitButton, true);
    try {
      const result = isRegister ? await api.register(payload) : await api.login(payload);
      onAuthenticated(result.user);
    } catch (error) {
      setLoading(submitButton, false);

      if (!(error instanceof ApiError)) {
        alertBox.textContent = 'Beklenmeyen bir hata oluştu.';
        alertBox.hidden = false;
        return;
      }

      const targetField = fields.find((field) => field.input.name === error.field);
      if (targetField) {
        targetField.error.textContent = error.message;
        targetField.input.setAttribute('aria-invalid', 'true');
        targetField.input.focus();
      } else {
        alertBox.textContent = error.message;
        alertBox.hidden = false;
      }
    }
  });

  const switchLink = isRegister
    ? el('p', { class: 'auth__switch' }, 'Zaten bir defterin var mı? ', el('a', { href: '/giris', text: 'Giriş yap' }))
    : canRegister
      ? el('p', { class: 'auth__switch' }, 'Defterin yok mu? ', el('a', { href: '/kayit', text: 'Kayıt ol' }))
      : el('p', { class: 'auth__note', text: 'Yeni kayıtlar şu anda kapalı.' });

  const panel = el(
    'section',
    { class: 'auth__panel' },
    el('h2', { class: 'auth__heading', text: isRegister ? 'Günlüğe başla' : 'Giriş yap' }),
    el('p', {
      class: 'auth__sub',
      text: isRegister ? 'Kullanıcı adı ve şifre. Günlük hemen senin.' : 'Kaldığın yerden devam et.',
    }),
    alertBox,
    form,
    switchLink,
  );

  const aside = el(
    'aside',
    { class: 'auth__aside' },
    el('p', { class: 'page-head__eyebrow label-mono', text: 'Kişisel sinema defteri' }),
    el('h1', { class: 'auth__title', text: 'İzlediğin her şey, tek defterde.' }),
    el('p', {
      class: 'auth__lead',
      text: 'Puanla, kısa bir not düş, izleyeceklerini kaybetme. Hesap için kullanıcı adı ve şifre yeter.',
    }),
  );

  if (window.matchMedia('(min-width: 721px)').matches) username.input.focus();

  return el('div', { class: 'auth' }, aside, panel);
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
