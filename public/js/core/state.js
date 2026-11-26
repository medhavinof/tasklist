export const EMOJI_PRESETS = ['😀', '🚀', '💼', '🎯', '🌿', '🦉', '⚡', '🎨'];

export const CATEGORY_COLORS = ['indigo', 'blue', 'emerald', 'rose', 'amber', 'violet', 'cyan', 'slate'];
export const CATEGORY_ICONS = ['tag', 'briefcase', 'user', 'shopping-bag', 'book', 'heart', 'star', 'zap', 'home'];

export const PRIORITY_LABELS = {
  high: 'Tinggi',
  medium: 'Sedang',
  low: 'Rendah',
};

export const EMPTY_MESSAGES = {
  all: 'Belum ada tugas yang cocok. Ketik tugas di atas lalu tekan Enter.',
  active: 'Tidak ada tugas aktif untuk filter saat ini.',
  completed: 'Belum ada tugas yang ditandai selesai.',
};

export const state = {
  authMode: 'login',
  user: null,
  localAccounts: [],
  registerAvatar: null,
  statusFilter: 'all',
  priorityFilter: 'all',
  selectedCategoryIds: [],
  filterUncategorized: false,
  categoryFilterMode: 'and',
  dueFilter: 'all',
  sort: 'newest',
  tasks: [],
  counts: { all: 0, active: 0, completed: 0 },
  summary: {
    total: 0,
    active: 0,
    completed: 0,
    completionRate: 0,
    dueToday: 0,
    overdue: 0,
    highPriority: 0,
    byCategory: [],
  },
  categories: [],
  newTaskCategoryIds: new Set(),
  createCategoryColor: 'indigo',
  createCategoryIcon: 'tag',
  editingCategoryId: null,
  editCategoryColor: 'indigo',
  editCategoryIcon: 'tag',
  editingTaskId: null,
  editingDescTaskId: null,
  expandedTaskIds: new Set(),
  dashboardCollapsed: false,
  isLocked: false,
  autoLockTimerId: null,
  settingsTab: 'profil',
  draftAvatar: null,
  lastFocusedElement: null,
  lastCatFocusedElement: null,
};

export function resetAllFilters() {
  state.statusFilter = 'all';
  state.priorityFilter = 'all';
  state.selectedCategoryIds = [];
  state.filterUncategorized = false;
  state.dueFilter = 'all';
  state.editingTaskId = null;
}
