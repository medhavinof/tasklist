import { createSvgIcon } from '../core/icons.js';
import { state } from '../core/state.js';
import { renderAvatarInto } from '../core/utils.js';

const els = {
  profileDropdown: document.getElementById('profile-dropdown'),
  openProfilePill: document.getElementById('open-profile-pill'),
  profileDropdownMenu: document.getElementById('profile-dropdown-menu'),
  menuSettingsButtons: document.querySelectorAll('[data-menu-settings]'),
  menuCategoriesBtn: document.getElementById('menu-categories-btn'),
  menuLockBtn: document.getElementById('menu-lock-btn'),
  logoutBtn: document.getElementById('logout-btn'),
  headerAvatar: document.getElementById('header-avatar'),
  headerDisplayName: document.getElementById('header-display-name'),
  currentUsername: document.getElementById('current-username'),
  quickThemeBtn: document.getElementById('quick-theme-btn'),
  themeChoiceButtons: document.querySelectorAll('[data-theme-choice]'),
  accentChoiceButtons: document.querySelectorAll('[data-accent-choice]'),
};

export function applyAppearance(user) {
  const theme = user?.theme === 'dark' ? 'dark' : 'light';
  const accent = user?.accent_color || 'indigo';
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.accent = accent;

  els.quickThemeBtn.innerHTML = '';
  els.quickThemeBtn.appendChild(createSvgIcon(theme === 'dark' ? 'sun' : 'moon'));
  els.quickThemeBtn.setAttribute(
    'aria-label',
    theme === 'dark' ? 'Aktifkan mode terang' : 'Aktifkan mode gelap'
  );

  els.themeChoiceButtons.forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.themeChoice === theme);
  });
  els.accentChoiceButtons.forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.accentChoice === accent);
  });
}

export function renderHeaderProfile() {
  if (!state.user) {
    return;
  }
  const displayName = state.user.display_name || state.user.username;
  els.headerDisplayName.textContent = displayName;
  els.currentUsername.textContent = `@${state.user.username}`;
  renderAvatarInto(els.headerAvatar, state.user.avatar, displayName);
  applyAppearance(state.user);
}

export function isProfileDropdownOpen() {
  return !els.profileDropdownMenu.hidden;
}

export function openProfileDropdown() {
  els.profileDropdownMenu.hidden = false;
  els.openProfilePill.setAttribute('aria-expanded', 'true');
}

export function closeProfileDropdown(restoreFocus = false) {
  if (els.profileDropdownMenu.hidden) {
    return;
  }
  els.profileDropdownMenu.hidden = true;
  els.openProfilePill.setAttribute('aria-expanded', 'false');
  if (restoreFocus) {
    els.openProfilePill.focus();
  }
}

export function initHeaderMenu({
  onOpenSettings,
  onOpenCategories,
  onLock,
  onLogout,
  onToggleTheme,
}) {
  els.openProfilePill.addEventListener('click', (event) => {
    event.stopPropagation();
    if (els.profileDropdownMenu.hidden) {
      openProfileDropdown();
    } else {
      closeProfileDropdown(false);
    }
  });

  els.menuSettingsButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      closeProfileDropdown(false);
      onOpenSettings(btn.dataset.menuSettings);
    });
  });

  els.menuCategoriesBtn.addEventListener('click', () => {
    closeProfileDropdown(false);
    onOpenCategories();
  });

  els.menuLockBtn.addEventListener('click', () => {
    closeProfileDropdown(false);
    onLock();
  });

  els.logoutBtn.addEventListener('click', () => onLogout(false));

  els.quickThemeBtn.addEventListener('click', () => {
    if (!state.user) return;
    const nextTheme = state.user.theme === 'dark' ? 'light' : 'dark';
    onToggleTheme(nextTheme);
  });

  document.addEventListener('click', (event) => {
    if (!els.profileDropdown.contains(event.target)) {
      closeProfileDropdown(false);
    }
  });
}
