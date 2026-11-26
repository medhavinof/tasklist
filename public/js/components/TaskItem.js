import { createSvgIcon, setButtonIconLabel } from '../core/icons.js';
import { PRIORITY_LABELS, state } from '../core/state.js';
import { createCategoryBadge, renderCategoryPicker } from '../core/ui-shared.js';
import { formatDueBadge, isImeComposing } from '../core/utils.js';
import { createTaskDetailPanel } from './TaskDetailPanel.js';

export function createTaskItemElement(task, handlers) {
  const {
    onToggleExpanded,
    onUpdateTask,
    onDeleteTask,
    onRenderTasks,
    onShowTaskError,
    onClearTaskError,
  } = handlers;

  const li = document.createElement('li');
  li.className = `task-item${task.completed ? ' is-completed' : ''}`;
  li.dataset.taskId = String(task.id);

  if (state.editingTaskId === task.id) {
    const form = document.createElement('form');
    form.className = 'task-edit-form';

    const row = document.createElement('div');
    row.className = 'task-edit-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'task-edit-input';
    input.value = task.title;
    input.maxLength = 200;
    input.setAttribute('aria-label', 'Edit judul tugas');

    const saveBtn = document.createElement('button');
    saveBtn.type = 'submit';
    saveBtn.className = 'btn btn-primary btn-sm';
    saveBtn.textContent = 'Simpan';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-ghost btn-sm';
    cancelBtn.textContent = 'Batal';
    cancelBtn.addEventListener('click', () => {
      state.editingTaskId = null;
      onClearTaskError();
      onRenderTasks();
    });

    row.append(input, saveBtn, cancelBtn);

    const metaRow = document.createElement('div');
    metaRow.className = 'task-edit-meta';

    const prioritySelect = document.createElement('select');
    prioritySelect.setAttribute('aria-label', 'Edit prioritas tugas');
    for (const [val, label] of [
      ['high', 'Tinggi'],
      ['medium', 'Sedang'],
      ['low', 'Rendah'],
    ]) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = label;
      prioritySelect.appendChild(opt);
    }
    prioritySelect.value = task.priority || 'medium';

    const dueInput = document.createElement('input');
    dueInput.type = 'datetime-local';
    dueInput.value = task.due_at || '';
    dueInput.setAttribute('aria-label', 'Edit tenggat waktu tugas');

    metaRow.append(prioritySelect, dueInput);

    const editCatIds = new Set((task.categories || []).map((c) => c.id));
    const editCatPicker = document.createElement('div');
    editCatPicker.className = 'category-picker';
    editCatPicker.setAttribute('role', 'group');
    editCatPicker.setAttribute('aria-label', 'Edit kategori tugas');
    renderCategoryPicker(editCatPicker, editCatIds);

    const handleEscape = (event) => {
      if (isImeComposing(event)) {
        return;
      }
      if (event.key === 'Escape') {
        state.editingTaskId = null;
        onClearTaskError();
        onRenderTasks();
      }
    };
    input.addEventListener('keydown', handleEscape);
    dueInput.addEventListener('keydown', handleEscape);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const nextTitle = input.value.trim();
      if (!nextTitle) {
        onShowTaskError('Judul tugas tidak boleh kosong.');
        input.focus();
        return;
      }

      await onUpdateTask(task.id, {
        title: nextTitle,
        priority: prioritySelect.value,
        category_ids: [...editCatIds],
        due_at: dueInput.value || null,
      });
    });

    form.append(row, metaRow, editCatPicker);
    li.appendChild(form);

    queueMicrotask(() => {
      input.focus();
      input.select();
    });

    return li;
  }

  const row = document.createElement('div');
  row.className = 'task-row';

  const main = document.createElement('div');
  main.className = 'task-main';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'task-checkbox';
  checkbox.checked = task.completed;
  checkbox.setAttribute('aria-label', `Tandai "${task.title}" selesai`);
  checkbox.addEventListener('change', () => {
    onUpdateTask(task.id, { completed: checkbox.checked });
  });

  const isExpanded = state.expandedTaskIds.has(task.id);
  const content = document.createElement('div');
  content.className = 'task-content';
  content.setAttribute('role', 'button');
  content.setAttribute('tabindex', '0');
  content.setAttribute('aria-expanded', String(isExpanded));
  content.title = 'Klik untuk membuka atau menutup detail tugas';
  content.addEventListener('click', () => {
    onToggleExpanded(task.id);
  });
  content.addEventListener('keydown', (event) => {
    if (isImeComposing(event)) {
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onToggleExpanded(task.id);
    }
  });

  const titleSpan = document.createElement('span');
  titleSpan.className = 'task-title';
  titleSpan.textContent = task.title;
  content.appendChild(titleSpan);

  const stats = task.subtask_stats;
  if (stats && stats.total > 0) {
    const progressWrap = document.createElement('div');
    progressWrap.className = 'task-progress';

    const track = document.createElement('div');
    track.className = 'task-progress-track';
    track.setAttribute('aria-hidden', 'true');

    const fill = document.createElement('div');
    fill.className = `task-progress-fill${stats.percent === 100 ? ' is-complete' : ''}`;
    fill.style.width = `${stats.percent}%`;
    track.appendChild(fill);

    const progressText = document.createElement('span');
    progressText.className = `task-progress-text${stats.percent === 100 ? ' is-complete' : ''}`;
    progressText.textContent = `${stats.completed}/${stats.total} · ${stats.percent}%`;

    progressWrap.append(track, progressText);
    content.appendChild(progressWrap);
  }

  const meta = document.createElement('div');
  meta.className = 'task-meta';

  const priorityBadge = document.createElement('span');
  const priority = task.priority || 'medium';
  priorityBadge.className = `badge badge-priority-${priority}`;
  priorityBadge.textContent = `Prioritas: ${PRIORITY_LABELS[priority] || 'Sedang'}`;
  meta.appendChild(priorityBadge);

  const taskCategories = task.categories || [];
  const visibleCats = taskCategories.slice(0, 2);
  const hiddenCats = taskCategories.slice(2);
  for (const cat of visibleCats) {
    meta.appendChild(createCategoryBadge(cat));
  }
  if (hiddenCats.length > 0) {
    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'badge-more-cats';
    moreBtn.textContent = `+${hiddenCats.length}`;
    const hiddenNames = hiddenCats.map((c) => c.name).join(', ');
    moreBtn.title = `Kategori lainnya: ${hiddenNames}`;
    moreBtn.setAttribute('aria-label', `Tampilkan ${hiddenCats.length} kategori lainnya: ${hiddenNames}`);
    moreBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      state.expandedTaskIds.add(task.id);
      onRenderTasks();
    });
    meta.appendChild(moreBtn);
  }

  const dueInfo = formatDueBadge(task.due_at, task.completed);
  if (dueInfo) {
    const dueBadge = document.createElement('span');
    dueBadge.className = `badge badge-due${dueInfo.tone !== 'normal' ? ` badge-due-${dueInfo.tone}` : ''}`;
    dueBadge.textContent = dueInfo.text;
    meta.appendChild(dueBadge);
  }

  if (task.description) {
    const notesBadge = document.createElement('span');
    notesBadge.className = 'badge badge-notes';
    notesBadge.append(createSvgIcon('file-text', 12), document.createTextNode('Catatan'));
    meta.appendChild(notesBadge);
  }

  content.appendChild(meta);
  main.append(checkbox, content);

  const actions = document.createElement('div');
  actions.className = 'task-actions';

  const detailBtn = document.createElement('button');
  detailBtn.type = 'button';
  detailBtn.className = `btn btn-ghost btn-sm btn-icon-inline btn-detail-toggle${isExpanded ? ' is-open' : ''}`;
  setButtonIconLabel(
    detailBtn,
    isExpanded ? 'chevron-up' : 'chevron-down',
    isExpanded ? 'Tutup' : 'Detail',
    true
  );
  detailBtn.setAttribute('aria-expanded', String(isExpanded));
  detailBtn.setAttribute('aria-label', `Detail tugas "${task.title}"`);
  detailBtn.addEventListener('click', () => {
    onToggleExpanded(task.id);
  });

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'btn btn-ghost btn-sm btn-icon-inline';
  setButtonIconLabel(editBtn, 'pencil', 'Edit');
  editBtn.setAttribute('aria-label', `Edit tugas "${task.title}"`);
  editBtn.addEventListener('click', () => {
    state.editingTaskId = task.id;
    onClearTaskError();
    onRenderTasks();
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'btn btn-danger-ghost btn-sm btn-icon-inline';
  setButtonIconLabel(deleteBtn, 'trash', 'Hapus');
  deleteBtn.setAttribute('aria-label', `Hapus tugas "${task.title}"`);
  deleteBtn.addEventListener('click', () => {
    onDeleteTask(task.id);
  });

  actions.append(detailBtn, editBtn, deleteBtn);
  row.append(main, actions);
  li.appendChild(row);

  if (isExpanded) {
    li.appendChild(createTaskDetailPanel(task, handlers));
  }

  return li;
}
