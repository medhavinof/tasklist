import { apiRequest } from '../core/api.js';
import { state } from '../core/state.js';
import { renderEmojiPresets } from '../core/ui-shared.js';
import { renderAvatarInto, showMessage } from '../core/utils.js';

const els = {
  localAccountsBox: document.getElementById('local-accounts-box'),
  localAccountsList: document.getElementById('local-accounts-list'),
  authTabButtons: document.querySelectorAll('[data-auth-tab]'),
  authTabsContainer: document.querySelector('.auth-tabs'),
  authForm: document.getElementById('auth-form'),
  registerExtraTop: document.getElementById('register-extra-top'),
  registerExtraSec: document.getElementById('register-extra-sec'),
  authDisplayName: document.getElementById('auth-display-name'),
  registerAvatarPresets: document.getElementById('register-avatar-presets'),
  authUsername: document.getElementById('auth-username'),
  authPassword: document.getElementById('auth-password'),
  authSecQuestion: document.getElementById('auth-sec-question'),
  authSecAnswer: document.getElementById('auth-sec-answer'),
  authHint: document.getElementById('auth-hint'),
  authError: document.getElementById('auth-error'),
  authSubmitBtn: document.getElementById('auth-submit-btn'),
  loginLinksRow: document.getElementById('login-links-row'),
  openRecoverBtn: document.getElementById('open-recover-btn'),
  recoverForm: document.getElementById('recover-form'),
  recoverUsername: document.getElementById('recover-username'),
  recoverFindBtn: document.getElementById('recover-find-btn'),
  recoverStep2: document.getElementById('recover-step-2'),
  recoverQuestionText: document.getElementById('recover-question-text'),
  recoverAnswer: document.getElementById('recover-answer'),
  recoverNewPassword: document.getElementById('recover-new-password'),
  recoverError: document.getElementById('recover-error'),
  recoverBackBtn: document.getElementById('recover-back-btn'),
  recoverSubmitBtn: document.getElementById('recover-submit-btn'),
};

function renderRegisterAvatarPresets() {
  renderEmojiPresets(els.registerAvatarPresets, state.registerAvatar, (val) => {
    state.registerAvatar = state.registerAvatar === val ? null : val;
    renderRegisterAvatarPresets();
  });
}

function renderLocalAccounts() {
  els.localAccountsList.innerHTML = '';
  if (state.localAccounts.length === 0) {
    els.localAccountsBox.hidden = true;
    return;
  }

  els.localAccountsBox.hidden = false;
  for (const acc of state.localAccounts) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `account-switcher-chip${
      els.authUsername.value.trim().toLowerCase() === acc.username.toLowerCase()
        ? ' is-selected'
        : ''
    }`;

    const avatarEl = document.createElement('span');
    avatarEl.className = 'avatar-circle avatar-xs';
    renderAvatarInto(avatarEl, acc.avatar, acc.display_name || acc.username);

    const textEl = document.createElement('span');
    textEl.textContent = `${acc.display_name || acc.username} (@${acc.username})`;

    chip.append(avatarEl, textEl);
    chip.addEventListener('click', () => {
      showRecoverPanel(false);
      setAuthMode('login');
      els.authUsername.value = acc.username;
      renderLocalAccounts();
      els.authPassword.focus();
    });

    els.localAccountsList.appendChild(chip);
  }
}

export async function loadLocalAccounts() {
  try {
    const data = await apiRequest('/api/auth/accounts');
    state.localAccounts = data.accounts || [];
    renderLocalAccounts();
  } catch {
    state.localAccounts = [];
    renderLocalAccounts();
  }
}

export function setAuthMode(mode) {
  state.authMode = mode;
  els.authTabButtons.forEach((btn) => {
    const isActive = btn.dataset.authTab === mode;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });

  const isRegister = mode === 'register';
  els.registerExtraTop.hidden = !isRegister;
  els.registerExtraSec.hidden = !isRegister;
  els.loginLinksRow.hidden = isRegister;
  els.authHint.hidden = !isRegister;
  els.authSubmitBtn.textContent = isRegister ? 'Daftar & Masuk' : 'Masuk';
  els.authPassword.setAttribute(
    'autocomplete',
    isRegister ? 'new-password' : 'current-password'
  );
  showMessage(els.authError, '');

  if (isRegister) {
    renderRegisterAvatarPresets();
  }
}

export function showRecoverPanel(show, prefillUsername = '') {
  els.authForm.hidden = show;
  els.recoverForm.hidden = !show;
  els.authTabsContainer.hidden = show;
  showMessage(els.authError, '');
  showMessage(els.recoverError, '');

  if (show) {
    els.recoverStep2.hidden = true;
    els.recoverSubmitBtn.hidden = true;
    els.recoverQuestionText.textContent = '';
    els.recoverAnswer.value = '';
    els.recoverNewPassword.value = '';
    els.recoverUsername.value = prefillUsername || els.authUsername.value.trim();
    els.recoverUsername.focus();
  }
}

export function showAuthError(message) {
  showMessage(els.authError, message);
}

export function focusAuthUsername() {
  els.authUsername.focus();
}

export function initAuthView({ onAuthSuccess }) {
  for (const inputEl of [els.authUsername, els.authPassword]) {
    inputEl.addEventListener('input', () => showMessage(els.authError, ''));
  }
  for (const inputEl of [els.recoverUsername, els.recoverAnswer, els.recoverNewPassword]) {
    inputEl.addEventListener('input', () => showMessage(els.recoverError, ''));
  }

  els.authTabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      showRecoverPanel(false);
      setAuthMode(btn.dataset.authTab);
      els.authUsername.focus();
    });
  });

  els.authUsername.addEventListener('input', renderLocalAccounts);

  els.authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage(els.authError, '');

    const username = els.authUsername.value.trim();
    const password = els.authPassword.value;

    if (!username || !password) {
      showMessage(els.authError, 'Username dan password/PIN wajib diisi.');
      return;
    }

    els.authSubmitBtn.disabled = true;
    try {
      const isRegister = state.authMode === 'register';
      const endpoint = isRegister ? '/api/auth/register' : '/api/auth/login';
      const payload = isRegister
        ? {
            username,
            password,
            display_name: els.authDisplayName.value.trim() || null,
            avatar: state.registerAvatar,
            security_question: els.authSecQuestion.value.trim() || null,
            security_answer: els.authSecAnswer.value.trim() || null,
          }
        : { username, password };

      const data = await apiRequest(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      els.authForm.reset();
      state.registerAvatar = null;
      await onAuthSuccess(data.user);
    } catch (err) {
      showMessage(els.authError, err.message);
    } finally {
      els.authSubmitBtn.disabled = false;
    }
  });

  els.openRecoverBtn.addEventListener('click', () => showRecoverPanel(true));
  els.recoverBackBtn.addEventListener('click', () => showRecoverPanel(false));

  els.recoverFindBtn.addEventListener('click', async () => {
    showMessage(els.recoverError, '');
    const username = els.recoverUsername.value.trim();
    if (!username) {
      showMessage(els.recoverError, 'Masukkan username akun terlebih dahulu.');
      els.recoverUsername.focus();
      return;
    }

    try {
      const data = await apiRequest('/api/auth/recover/question', {
        method: 'POST',
        body: JSON.stringify({ username }),
      });
      els.recoverQuestionText.textContent = data.security_question;
      els.recoverStep2.hidden = false;
      els.recoverSubmitBtn.hidden = false;
      els.recoverAnswer.focus();
    } catch (err) {
      els.recoverStep2.hidden = true;
      els.recoverSubmitBtn.hidden = true;
      showMessage(els.recoverError, err.message);
    }
  });

  els.recoverForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage(els.recoverError, '');

    const username = els.recoverUsername.value.trim();
    const security_answer = els.recoverAnswer.value.trim();
    const new_password = els.recoverNewPassword.value;

    if (!username || !security_answer || !new_password) {
      showMessage(els.recoverError, 'Lengkapi jawaban keamanan dan password/PIN baru.');
      return;
    }

    try {
      const data = await apiRequest('/api/auth/recover/reset', {
        method: 'POST',
        body: JSON.stringify({ username, security_answer, new_password }),
      });
      els.recoverForm.reset();
      showRecoverPanel(false);
      await onAuthSuccess(data.user);
    } catch (err) {
      showMessage(els.recoverError, err.message);
    }
  });
}
