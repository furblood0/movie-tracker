/**
 * Uygulama onyukleyicisi.
 *
 * Sorumluluklari:
 *  - Acilista oturumu sorgular (/api/auth/me) ve dogru ekrani gosterir
 *  - Gorunumler arasi gecis (Gunlugum <-> Kesfet)
 *  - Ust bardaki kullanici menusu: sifre degistirme, cikis
 *
 * Tek sayfa uygulamasi mantigi: sayfa yenilenmez, #view icerigi degistirilir.
 */

import { api, ApiError, setUnauthorizedHandler } from './api.js';
import { createAuthView, setLoading } from './auth-view.js';
import { clear, el } from './dom.js';
import { createDiscoverView } from './discover-view.js';
import { createLibraryView } from './library-view.js';
import { openModal } from './modal.js';
import { showApiError, showToast } from './toast.js';

const appBar = document.querySelector('#app-bar');
const viewHost = document.querySelector('#view');
const userMenuHost = document.querySelector('#user-menu');
const navButtons = [...document.querySelectorAll('[data-nav]')];

/** @type {{ user: object | null, route: 'library' | 'discover', libraryView: HTMLElement | null }} */
const state = { user: null, route: 'library', libraryView: null };

// ---------------------------------------------------------------------
// Gorunum yonetimi
// ---------------------------------------------------------------------

/**
 * Gunluk gorunumunu dondurur.
 * Gorunum bir kez olusturulur ve sonraki gecislerde yeniden kullanilir;
 * boylece filtre secimleri sekme degistirince kaybolmaz.
 * @returns {{ element: HTMLElement, isNew: boolean }}
 */
function getLibraryView() {
  if (state.libraryView) return { element: state.libraryView, isNew: false };

  state.libraryView = createLibraryView({
    onNavigateDiscover: () => navigate('discover'),
  });
  return { element: state.libraryView, isNew: true };
}

/**
 * Gorunum degistirir.
 * @param {'library' | 'discover'} route
 */
function navigate(route) {
  state.route = route;

  // Yalnizca sekme dugmeleri isaretlenir (marka baglantisi da data-nav tasir).
  for (const button of navButtons) {
    if (!button.classList.contains('app-nav__link')) continue;
    button.classList.toggle('is-active', button.dataset.nav === route);
  }

  clear(viewHost);

  if (route === 'discover') {
    viewHost.append(
      createDiscoverView({
        // Kesfet'ten kayit eklendiginde gunluk listesi bayat kalmasin
        onEntrySaved: () => state.libraryView?.refresh?.(),
      }),
    );
  } else {
    const { element, isNew } = getLibraryView();
    // Yeni olusturulan gorunum kendi ilk yuklemesini yapar; tekrar istek atmayalim.
    if (!isNew) element.refresh?.();
    viewHost.append(element);
  }

  viewHost.focus();
}

// ---------------------------------------------------------------------
// Kullanici menusu
// ---------------------------------------------------------------------
function renderUserMenu(user) {
  clear(userMenuHost);

  const initials = (user.displayName ?? user.username).slice(0, 1).toUpperCase();

  const passwordButton = el('button', {
    type: 'button',
    class: 'btn btn--ghost',
    text: 'Sifre',
    title: 'Sifre degistir',
    onclick: openPasswordModal,
  });

  const logoutButton = el('button', {
    type: 'button',
    class: 'btn',
    text: 'Cikis',
    onclick: async () => {
      try {
        await api.logout();
      } catch {
        // Cikis istegi basarisiz olsa da yerel durumu temizliyoruz:
        // kullanicinin ekranda takili kalmasi daha kotu bir deneyim olurdu.
      }
      showToast('Cikis yapildi.', 'success');
      showAuthScreen();
    },
  });

  userMenuHost.append(
    el('span', { class: 'avatar', 'aria-hidden': 'true', text: initials }),
    el('span', { class: 'user-menu__name', title: user.username, text: user.displayName ?? user.username }),
    passwordButton,
    logoutButton,
  );
}

/** Sifre degistirme modali. */
function openPasswordModal() {
  const currentInput = el('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
  const newInput = el('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const errorBox = el('div', { class: 'form-alert', role: 'alert', hidden: true });

  const cancelButton = el('button', { type: 'button', class: 'btn', text: 'Vazgec' });
  const saveButton = el('button', { type: 'button', class: 'btn btn--primary', text: 'Sifreyi degistir' });

  const { close } = openModal({
    title: 'Sifre degistir',
    subtitle: 'Degisiklikten sonra diger cihazlardaki oturumlar kapatilir.',
    body: [
      errorBox,
      el(
        'div',
        { class: 'field' },
        el('span', { class: 'field__label', text: 'Mevcut sifre' }),
        currentInput,
      ),
      el(
        'div',
        { class: 'field' },
        el('span', { class: 'field__label', text: 'Yeni sifre' }),
        newInput,
        el('p', { class: 'field__hint', text: 'En az 8 karakter' }),
      ),
    ],
    footer: [el('span'), cancelButton, saveButton],
  });

  cancelButton.addEventListener('click', close);

  saveButton.addEventListener('click', async () => {
    errorBox.hidden = true;
    setLoading(saveButton, true);

    try {
      await api.changePassword({
        currentPassword: currentInput.value,
        newPassword: newInput.value,
      });
      showToast('Sifreniz guncellendi.', 'success');
      close();
    } catch (error) {
      setLoading(saveButton, false);
      errorBox.textContent = error instanceof ApiError ? error.message : 'Beklenmeyen bir hata olustu.';
      errorBox.hidden = false;
    }
  });
}

// ---------------------------------------------------------------------
// Ekran gecisleri
// ---------------------------------------------------------------------

/** Giris/kayit ekranini gosterir. */
function showAuthScreen() {
  state.user = null;
  state.libraryView = null; // eski kullanicinin verisi bellekte kalmasin
  appBar.hidden = true;

  clear(viewHost);
  viewHost.append(createAuthView({ onAuthenticated: showAppScreen }));
}

/** Oturum acilmis kullaniciya uygulamayi gosterir. */
function showAppScreen(user) {
  state.user = user;
  appBar.hidden = false;
  renderUserMenu(user);
  navigate('library');
}

// Oturum kullanim sirasinda dusenerse (suresi doldu veya baska cihazdan
// sifre degistirildi) kullaniciyi giris ekranina dondur.
setUnauthorizedHandler(() => {
  if (!state.user) return; // zaten giris ekranindayiz
  showToast('Oturumunuz sona erdi. Lutfen tekrar giris yapin.', 'warning', 6000);
  showAuthScreen();
});

// Ust bardaki gezinme dugmeleri
for (const button of navButtons) {
  button.addEventListener('click', (event) => {
    event.preventDefault();
    navigate(/** @type {'library' | 'discover'} */ (button.dataset.nav));
  });
}

// ---------------------------------------------------------------------
// Acilis
// ---------------------------------------------------------------------
try {
  const { user } = await api.me();
  if (user) showAppScreen(user);
  else showAuthScreen();
} catch (error) {
  // Sunucuya ulasilamiyorsa kullaniciyi bilgilendirip giris ekranini goster
  showApiError(error);
  showAuthScreen();
}
