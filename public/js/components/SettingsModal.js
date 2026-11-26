import { apiRequest } from '../core/api.js';
import { state } from '../core/state.js';
import { renderEmojiPresets } from '../core/ui-shared.js';
import { renderAvatarInto, resizeAvatarFile, showMessage } from '../core/utils.js';

const els = {
  settingsModal: document.getElementById('settings-modal'),
  closeSettingsBtn: document.getElementById('close-settings-btn'),
  settingsTabButtons: document.querySelectorAll('[data-settings-tab]'),
  settingsPanels: document.querySelectorAll('[data-settings-panel]'),
  settingsError: document.getElementById('settings-error'),
  settingsSuccess: document.getElementById('settings-success'),

  settingsAvatarPreview: document.getElementById('settings-avatar-preview'),
  avatarFileInput: document.getElementById('avatar-file-input'),
  removeAvatarBtn: document.getElementById('remove-avatar-btn'),
  settingsAvatarPresets: document.getElementById('settings-avatar-presets'),
  profileIdentityForm: document.getElementById('profile-identity-form'),
  settingsDisplayName: document.getElementById('settings-display-name'),
  settingsUsername: document.getElementById('settings-username'),

  changePasswordForm: document.getElementById('change-password-form'),
  secCurrentPassword: document.getElementById('sec-current-password'),
  secNewPassword: document.getElementById('sec-new-password'),
  securityQuestionForm: document.getElementById('security-question-form'),
  secQuestionStatus: document.getElementById('sec-question-status'),
  secQuestionInput: document.getElementById('sec-question-input'),
  secAnswerInput: document.getElementById('sec-answer-input'),
  secQuestionVerifyPass: document.getElementById('sec-question-verify-pass'),
  settingAutoLock: document.getElementById('setting-auto-lock'),
  lockNowBtn: document.getElementById('lock-now-btn'),

  themeChoiceButtons: document.querySelectorAll('[data-theme-choice]'),
  accentChoiceButtons: document.querySelectorAll('[data-accent-choice]'),
  settingsAutoCompleteToggle: document.getElementById('settings-auto-complete-toggle'),

  exportBackupBtn: document.getElementById('export-backup-btn'),
  importBackupForm: document.getElementById('import-backup-form'),
  importFileInput: document.getElementById('import-file-input'),
  resetTasksForm: document.getElementById('reset-tasks-form'),
  resetTasksPassword: document.getElementById('reset-tasks-password'),
  deleteProfileForm: document.getElementById('delete-profile-form'),
  deleteProfilePassword: document.getElementById('delete-profile-password'),
};

export function isSettingsModalOpen() {
  return !els.settingsModal.hidden;
}

export function showSettingsSuccess(message) {
  showMessage(els.settingsSuccess, message);
}

export function showSettingsError(message) {
  showMessage(els.settingsError, message);
}

export function syncSettingsAutoCompleteCheckbox() {
  els.settingsAutoCompleteToggle.checked = Boolean(state.user?.auto_complete_subtasks ?? true);
}

function setSettingsTab(tabName) {
  state.settingsTab = tabName;
  els.settingsTabButtons.forEach((btn) => {
    const isActive = btn.dataset.settingsTab === tabName;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });
  els.settingsPanels.forEach((panel) => {
    panel.hidden = panel.dataset.settingsPanel !== tabName;
  });
  showMessage(els.settingsError, '');
  showMessage(els.settingsSuccess, '');
}

function renderSettingsAvatarSection() {
  if (!state.user) return;
  const displayName = els.settingsDisplayName.value.trim() || state.user.username;
  renderAvatarInto(els.settingsAvatarPreview, state.draftAvatar, displayName);
  renderEmojiPresets(els.settingsAvatarPresets, state.draftAvatar, (val) => {
    state.draftAvatar = val;
    renderSettingsAvatarSection();
  });
}

export function openSettingsModal(initialTab = 'profil', onApplyAppearance) {
  if (!state.user) return;
  state.lastFocusedElement = document.activeElement;
  state.draftAvatar = state.user.avatar || null;
  els.settingsDisplayName.value = state.user.display_name || state.user.username;
  els.settingsUsername.value = state.user.username;
  renderSettingsAvatarSection();

  els.secCurrentPassword.value = '';
  els.secNewPassword.value = '';
  els.secQuestionStatus.textContent = state.user.has_security_question
    ? 'Sudah diatur'
    : 'Belum diatur';
  els.secQuestionInput.value = state.user.security_question || '';
  els.secAnswerInput.value = '';
  els.secQuestionVerifyPass.value = '';
  els.settingAutoLock.value = String(state.user.auto_lock_minutes || 0);
  syncSettingsAutoCompleteCheckbox();
  els.resetTasksPassword.value = '';
  els.deleteProfilePassword.value = '';
  els.importFileInput.value = '';

  if (onApplyAppearance) {
    onApplyAppearance(state.user);
  }
  setSettingsTab(initialTab);
  els.settingsModal.hidden = false;
  queueMicrotask(() => {
    els.closeSettingsBtn.focus();
  });
}

export function closeSettingsModal() {
  if (els.settingsModal.hidden) {
    return;
  }
  els.settingsModal.hidden = true;
  if (state.lastFocusedElement && typeof state.lastFocusedElement.focus === 'function') {
    state.lastFocusedElement.focus();
    state.lastFocusedElement = null;
  }
}

export function initSettingsModal({
  onProfileUpdated,
  onTasksChanged,
  onLockApp,
  onSessionExpired,
  onAccountDeleted,
  onUpdatePreferences,
}) {
  for (const inputEl of [
    els.settingsDisplayName,
    els.settingsUsername,
    els.secCurrentPassword,
    els.secNewPassword,
    els.secQuestionInput,
    els.secAnswerInput,
    els.secQuestionVerifyPass,
    els.resetTasksPassword,
    els.deleteProfilePassword,
  ]) {
    inputEl.addEventListener('input', () => showMessage(els.settingsError, ''));
  }

  els.closeSettingsBtn.addEventListener('click', closeSettingsModal);
  els.settingsModal.addEventListener('click', (event) => {
    if (event.target === els.settingsModal) {
      closeSettingsModal();
    }
  });

  els.settingsTabButtons.forEach((btn) => {
    btn.addEventListener('click', () => setSettingsTab(btn.dataset.settingsTab));
  });

  els.avatarFileInput.addEventListener('change', async () => {
    const file = els.avatarFileInput.files?.[0];
    if (!file) return;
    try {
      showMessage(els.settingsError, '');
      state.draftAvatar = await resizeAvatarFile(file);
      renderSettingsAvatarSection();
    } catch (err) {
      showMessage(els.settingsError, err.message);
    } finally {
      els.avatarFileInput.value = '';
    }
  });

  els.removeAvatarBtn.addEventListener('click', () => {
    state.draftAvatar = null;
    renderSettingsAvatarSection();
  });

  els.profileIdentityForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage(els.settingsError, '');
    showMessage(els.settingsSuccess, '');

    const display_name = els.settingsDisplayName.value.trim();
    const username = els.settingsUsername.value.trim();

    if (!username) {
      showMessage(els.settingsError, 'Username wajib diisi.');
      return;
    }

    try {
      const data = await apiRequest('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          display_name: display_name || null,
          username,
          avatar: state.draftAvatar,
        }),
      });
      state.user = data.user;
      onProfileUpdated();
      showMessage(els.settingsSuccess, 'Identitas profil berhasil disimpan.');
    } catch (err) {
      if (err.status === 401) {
        onSessionExpired();
        return;
      }
      showMessage(els.settingsError, err.message);
    }
  });

  els.changePasswordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage(els.settingsError, '');
    showMessage(els.settingsSuccess, '');

    try {
      await apiRequest('/api/profile/password', {
        method: 'PATCH',
        body: JSON.stringify({
          current_password: els.secCurrentPassword.value,
          new_password: els.secNewPassword.value,
        }),
      });
      els.changePasswordForm.reset();
      showMessage(els.settingsSuccess, 'Password / PIN berhasil diperbarui.');
    } catch (err) {
      showMessage(els.settingsError, err.message);
    }
  });

  els.securityQuestionForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage(els.settingsError, '');
    showMessage(els.settingsSuccess, '');

    try {
      const data = await apiRequest('/api/profile/security-question', {
        method: 'PATCH',
        body: JSON.stringify({
          security_question: els.secQuestionInput.value,
          security_answer: els.secAnswerInput.value,
          current_password: els.secQuestionVerifyPass.value,
        }),
      });
      state.user = data.user;
      els.secAnswerInput.value = '';
      els.secQuestionVerifyPass.value = '';
      els.secQuestionStatus.textContent = 'Sudah diatur';
      showMessage(els.settingsSuccess, 'Pertanyaan keamanan berhasil disimpan.');
    } catch (err) {
      showMessage(els.settingsError, err.message);
    }
  });

  els.settingAutoLock.addEventListener('change', () => {
    const minutes = Number(els.settingAutoLock.value);
    onUpdatePreferences(
      { auto_lock_minutes: minutes },
      minutes === 0 ? 'Kunci otomatis dinonaktifkan.' : `Kunci otomatis diatur ke ${minutes} menit.`
    );
  });

  els.lockNowBtn.addEventListener('click', onLockApp);

  els.themeChoiceButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      onUpdatePreferences({ theme: btn.dataset.themeChoice }, 'Tema diperbarui.');
    });
  });

  els.accentChoiceButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      onUpdatePreferences({ accent_color: btn.dataset.accentChoice }, 'Warna aksen diperbarui.');
    });
  });

  els.settingsAutoCompleteToggle.addEventListener('change', () => {
    onUpdatePreferences(
      { auto_complete_subtasks: els.settingsAutoCompleteToggle.checked },
      'Aturan sub-task diperbarui.'
    );
  });

  els.exportBackupBtn.addEventListener('click', async () => {
    try {
      showMessage(els.settingsError, '');
      const data = await apiRequest('/api/profile/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `tasklist-backup-${state.user.username}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showMessage(els.settingsSuccess, 'File cadangan .json berhasil diunduh.');
    } catch (err) {
      showMessage(els.settingsError, err.message);
    }
  });

  els.importBackupForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage(els.settingsError, '');
    showMessage(els.settingsSuccess, '');

    const file = els.importFileInput.files?.[0];
    if (!file) {
      showMessage(els.settingsError, 'Pilih file cadangan .json terlebih dahulu.');
      return;
    }

    const mode =
      document.querySelector('input[name="import-mode"]:checked')?.value || 'merge';

    try {
      const rawText = await file.text();
      let parsed;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        showMessage(els.settingsError, 'Isi file bukan JSON yang valid.');
        return;
      }

      const res = await apiRequest('/api/profile/import', {
        method: 'POST',
        body: JSON.stringify({ mode, data: parsed }),
      });
      state.user = res.user;
      onProfileUpdated();
      await onTasksChanged();
      els.importFileInput.value = '';
      showMessage(
        els.settingsSuccess,
        `Berhasil mengimpor ${res.imported.tasks} tugas dan ${res.imported.subtasks} sub-tugas.`
      );
    } catch (err) {
      showMessage(els.settingsError, err.message);
    }
  });

  els.resetTasksForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage(els.settingsError, '');
    showMessage(els.settingsSuccess, '');

    const password = els.resetTasksPassword.value;
    if (!password) {
      showMessage(els.settingsError, 'Masukkan Password / PIN untuk konfirmasi reset.');
      return;
    }

    try {
      const res = await apiRequest('/api/profile/reset-tasks', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      els.resetTasksPassword.value = '';
      await onTasksChanged();
      showMessage(
        els.settingsSuccess,
        `Data tugas berhasil direset (${res.deleted_tasks} tugas dihapus).`
      );
    } catch (err) {
      showMessage(els.settingsError, err.message);
    }
  });

  els.deleteProfileForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage(els.settingsError, '');

    const password = els.deleteProfilePassword.value;
    if (!password) {
      showMessage(els.settingsError, 'Masukkan Password / PIN untuk menghapus profil.');
      return;
    }

    try {
      await apiRequest('/api/profile', {
        method: 'DELETE',
        body: JSON.stringify({ password }),
      });
      await onAccountDeleted();
    } catch (err) {
      showMessage(els.settingsError, err.message);
    }
  });
}
