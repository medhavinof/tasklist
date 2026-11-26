import { createSvgIcon, setButtonIconLabel } from '../core/icons.js';
import { resetAllFilters, state } from '../core/state.js';

const els = {
  toggleDashboardBtn: document.getElementById('toggle-dashboard-btn'),
  dashboardBody: document.getElementById('dashboard-body'),
  dashProgressPct: document.getElementById('dash-progress-pct'),
  dashProgressText: document.getElementById('dash-progress-text'),
  dashProgressBar: document.getElementById('dash-progress-bar'),
  dashDueToday: document.getElementById('dash-due-today'),
  dashOverdue: document.getElementById('dash-overdue'),
  dashHighPriority: document.getElementById('dash-high-priority'),
  dashActionButtons: document.querySelectorAll('[data-dash-action]'),
  dashboardCategories: document.getElementById('dashboard-categories'),
};

let loadTasksCallback = null;

export function renderDashboard() {
  const { summary } = state;
  els.dashboardBody.hidden = state.dashboardCollapsed;
  setButtonIconLabel(
    els.toggleDashboardBtn,
    state.dashboardCollapsed ? 'chevron-down' : 'chevron-up',
    state.dashboardCollapsed ? 'Tampilkan' : 'Sembunyikan',
    true
  );

  els.dashProgressPct.textContent = `${summary.completionRate}%`;
  els.dashProgressText.textContent = `${summary.completed} / ${summary.total}`;
  els.dashProgressBar.style.width = `${summary.completionRate}%`;

  els.dashDueToday.textContent = String(summary.dueToday);
  els.dashOverdue.textContent = String(summary.overdue);
  els.dashHighPriority.textContent = String(summary.highPriority);

  els.dashActionButtons.forEach((btn) => {
    const action = btn.dataset.dashAction;
    if (action === 'overdue') {
      btn.classList.toggle('has-items', summary.overdue > 0);
      btn.classList.toggle('is-active', state.dueFilter === 'overdue');
    } else if (action === 'today') {
      btn.classList.toggle('is-active', state.dueFilter === 'today');
    } else if (action === 'high') {
      btn.classList.toggle('has-items', summary.highPriority > 0);
      btn.classList.toggle(
        'is-active',
        state.priorityFilter === 'high' && state.dueFilter === 'all'
      );
    } else if (action === 'all') {
      const isDefaultView =
        state.statusFilter === 'all' &&
        state.priorityFilter === 'all' &&
        state.selectedCategoryIds.length === 0 &&
        !state.filterUncategorized &&
        state.dueFilter === 'all';
      btn.classList.toggle('is-active', isDefaultView);
    }
  });

  els.dashboardCategories.innerHTML = '';
  if (summary.byCategory.length === 0) {
    els.dashboardCategories.hidden = true;
    return;
  }

  els.dashboardCategories.hidden = false;
  for (const cat of summary.byCategory) {
    const isSelected = state.selectedCategoryIds.includes(cat.id);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `dash-cat-chip cat-color-${cat.color || 'indigo'}${isSelected ? ' is-active' : ''}`;

    const nameSpan = document.createElement('span');
    nameSpan.textContent = cat.name;

    const countSpan = document.createElement('span');
    countSpan.className = 'dash-cat-count';
    countSpan.textContent = `${cat.active} aktif / ${cat.total}`;

    chip.append(createSvgIcon(cat.icon || 'tag', 13), nameSpan, countSpan);
    chip.addEventListener('click', async () => {
      state.filterUncategorized = false;
      if (state.selectedCategoryIds.includes(cat.id)) {
        state.selectedCategoryIds = state.selectedCategoryIds.filter((id) => id !== cat.id);
      } else {
        state.selectedCategoryIds.push(cat.id);
      }
      state.editingTaskId = null;
      await loadTasksCallback();
    });

    els.dashboardCategories.appendChild(chip);
  }
}

export function initDashboardPanel({ onTasksChanged, onClearTaskError }) {
  loadTasksCallback = onTasksChanged;

  els.toggleDashboardBtn.addEventListener('click', () => {
    state.dashboardCollapsed = !state.dashboardCollapsed;
    renderDashboard();
  });

  els.dashActionButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.dashAction;
      state.editingTaskId = null;
      onClearTaskError();

      if (action === 'all') {
        resetAllFilters();
      } else if (action === 'today') {
        if (state.dueFilter === 'today') {
          state.dueFilter = 'all';
        } else {
          state.statusFilter = 'active';
          state.dueFilter = 'today';
          state.priorityFilter = 'all';
        }
      } else if (action === 'overdue') {
        if (state.dueFilter === 'overdue') {
          state.dueFilter = 'all';
        } else {
          state.statusFilter = 'active';
          state.dueFilter = 'overdue';
          state.priorityFilter = 'all';
        }
      } else if (action === 'high') {
        if (state.priorityFilter === 'high' && state.dueFilter === 'all') {
          state.priorityFilter = 'all';
        } else {
          state.statusFilter = 'active';
          state.priorityFilter = 'high';
          state.dueFilter = 'all';
        }
      }

      await loadTasksCallback();
    });
  });
}
