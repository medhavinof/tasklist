import { apiRequest } from '../core/api.js';
import { state } from '../core/state.js';
import { renderAvatarInto, showMessage } from '../core/utils.js';

const els = {
  lockAvatar: document.getElementById('lock-avatar'),
  lockDisplayName: document.getElementById('lock-display-name'),
  lockUsername: document.getElementById('lock-username'),
  lockForm: document.getElementById('lock-form'),
  lockPasswordInput: document.getElementById('lock-password-input'),
  lockError: document.getElementById('lock-error'),
  lockRecoverBtn: document.getElementById('lock-recover-btn'),
  lockSwitchBtn: document.getElementById('lock-switch-btn'),
};

let onBeforeLock = null;
let onShowLockView = null;

export function getLockStorageKey() {
  return state.user ? `tasklist_locked_${state.user.id}` : 'tasklist_locked';
}

export function clearAutoLockTimer() {
  if (state.autoLockTimerId) {
    clearTimeout(state.autoLockTimerId);
    state.autoLockTimerId = null;
  }
}

export function lockApp() {
  if (!state.user) {
    return;
  }
  clearAutoLockTimer();
  state.isLocked = true;
  sessionStorage.setItem(getLockStorageKey(), '1');
  if (onBeforeLock) {
    onBeforeLock();
  }

  const displayName = state.user.display_name || state.user.username;
  renderAvatarInto(els.lockAvatar, state.user.avatar, displayName);
  els.lockDisplayName.textContent = displayName;
  els.lockUsername.textContent = `@${state.user.username}`;
  els.lockPasswordInput.value = '';
  showMessage(els.lockError, '');
  if (onShowLockView) {
    onShowLockView();
  }
  els.lockPasswordInput.focus();
}

export function resetAutoLockTimer() {
  clearAutoLockTimer();
  if (!state.user || state.isLocked) {
    return;
  }
  const mins = Number(state.user.auto_lock_minutes || 0);
  if (mins <= 0) {
    return;
  }
  state.autoLockTimerId = setTimeout(lockApp, mins * 60 * 1000);
}

export function initLockScreen({
  beforeLock,
  showLockView,
  onUnlockSuccess,
  onSessionExpired,
  onLogout,
}) {
  onBeforeLock = beforeLock;
  onShowLockView = showLockView;

  els.lockPasswordInput.addEventListener('input', () => showMessage(els.lockError, ''));

  els.lockForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage(els.lockError, '');
    const password = els.lockPasswordInput.value;
    if (!password) {
      showMessage(els.lockError, 'Masukkan Password atau PIN Anda.');
      return;
    }

    try {
      const data = await apiRequest('/api/auth/unlock', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      state.isLocked = false;
      sessionStorage.removeItem(getLockStorageKey());
      state.user = data.user;
      await onUnlockSuccess();
      resetAutoLockTimer();
    } catch (err) {
      if (err.status === 401 && !err.message.includes('salah')) {
        onSessionExpired();
        return;
      }
      showMessage(els.lockError, err.message);
      els.lockPasswordInput.select();
    }
  });

  els.lockRecoverBtn.addEventListener('click', () => onLogout(true));
  els.lockSwitchBtn.addEventListener('click', () => onLogout(false));

  for (const eventName of ['mousemove', 'keydown', 'click', 'touchstart', 'scroll']) {
    window.addEventListener(eventName, resetAutoLockTimer, { passive: true });
  }
}
