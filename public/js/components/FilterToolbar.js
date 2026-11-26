import { PRIORITY_LABELS, resetAllFilters, state } from '../core/state.js';
import { createCategoryBadge } from '../core/ui-shared.js';

const els = {
  filterButtons: document.querySelectorAll('[data-filter]'),
  categoryFilterDropdown: document.getElementById('category-filter-dropdown'),
  filterCategoryBtn: document.getElementById('filter-category-btn'),
  filterCategoryLabel: document.getElementById('filter-category-label'),
  filterCategoryPopover: document.getElementById('filter-category-popover'),
  clearCatFilterBtn: document.getElementById('clear-cat-filter-btn'),
  filterModeRow: document.getElementById('filter-mode-row'),
  filterModeButtons: document.querySelectorAll('[data-cat-mode]'),
  filterCategoryOptions: document.getElementById('filter-category-options'),
  filterPriority: document.getElementById('filter-priority'),
  filterSort: document.getElementById('filter-sort'),
  autoCompleteToggle: document.getElementById('auto-complete-toggle'),
  activeFiltersBar: document.getElementById('active-filters-bar'),
  activeFiltersText: document.getElementById('active-filters-text'),
  resetFiltersBtn: document.getElementById('reset-filters-btn'),
  countAll: document.getElementById('count-all'),
  countActive: document.getElementById('count-active'),
  countCompleted: document.getElementById('count-completed'),
};

let loadTasksCallback = null;

export function isCategoryFilterPopoverOpen() {
  return !els.filterCategoryPopover.hidden;
}

export function openCategoryFilterPopover() {
  els.filterCategoryPopover.hidden = false;
  els.filterCategoryBtn.setAttribute('aria-expanded', 'true');
}

export function closeCategoryFilterPopover(restoreFocus = false) {
  if (els.filterCategoryPopover.hidden) {
    return;
  }
  els.filterCategoryPopover.hidden = true;
  els.filterCategoryBtn.setAttribute('aria-expanded', 'false');
  if (restoreFocus) {
    els.filterCategoryBtn.focus();
  }
}

export function renderCounts() {
  els.countAll.textContent = String(state.counts.all);
  els.countActive.textContent = String(state.counts.active);
  els.countCompleted.textContent = String(state.counts.completed);
}

export function renderCategoryFilterPopover() {
  const validIds = new Set(state.categories.map((c) => c.id));
  state.selectedCategoryIds = state.selectedCategoryIds.filter((id) => validIds.has(id));

  els.filterModeRow.hidden = state.selectedCategoryIds.length < 2;
  els.filterModeButtons.forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.catMode === state.categoryFilterMode);
  });

  if (state.filterUncategorized) {
    els.filterCategoryLabel.textContent = 'Tanpa Kategori';
  } else if (state.selectedCategoryIds.length === 0) {
    els.filterCategoryLabel.textContent = 'Semua Kategori';
  } else if (state.selectedCategoryIds.length === 1) {
    const found = state.categories.find((c) => c.id === state.selectedCategoryIds[0]);
    els.filterCategoryLabel.textContent = found ? found.name : '1 Kategori';
  } else {
    const modeLabel = state.categoryFilterMode === 'and' ? 'DAN' : 'ATAU';
    els.filterCategoryLabel.textContent = `${state.selectedCategoryIds.length} Kategori (${modeLabel})`;
  }

  els.filterCategoryOptions.innerHTML = '';

  const noneLabel = document.createElement('label');
  noneLabel.className = 'filter-cat-option';
  const noneCb = document.createElement('input');
  noneCb.type = 'checkbox';
  noneCb.checked = state.filterUncategorized;
  noneCb.addEventListener('change', async () => {
    state.filterUncategorized = noneCb.checked;
    if (state.filterUncategorized) {
      state.selectedCategoryIds = [];
    }
    state.editingTaskId = null;
    await loadTasksCallback();
  });
  const noneText = document.createElement('span');
  noneText.textContent = 'Tanpa Kategori';
  noneLabel.append(noneCb, noneText);
  els.filterCategoryOptions.appendChild(noneLabel);

  for (const cat of state.categories) {
    const label = document.createElement('label');
    label.className = 'filter-cat-option';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = state.selectedCategoryIds.includes(cat.id);
    cb.addEventListener('change', async () => {
      state.filterUncategorized = false;
      if (cb.checked) {
        if (!state.selectedCategoryIds.includes(cat.id)) {
          state.selectedCategoryIds.push(cat.id);
        }
      } else {
        state.selectedCategoryIds = state.selectedCategoryIds.filter((id) => id !== cat.id);
      }
      state.editingTaskId = null;
      await loadTasksCallback();
    });

    label.append(cb, createCategoryBadge(cat));
    els.filterCategoryOptions.appendChild(label);
  }
}

export function renderFilterToolbar() {
  renderCounts();
  renderCategoryFilterPopover();

  els.filterButtons.forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.filter === state.statusFilter);
  });

  els.filterPriority.value = state.priorityFilter;
  els.filterSort.value = state.sort;
  els.autoCompleteToggle.checked = Boolean(state.user?.auto_complete_subtasks ?? true);

  const activeParts = [];
  if (state.dueFilter === 'today') {
    activeParts.push('Tenggat: Hari Ini');
  } else if (state.dueFilter === 'overdue') {
    activeParts.push('Tenggat: Terlambat');
  }
  if (state.priorityFilter !== 'all') {
    activeParts.push(`Prioritas: ${PRIORITY_LABELS[state.priorityFilter]}`);
  }
  if (state.filterUncategorized) {
    activeParts.push('Kategori: Tanpa Kategori');
  } else if (state.selectedCategoryIds.length > 0) {
    const names = state.selectedCategoryIds
      .map((id) => state.categories.find((c) => c.id === id)?.name)
      .filter(Boolean);
    const joiner = state.categoryFilterMode === 'and' ? ' DAN ' : ' ATAU ';
    if (names.length > 0) {
      activeParts.push(`Kategori: ${names.join(joiner)}`);
    }
  }

  if (activeParts.length === 0) {
    els.activeFiltersBar.hidden = true;
    els.activeFiltersText.textContent = '';
  } else {
    els.activeFiltersBar.hidden = false;
    els.activeFiltersText.textContent = `Filter aktif: ${activeParts.join(' · ')}`;
  }
}

export function initFilterToolbar({ onTasksChanged, onToggleAutoComplete, onClearTaskError }) {
  loadTasksCallback = onTasksChanged;

  els.filterCategoryBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    if (els.filterCategoryPopover.hidden) {
      openCategoryFilterPopover();
    } else {
      closeCategoryFilterPopover(false);
    }
  });

  els.clearCatFilterBtn.addEventListener('click', async () => {
    state.selectedCategoryIds = [];
    state.filterUncategorized = false;
    await loadTasksCallback();
  });

  els.filterModeButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const nextMode = btn.dataset.catMode;
      if (nextMode === state.categoryFilterMode) {
        return;
      }
      state.categoryFilterMode = nextMode;
      await loadTasksCallback();
    });
  });

  els.filterButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const nextFilter = btn.dataset.filter;
      if (nextFilter === state.statusFilter) {
        return;
      }
      state.statusFilter = nextFilter;
      state.editingTaskId = null;
      onClearTaskError();
      await loadTasksCallback();
    });
  });

  els.filterPriority.addEventListener('change', async () => {
    state.priorityFilter = els.filterPriority.value;
    state.editingTaskId = null;
    await loadTasksCallback();
  });

  els.filterSort.addEventListener('change', async () => {
    state.sort = els.filterSort.value;
    state.editingTaskId = null;
    await loadTasksCallback();
  });

  els.autoCompleteToggle.addEventListener('change', () => {
    onToggleAutoComplete(els.autoCompleteToggle.checked);
  });

  els.resetFiltersBtn.addEventListener('click', async () => {
    resetAllFilters();
    await loadTasksCallback();
  });

  document.addEventListener('click', (event) => {
    if (!els.categoryFilterDropdown.contains(event.target)) {
      closeCategoryFilterPopover(false);
    }
  });
}
