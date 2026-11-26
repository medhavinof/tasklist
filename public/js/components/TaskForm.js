import { apiRequest } from '../core/api.js';
import { setButtonIconLabel } from '../core/icons.js';
import { state } from '../core/state.js';
import { renderCategoryPicker } from '../core/ui-shared.js';
import { showMessage } from '../core/utils.js';

const els = {
  addTaskForm: document.getElementById('add-task-form'),
  newTaskInput: document.getElementById('new-task-input'),
  toggleNewDescBtn: document.getElementById('toggle-new-desc-btn'),
  newDescBox: document.getElementById('new-desc-box'),
  newTaskDescription: document.getElementById('new-task-description'),
  newTaskPriority: document.getElementById('new-task-priority'),
  newTaskDue: document.getElementById('new-task-due'),
  clearNewDueBtn: document.getElementById('clear-new-due-btn'),
  newTaskCategoriesPicker: document.getElementById('new-task-categories-picker'),
  openCategoriesBtn: document.getElementById('open-categories-btn'),
  taskError: document.getElementById('task-error'),
};

export function renderTaskFormCategories() {
  const validIds = new Set(state.categories.map((c) => c.id));
  for (const id of [...state.newTaskCategoryIds]) {
    if (!validIds.has(id)) {
      state.newTaskCategoryIds.delete(id);
    }
  }
  renderCategoryPicker(els.newTaskCategoriesPicker, state.newTaskCategoryIds);
}

export function focusNewTaskInput() {
  els.newTaskInput.focus();
}

export function clearTaskError() {
  showMessage(els.taskError, '');
}

export function showTaskError(message) {
  showMessage(els.taskError, message);
}

export function initTaskForm({ onTasksChanged, onOpenCategories, onSessionExpired }) {
  els.newTaskInput.addEventListener('input', () => showMessage(els.taskError, ''));

  els.toggleNewDescBtn.addEventListener('click', () => {
    const willShow = els.newDescBox.hidden;
    els.newDescBox.hidden = !willShow;
    setButtonIconLabel(els.toggleNewDescBtn, willShow ? 'minus' : 'plus', 'Deskripsi');
    if (willShow) {
      els.newTaskDescription.focus();
    }
  });

  els.newTaskDue.addEventListener('change', () => {
    els.clearNewDueBtn.hidden = !els.newTaskDue.value;
  });

  els.clearNewDueBtn.addEventListener('click', () => {
    els.newTaskDue.value = '';
    els.clearNewDueBtn.hidden = true;
  });

  els.openCategoriesBtn.addEventListener('click', onOpenCategories);

  els.addTaskForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage(els.taskError, '');

    const title = els.newTaskInput.value.trim();
    if (!title) {
      showMessage(els.taskError, 'Judul tugas tidak boleh kosong.');
      els.newTaskInput.focus();
      return;
    }

    try {
      await apiRequest('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title,
          description: els.newTaskDescription.value || null,
          priority: els.newTaskPriority.value,
          category_ids: [...state.newTaskCategoryIds],
          due_at: els.newTaskDue.value || null,
        }),
      });
      els.newTaskInput.value = '';
      els.newTaskDescription.value = '';
      els.newDescBox.hidden = true;
      setButtonIconLabel(els.toggleNewDescBtn, 'plus', 'Deskripsi');
      els.newTaskDue.value = '';
      els.clearNewDueBtn.hidden = true;
      els.newTaskPriority.value = 'medium';
      state.newTaskCategoryIds.clear();
      if (state.statusFilter === 'completed') {
        state.statusFilter = 'all';
      }
      await onTasksChanged();
      els.newTaskInput.focus();
    } catch (err) {
      if (err.status === 401) {
        onSessionExpired();
        return;
      }
      showMessage(els.taskError, err.message);
    }
  });
}
