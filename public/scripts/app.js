/**
 * Uygulama onyukleyicisi.
 *
 * Sorumluluklari:
 *  - Acilista oturumu sorgular (/api/auth/me) ve adrese gore ekrani cizer
 *  - Adres cubugu gecisleri (History API): /giris, /gunluk, /kesfet, /ozet, ...
 *  - Ust bardaki kullanici menusu: sifre degistirme, hesap silme, cikis
 *
 * Sayfa yenilenmez. Gercek href'ler durur; sade sol tiklamada gecis JS ile olur,
 * boylece yeni sekmede acmak da calisir.
 */

import { api, ApiError, setUnauthorizedHandler } from './api.js';
import { createAuthView, setLoading } from './auth-view.js';
import { clear, el } from './dom.js';
import { createDiscoverView } from './discover-view.js';
import { createLandingView } from './landing-view.js';
import { createLegalView } from './legal-view.js';
import { createLibraryView } from './library-view.js';
import { openModal } from './modal.js';
import { createStatsView } from './stats-view.js';
import { showApiError, showToast } from './toast.js';

const appBar = document.querySelector('#app-bar');
const publicBar = document.querySelector('#public-bar');
const publicRegister = document.querySelector('#public-register');
const viewHost = document.querySelector('#view');
const navLinks = [...document.querySelectorAll('.app-nav__link')];

/**
 * Adres -> ekran. `auth` oturum ister, `guestOnly` oturum varken gunluge gider.
 * Sunucudaki APP_PATHS listesiyle ayni yollar (kok `/` dosya olarak sunulur).
 */
const ROUTES = {
  '/': { id: 'landing', guestOnly: true, title: 'Movie Tracker — Film ve dizi günlüğü' },
  '/giris': { id: 'login', guestOnly: true, title: 'Giriş — Movie Tracker' },
  '/kayit': { id: 'register', guestOnly: true, title: 'Kayıt — Movie Tracker' },
  '/gizlilik': { id: 'privacy', title: 'Gizlilik — Movie Tracker' },
  '/kosullar': { id: 'terms', title: 'Kullanım koşulları — Movie Tracker' },
  '/gunluk': { id: 'library', auth: true, nav: 'library', title: 'Günlüğüm — Movie Tracker' },
  '/kesfet': { id: 'discover', auth: true, nav: 'discover', title: 'Keşfet — Movie Tracker' },
  '/ozet': { id: 'stats', auth: true, nav: 'stats', title: 'Özet — Movie Tracker' },
};

/**
 * @type {{
 *   user: object | null,
 *   libraryView: HTMLElement | null,
 *   registrationMode: 'open' | 'invite' | 'closed',
 *   contactEmail: string | null
 * }}
 */
const state = {
  user: null,
  libraryView: null,
  registrationMode: 'open',
  contactEmail: null,
};

/** @param {string} pathname */
function normalizePath(pathname) {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname || '/';
}

/**
 * Oturuma gore adresi netlestirir. Gerekirse replaceState ile duzeltir.
 * @returns {string}
 */
function resolvePath() {
  let path = normalizePath(location.pathname);
  const route = ROUTES[path];
  if (!route) return path;

  if (!state.user && route.auth) {
    path = '/giris';
    history.replaceState({}, '', path);
  } else if (state.user && route.guestOnly) {
    path = '/gunluk';
    history.replaceState({}, '', path);
  }
  return path;
}

/**
 * @param {string} path
 * @param {{ replace?: boolean }} [options]
 */
function navigate(path, { replace = false } = {}) {
  const next = normalizePath(path);
  const same = next === normalizePath(location.pathname);
  if (!same) history[replace ? 'replaceState' : 'pushState']({}, '', next);
  render();
}

function render() {
  const path = resolvePath();
  const route = ROUTES[path];

  document.title = route?.title ?? 'Movie Tracker';
  appBar.hidden = !state.user;
  publicBar.hidden = Boolean(state.user);
  if (publicRegister) publicRegister.hidden = state.registrationMode === 'closed';

  for (const link of navLinks) {
    link.classList.toggle('is-active', link.dataset.nav === route?.nav);
  }

  clear(viewHost);

  if (!route) {
    viewHost.append(createMissingView());
    return;
  }

  if (route.id === 'landing') {
    viewHost.append(createLandingView({ registrationMode: state.registrationMode }));
  } else if (route.id === 'login' || route.id === 'register') {
    viewHost.append(
      createAuthView({
        onAuthenticated: (user) => {
          state.user = user;
          renderUserMenu(user);
          navigate('/gunluk', { replace: true });
        },
        registrationMode: state.registrationMode,
        initialMode: route.id === 'register' ? 'register' : 'login',
      }),
    );
  } else if (route.id === 'privacy' || route.id === 'terms') {
    viewHost.append(
      createLegalView({
        kind: route.id === 'privacy' ? 'privacy' : 'terms',
        contactEmail: state.contactEmail,
      }),
    );
  } else if (route.id === 'discover') {
    viewHost.append(
      createDiscoverView({
        onEntrySaved: () => state.libraryView?.refresh?.(),
      }),
    );
  } else if (route.id === 'stats') {
    viewHost.append(createStatsView({ onNavigateDiscover: () => navigate('/kesfet') }));
  } else {
    const { element, isNew } = getLibraryView();
    if (!isNew) element.refresh?.();
    viewHost.append(element);
  }

  viewHost.focus();
}

function getLibraryView() {
  if (state.libraryView) return { element: state.libraryView, isNew: false };

  state.libraryView = createLibraryView({
    onNavigateDiscover: () => navigate('/kesfet'),
  });
  return { element: state.libraryView, isNew: true };
}

function createMissingView() {
  return el(
    'section',
    { class: 'prose' },
    el('h1', { class: 'page-head__title', text: 'Sayfa bulunamadı' }),
    el('p', { text: 'Bu adres Movie Tracker’da yok.' }),
    el('p', {}, el('a', { href: '/', text: 'Ana sayfaya dön' })),
  );
}

function renderUserMenu(user) {
  const userMenuHost = document.querySelector('#user-menu');
  clear(userMenuHost);

  const initials = (user.displayName ?? user.username).slice(0, 1).toUpperCase();

  userMenuHost.append(
    el('span', { class: 'avatar', 'aria-hidden': 'true', text: initials }),
    el('span', { class: 'user-menu__name', title: user.username, text: user.displayName ?? user.username }),
    el('button', { type: 'button', class: 'btn btn--ghost', text: 'Şifre', title: 'Şifre değiştir', onclick: openPasswordModal }),
    el('button', {
      type: 'button',
      class: 'btn btn--ghost',
      text: 'Hesabı sil',
      onclick: openDeleteModal,
    }),
    el('button', {
      type: 'button',
      class: 'btn',
      text: 'Çıkış',
      onclick: async () => {
        try {
          await api.logout();
        } catch {
          // Cikis istegi basarisiz olsa da yerel durumu temizliyoruz.
        }
        showToast('Çıkış yapıldı.', 'success');
        leaveApp('/');
      },
    }),
  );
}

/** Oturumu yerel olarak kapatip herkese acik bir sayfaya gecer. */
function leaveApp(path) {
  state.user = null;
  state.libraryView = null;
  navigate(path, { replace: true });
}

/** Sifre degistirme modali. */
function openPasswordModal() {
  const currentInput = el('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
  const newInput = el('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const errorBox = el('div', { class: 'form-alert', role: 'alert', hidden: true });

  const cancelButton = el('button', { type: 'button', class: 'btn', text: 'Vazgeç' });
  const saveButton = el('button', { type: 'button', class: 'btn btn--primary', text: 'Şifreyi değiştir' });

  const { close } = openModal({
    title: 'Şifre değiştir',
    subtitle: 'Değişiklikten sonra diğer cihazlardaki oturumlar kapatılır.',
    body: [
      errorBox,
      el('div', { class: 'field' }, el('span', { class: 'field__label', text: 'Mevcut şifre' }), currentInput),
      el(
        'div',
        { class: 'field' },
        el('span', { class: 'field__label', text: 'Yeni şifre' }),
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
      showToast('Şifreniz güncellendi.', 'success');
      close();
    } catch (error) {
      setLoading(saveButton, false);
      errorBox.textContent = error instanceof ApiError ? error.message : 'Beklenmeyen bir hata oluştu.';
      errorBox.hidden = false;
    }
  });
}

/** Hesap silme modali. Sifre ve kullanici adi tekrar istenir. */
function openDeleteModal() {
  const username = state.user?.username ?? '';
  const nameInput = el('input', { class: 'input', type: 'text', autocomplete: 'username', spellcheck: 'false' });
  const passwordInput = el('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
  const errorBox = el('div', { class: 'form-alert', role: 'alert', hidden: true });

  const cancelButton = el('button', { type: 'button', class: 'btn', text: 'Vazgeç' });
  const deleteButton = el('button', { type: 'button', class: 'btn btn--danger', text: 'Hesabı kalıcı olarak sil' });

  const { close } = openModal({
    title: 'Hesabı sil',
    subtitle: 'Günlüğün, notların ve hesabın silinir. Bu işlem geri alınmaz.',
    body: [
      errorBox,
      el(
        'div',
        { class: 'field' },
        el('span', { class: 'field__label', text: 'Kullanıcı adın' }),
        nameInput,
        el('p', { class: 'field__hint', text: `Onay için ${username} yaz` }),
      ),
      el('div', { class: 'field' }, el('span', { class: 'field__label', text: 'Şifre' }), passwordInput),
    ],
    footer: [el('span'), cancelButton, deleteButton],
  });

  cancelButton.addEventListener('click', close);

  deleteButton.addEventListener('click', async () => {
    errorBox.hidden = true;
    setLoading(deleteButton, true);

    try {
      await api.deleteAccount({ username: nameInput.value.trim(), password: passwordInput.value });
      close();
      showToast('Hesabın ve günlüğün silindi.', 'success');
      leaveApp('/');
    } catch (error) {
      setLoading(deleteButton, false);
      errorBox.textContent = error instanceof ApiError ? error.message : 'Beklenmeyen bir hata oluştu.';
      errorBox.hidden = false;
    }
  });
}

setUnauthorizedHandler(() => {
  if (!state.user) return;
  showToast('Oturumunuz sona erdi. Lütfen tekrar giriş yapın.', 'warning', 6000);
  leaveApp('/giris');
});

document.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const link = event.target.closest('a[href]');
  if (!link) return;
  if (link.target === '_blank' || link.hasAttribute('download')) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;

  const url = new URL(link.href, location.origin);
  if (url.origin !== location.origin) return;
  const path = normalizePath(url.pathname);
  if (!ROUTES[path]) return;

  event.preventDefault();
  navigate(path);
});

window.addEventListener('popstate', () => render());

try {
  const { user, registration, site } = await api.me();
  if (registration?.mode) state.registrationMode = registration.mode;
  state.contactEmail = site?.contactEmail ?? null;

  if (user) {
    state.user = user;
    renderUserMenu(user);
  }
  render();
} catch (error) {
  showApiError(error);
  render();
}
