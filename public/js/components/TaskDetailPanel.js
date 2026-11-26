import { createSvgIcon, setButtonIconLabel } from '../core/icons.js';
import { state } from '../core/state.js';
import { createCategoryBadge } from '../core/ui-shared.js';
import { renderFormattedDescription } from '../core/utils.js';

export function createTaskDetailPanel(task, handlers) {
  const {
    onUpdateTask,
    onAddSubtask,
    onToggleSubtask,
    onDeleteSubtask,
    onRenderTasks,
    onClearTaskError,
  } = handlers;

  const panel = document.createElement('div');
  panel.className = 'task-detail-panel';

  if (task.categories && task.categories.length > 0) {
    const catSection = document.createElement('div');
    catSection.className = 'detail-section';
    const catTitle = document.createElement('h3');
    catTitle.className = 'detail-section-title';
    catTitle.textContent = `Kategori (${task.categories.length})`;
    const catRow = document.createElement('div');
    catRow.className = 'detail-categories-row';
    for (const cat of task.categories) {
      catRow.appendChild(createCategoryBadge(cat));
    }
    catSection.append(catTitle, catRow);
    panel.appendChild(catSection);
  }

  // Description section
  const descSection = document.createElement('div');
  descSection.className = 'detail-section';

  const descHeader = document.createElement('div');
  descHeader.className = 'detail-section-header';

  const descTitle = document.createElement('h3');
  descTitle.className = 'detail-section-title';
  descTitle.textContent = 'Deskripsi Tugas';
  descHeader.appendChild(descTitle);

  if (state.editingDescTaskId !== task.id) {
    const editDescBtn = document.createElement('button');
    editDescBtn.type = 'button';
    editDescBtn.className = 'btn btn-ghost btn-xs btn-icon-inline';
    setButtonIconLabel(
      editDescBtn,
      task.description ? 'pencil' : 'plus',
      task.description ? 'Edit Deskripsi' : 'Tambah Deskripsi'
    );
    editDescBtn.addEventListener('click', () => {
      state.editingDescTaskId = task.id;
      onClearTaskError();
      onRenderTasks();
    });
    descHeader.appendChild(editDescBtn);
  }

  descSection.appendChild(descHeader);

  if (state.editingDescTaskId === task.id) {
    const descForm = document.createElement('form');
    descForm.className = 'desc-edit-form';

    const textarea = document.createElement('textarea');
    textarea.rows = 3;
    textarea.maxLength = 2000;
    textarea.value = task.description || '';
    textarea.placeholder = 'Tulis catatan konteks, tautan https://..., atau poin (- langkah)...';
    textarea.setAttribute('aria-label', 'Edit deskripsi tugas');

    const descActions = document.createElement('div');
    descActions.className = 'desc-edit-actions';

    const cancelDescBtn = document.createElement('button');
    cancelDescBtn.type = 'button';
    cancelDescBtn.className = 'btn btn-ghost btn-xs';
    cancelDescBtn.textContent = 'Batal';
    cancelDescBtn.addEventListener('click', () => {
      state.editingDescTaskId = null;
      onRenderTasks();
    });

    const saveDescBtn = document.createElement('button');
    saveDescBtn.type = 'submit';
    saveDescBtn.className = 'btn btn-primary btn-xs';
    saveDescBtn.textContent = 'Simpan Deskripsi';

    descForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      await onUpdateTask(task.id, { description: textarea.value || null });
    });

    descActions.append(cancelDescBtn, saveDescBtn);
    descForm.append(textarea, descActions);
    descSection.appendChild(descForm);

    queueMicrotask(() => {
      textarea.focus();
    });
  } else if (task.description) {
    const descContent = document.createElement('div');
    descContent.className = 'task-desc-content';
    renderFormattedDescription(descContent, task.description);
    descSection.appendChild(descContent);
  } else {
    const emptyDesc = document.createElement('p');
    emptyDesc.className = 'task-desc-empty';
    emptyDesc.textContent = 'Belum ada deskripsi.';
    descSection.appendChild(emptyDesc);
  }

  panel.appendChild(descSection);

  // Subtasks section
  const subSection = document.createElement('div');
  subSection.className = 'detail-section';

  const subHeader = document.createElement('div');
  subHeader.className = 'detail-section-header';

  const subTitle = document.createElement('h3');
  subTitle.className = 'detail-section-title';
  const stats = task.subtask_stats || { total: 0, completed: 0, percent: 0 };
  subTitle.textContent =
    stats.total > 0 ? `Sub-Tugas (${stats.completed}/${stats.total})` : 'Sub-Tugas';
  subHeader.appendChild(subTitle);
  subSection.appendChild(subHeader);

  if (task.subtasks && task.subtasks.length > 0) {
    const subList = document.createElement('ul');
    subList.className = 'subtask-list';

    for (const subtask of task.subtasks) {
      const subLi = document.createElement('li');
      subLi.className = `subtask-item${subtask.completed ? ' is-completed' : ''}`;

      const label = document.createElement('label');
      label.className = 'subtask-label';

      const subCheckbox = document.createElement('input');
      subCheckbox.type = 'checkbox';
      subCheckbox.className = 'subtask-checkbox';
      subCheckbox.checked = subtask.completed;
      subCheckbox.setAttribute('aria-label', `Tandai sub-tugas "${subtask.title}" selesai`);
      subCheckbox.addEventListener('change', () => {
        onToggleSubtask(task.id, subtask.id, subCheckbox.checked);
      });

      const subText = document.createElement('span');
      subText.className = 'subtask-title';
      subText.textContent = subtask.title;

      label.append(subCheckbox, subText);

      const subDeleteBtn = document.createElement('button');
      subDeleteBtn.type = 'button';
      subDeleteBtn.className = 'subtask-delete-btn';
      subDeleteBtn.appendChild(createSvgIcon('x', 14));
      subDeleteBtn.title = 'Hapus sub-tugas';
      subDeleteBtn.setAttribute('aria-label', `Hapus sub-tugas "${subtask.title}"`);
      subDeleteBtn.addEventListener('click', () => {
        onDeleteSubtask(task.id, subtask.id);
      });

      subLi.append(label, subDeleteBtn);
      subList.appendChild(subLi);
    }

    subSection.appendChild(subList);
  }

  const subAddForm = document.createElement('form');
  subAddForm.className = 'subtask-add-form';

  const subInput = document.createElement('input');
  subInput.type = 'text';
  subInput.className = 'subtask-add-input';
  subInput.maxLength = 200;
  subInput.placeholder = 'Tambah langkah sub-tugas lalu tekan Enter...';
  subInput.setAttribute('aria-label', 'Tambah sub-tugas baru');

  const subAddBtn = document.createElement('button');
  subAddBtn.type = 'submit';
  subAddBtn.className = 'btn btn-ghost btn-xs btn-icon-inline';
  setButtonIconLabel(subAddBtn, 'plus', 'Langkah');

  subAddForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const title = subInput.value.trim();
    if (!title) {
      subInput.focus();
      return;
    }
    await onAddSubtask(task.id, title);
  });

  subAddForm.append(subInput, subAddBtn);
  subSection.appendChild(subAddForm);
  panel.appendChild(subSection);

  return panel;
}
