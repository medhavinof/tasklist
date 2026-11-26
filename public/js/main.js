import { apiRequest } from './core/api.js';
import { resetAllFilters, state } from './core/state.js';
import { getLocalNowString, isImeComposing } from './core/utils.js';
import {
  focusAuthUsername,
  initAuthView,
  loadLocalAccounts,
  setAuthMode,
  showAuthError,
  showRecoverPanel,
} from './components/AuthView.js';
import {
  closeCategoriesModal,
  initCategoriesModal,
  isCategoriesModalOpen,
  openCategoriesModal,
} from './components/CategoriesModal.js';
import { initDashboardPanel, renderDashboard } from './components/DashboardPanel.js';
import {
  closeCategoryFilterPopover,
  initFilterToolbar,
  isCategoryFilterPopoverOpen,
  renderFilterToolbar,
} from './components/FilterToolbar.js';
import {
  applyAppearance,
  closeProfileDropdown,
  initHeaderMenu,
  isProfileDropdownOpen,
  renderHeaderProfile,
} from './components/HeaderMenu.js';
import {
  clearAutoLockTimer,
  getLockStorageKey,
  initLockScreen,
  lockApp,
  resetAutoLockTimer,
} from './components/LockScreen.js';
import {
  closeSettingsModal,
  initSettingsModal,
  isSettingsModalOpen,
  openSettingsModal,
  showSettingsError,
  showSettingsSuccess,
  syncSettingsAutoCompleteCheckbox,
} from './components/SettingsModal.js';
import {
  clearTaskError,
  focusNewTaskInput,
  initTaskForm,
  renderTaskFormCategories,
  showTaskError,
} from './components/TaskForm.js';
import { initTaskList, renderTaskList } from './components/TaskList.js';

const views = {
  loadingSection: document.getElementById('loading-section'),
  authSection: document.getElementById('auth-section'),
  lockScreen: document.getElementById('lock-screen'),
  appSection: document.getElementById('app-section'),
};

function showView(view) {
  views.loadingSection.hidden = view !== 'loading';
  views.authSection.hidden = view !== 'auth';
  views.lockScreen.hidden = view !== 'lock';
  views.appSection.hidden = view !== 'app';
}

function closeAllOverlays() {
  closeProfileDropdown(false);
  closeCategoryFilterPopover(false);
  closeCategoriesModal();
  closeSettingsModal();
}

function renderAllAppPanels() {
  renderTaskFormCategories();
  renderDashboard();
  renderFilterToolbar();
  syncSettingsAutoCompleteCheckbox();
  renderTaskList();
}

function clearClientSessionState() {
  clearAutoLockTimer();
  state.isLocked = false;
  state.user = null;
  state.tasks = [];
  state.categories = [];
  state.newTaskCategoryIds.clear();
  state.counts = { all: 0, active: 0, completed: 0 };
  state.editingTaskId = null;
  state.editingDescTaskId = null;
  state.expandedTaskIds.clear();
  closeAllOverlays();
  applyAppearance(null);
}

function handleSessionExpired() {
  clearClientSessionState();
  loadLocalAccounts();
  showRecoverPanel(false);
  setAuthMode('login');
  showView('auth');
  showAuthError('Sesi Anda telah berakhir. Silakan masuk kembali.');
}

async function loadTasks() {
  try {
    const params = new URLSearchParams({
      status: state.statusFilter,
      priority: state.priorityFilter,
      due: state.dueFilter,
      sort: state.sort,
      now: getLocalNowString(),
    });

    if (state.filterUncategorized) {
      params.set('category', 'none');
    } else if (state.selectedCategoryIds.length > 0) {
      params.set('category_ids', state.selectedCategoryIds.join(','));
      params.set('category_mode', state.categoryFilterMode);
    }

    const data = await apiRequest(`/api/tasks?${params.toString()}`);
    state.tasks = data.tasks;
    state.counts = data.counts;
    state.summary = data.summary;
    state.categories = data.categories || [];
    renderAllAppPanels();
  } catch (err) {
    if (err.status === 401) {
      handleSessionExpired();
      return;
    }
    showTaskError(err.message);
  }
}

async function enterApp(user) {
  state.user = user;
  state.isLocked =
    sessionStorage.getItem(getLockStorageKey()) === '1' && user.auto_lock_minutes > 0;
  resetAllFilters();
  state.categoryFilterMode = 'and';
  state.newTaskCategoryIds.clear();
  state.sort = 'newest';
  state.editingDescTaskId = null;
  state.expandedTaskIds.clear();
  renderHeaderProfile();
  clearTaskError();

  if (state.isLocked) {
    lockApp();
    return;
  }

  showView('app');
  await loadTasks();
  resetAutoLockTimer();
  focusNewTaskInput();
}

async function logoutToAuth(openRecovery = false) {
  const previousUsername = state.user?.username || '';
  if (state.user) {
    sessionStorage.removeItem(getLockStorageKey());
  }
  try {
    await apiRequest('/api/auth/logout', { method: 'POST' });
  } catch {
    // Ignore logout transport failure
  }
  clearClientSessionState();
  await loadLocalAccounts();
  setAuthMode('login');
  showView('auth');
  if (openRecovery) {
    showRecoverPanel(true, previousUsername);
  } else {
    showRecoverPanel(false);
    focusAuthUsername();
  }
}

async function updateProfilePreferences(patch, successMsg = 'Preferensi tersimpan.') {
  try {
    showSettingsError('');
    const data = await apiRequest('/api/profile/preferences', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    state.user = data.user;
    renderHeaderProfile();
    renderFilterToolbar();
    syncSettingsAutoCompleteCheckbox();
    resetAutoLockTimer();
    if (successMsg && isSettingsModalOpen()) {
      showSettingsSuccess(successMsg);
    }
  } catch (err) {
    if (err.status === 401) {
      handleSessionExpired();
      return;
    }
    showSettingsError(err.message);
    showTaskError(err.message);
  }
}

function initGlobalEscapeHandler() {
  document.addEventListener('keydown', (event) => {
    if (isImeComposing(event)) {
      return;
    }
    if (event.key !== 'Escape') {
      return;
    }
    if (isCategoriesModalOpen()) {
      event.preventDefault();
      closeCategoriesModal();
      return;
    }
    if (isSettingsModalOpen()) {
      event.preventDefault();
      closeSettingsModal();
      return;
    }
    if (isCategoryFilterPopoverOpen()) {
      event.preventDefault();
      closeCategoryFilterPopover(true);
      return;
    }
    if (isProfileDropdownOpen()) {
      event.preventDefault();
      closeProfileDropdown(true);
    }
  });
}

async function bootstrap() {
  initAuthView({ onAuthSuccess: enterApp });

  initLockScreen({
    beforeLock: closeAllOverlays,
    showLockView: () => showView('lock'),
    onUnlockSuccess: async () => {
      showView('app');
      await loadTasks();
    },
    onSessionExpired: handleSessionExpired,
    onLogout: logoutToAuth,
  });

  initHeaderMenu({
    onOpenSettings: (tab) => openSettingsModal(tab, applyAppearance),
    onOpenCategories: openCategoriesModal,
    onLock: lockApp,
    onLogout: logoutToAuth,
    onToggleTheme: (nextTheme) => updateProfilePreferences({ theme: nextTheme }, ''),
  });

  initDashboardPanel({
    onTasksChanged: loadTasks,
    onClearTaskError: clearTaskError,
  });

  initTaskForm({
    onTasksChanged: loadTasks,
    onOpenCategories: openCategoriesModal,
    onSessionExpired: handleSessionExpired,
  });

  initFilterToolbar({
    onTasksChanged: loadTasks,
    onToggleAutoComplete: (checked) =>
      updateProfilePreferences({ auto_complete_subtasks: checked }, ''),
    onClearTaskError: clearTaskError,
  });

  initTaskList({
    onTasksChanged: loadTasks,
    onRenderAll: renderAllAppPanels,
    onSessionExpired: handleSessionExpired,
    onShowTaskError: showTaskError,
    onClearTaskError: clearTaskError,
  });

  initSettingsModal({
    onProfileUpdated: renderHeaderProfile,
    onTasksChanged: loadTasks,
    onLockApp: lockApp,
    onSessionExpired: handleSessionExpired,
    onUpdatePreferences: updateProfilePreferences,
    onAccountDeleted: async () => {
      if (state.user) {
        sessionStorage.removeItem(getLockStorageKey());
      }
      clearClientSessionState();
      await loadLocalAccounts();
      setAuthMode('login');
      showView('auth');
      showAuthError('');
    },
  });

  initCategoriesModal({
    onCategoriesChanged: loadTasks,
  });

  initGlobalEscapeHandler();

  showView('loading');
  try {
    const data = await apiRequest('/api/auth/me');
    await enterApp(data.user);
  } catch {
    applyAppearance(null);
    await loadLocalAccounts();
    setAuthMode('login');
    showView('auth');
  }
}

bootstrap();
