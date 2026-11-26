import { apiRequest } from '../core/api.js';
import { setButtonIconLabel } from '../core/icons.js';
import { state } from '../core/state.js';
import { createCategoryBadge, renderColorSwatches, renderIconPicker } from '../core/ui-shared.js';
import { showMessage } from '../core/utils.js';

const els = {
  categoriesModal: document.getElementById('categories-modal'),
  closeCategoriesBtn: document.getElementById('close-categories-btn'),
  catModalError: document.getElementById('cat-modal-error'),
  catModalSuccess: document.getElementById('cat-modal-success'),
  createCategoryForm: document.getElementById('create-category-form'),
  catCreateName: document.getElementById('cat-create-name'),
  catCreateColors: document.getElementById('cat-create-colors'),
  catCreateIcons: document.getElementById('cat-create-icons'),
  manageCategoriesList: document.getElementById('manage-categories-list'),
};

let onCategoriesChangedCallback = null;

export function isCategoriesModalOpen() {
  return !els.categoriesModal.hidden;
}

function renderCreateCategoryStylePickers() {
  renderColorSwatches(els.catCreateColors, state.createCategoryColor, (color) => {
    state.createCategoryColor = color;
    renderCreateCategoryStylePickers();
  });
  renderIconPicker(els.catCreateIcons, state.createCategoryIcon, (icon) => {
    state.createCategoryIcon = icon;
    renderCreateCategoryStylePickers();
  });
}

function renderManageCategoriesList() {
  els.manageCategoriesList.innerHTML = '';
  if (state.categories.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'field-hint';
    empty.textContent = 'Belum ada kategori pada profil ini.';
    els.manageCategoriesList.appendChild(empty);
    return;
  }

  for (const cat of state.categories) {
    const li = document.createElement('li');
    li.className = 'manage-cat-item';

    if (state.editingCategoryId === cat.id) {
      const form = document.createElement('form');
      form.className = 'settings-form';

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.maxLength = 32;
      nameInput.value = cat.name;
      nameInput.setAttribute('aria-label', 'Edit nama kategori');

      const styleGrid = document.createElement('div');
      styleGrid.className = 'cat-style-grid';

      const colorBox = document.createElement('div');
      colorBox.className = 'cat-color-row';
      const iconBox = document.createElement('div');
      iconBox.className = 'cat-icon-row';

      const refreshEditPickers = () => {
        renderColorSwatches(colorBox, state.editCategoryColor, (color) => {
          state.editCategoryColor = color;
          refreshEditPickers();
        });
        renderIconPicker(iconBox, state.editCategoryIcon, (icon) => {
          state.editCategoryIcon = icon;
          refreshEditPickers();
        });
      };
      refreshEditPickers();

      styleGrid.append(colorBox, iconBox);

      const btnRow = document.createElement('div');
      btnRow.className = 'desc-edit-actions';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn btn-ghost btn-xs';
      cancelBtn.textContent = 'Batal';
      cancelBtn.addEventListener('click', () => {
        state.editingCategoryId = null;
        renderManageCategoriesList();
      });

      const saveBtn = document.createElement('button');
      saveBtn.type = 'submit';
      saveBtn.className = 'btn btn-primary btn-xs';
      saveBtn.textContent = 'Simpan';

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const nextName = nameInput.value.trim();
        if (!nextName) {
          showMessage(els.catModalError, 'Nama kategori tidak boleh kosong.');
          nameInput.focus();
          return;
        }
        try {
          showMessage(els.catModalError, '');
          const data = await apiRequest(`/api/categories/${cat.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              name: nextName,
              color: state.editCategoryColor,
              icon: state.editCategoryIcon,
            }),
          });
          state.categories = data.categories;
          state.editingCategoryId = null;
          renderManageCategoriesList();
          await onCategoriesChangedCallback();
          showMessage(els.catModalSuccess, 'Kategori diperbarui.');
        } catch (err) {
          showMessage(els.catModalError, err.message);
        }
      });

      btnRow.append(cancelBtn, saveBtn);
      form.append(nameInput, styleGrid, btnRow);
      li.appendChild(form);
    } else {
      const row = document.createElement('div');
      row.className = 'manage-cat-row';

      const badge = createCategoryBadge(cat);

      const actions = document.createElement('div');
      actions.className = 'manage-cat-actions';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn btn-ghost btn-xs btn-icon-inline';
      setButtonIconLabel(editBtn, 'pencil', 'Edit');
      editBtn.addEventListener('click', () => {
        state.editingCategoryId = cat.id;
        state.editCategoryColor = cat.color || 'indigo';
        state.editCategoryIcon = cat.icon || 'tag';
        showMessage(els.catModalError, '');
        showMessage(els.catModalSuccess, '');
        renderManageCategoriesList();
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn-danger-ghost btn-xs btn-icon-inline';
      setButtonIconLabel(delBtn, 'trash', 'Hapus');
      delBtn.addEventListener('click', async () => {
        try {
          showMessage(els.catModalError, '');
          await apiRequest(`/api/categories/${cat.id}`, { method: 'DELETE' });
          state.categories = state.categories.filter((c) => c.id !== cat.id);
          state.newTaskCategoryIds.delete(cat.id);
          state.selectedCategoryIds = state.selectedCategoryIds.filter((id) => id !== cat.id);
          renderManageCategoriesList();
          await onCategoriesChangedCallback();
          showMessage(els.catModalSuccess, `Kategori "${cat.name}" dihapus.`);
        } catch (err) {
          showMessage(els.catModalError, err.message);
        }
      });

      actions.append(editBtn, delBtn);
      row.append(badge, actions);
      li.appendChild(row);
    }

    els.manageCategoriesList.appendChild(li);
  }
}

export function openCategoriesModal() {
  if (!state.user) return;
  state.lastCatFocusedElement = document.activeElement;
  state.editingCategoryId = null;
  state.createCategoryColor = 'indigo';
  state.createCategoryIcon = 'tag';
  els.catCreateName.value = '';
  showMessage(els.catModalError, '');
  showMessage(els.catModalSuccess, '');
  renderCreateCategoryStylePickers();
  renderManageCategoriesList();
  els.categoriesModal.hidden = false;
  queueMicrotask(() => {
    els.catCreateName.focus();
  });
}

export function closeCategoriesModal() {
  if (els.categoriesModal.hidden) {
    return;
  }
  els.categoriesModal.hidden = true;
  if (state.lastCatFocusedElement && typeof state.lastCatFocusedElement.focus === 'function') {
    state.lastCatFocusedElement.focus();
    state.lastCatFocusedElement = null;
  }
}

export function initCategoriesModal({ onCategoriesChanged }) {
  onCategoriesChangedCallback = onCategoriesChanged;

  els.catCreateName.addEventListener('input', () => showMessage(els.catModalError, ''));
  els.closeCategoriesBtn.addEventListener('click', closeCategoriesModal);
  els.categoriesModal.addEventListener('click', (event) => {
    if (event.target === els.categoriesModal) {
      closeCategoriesModal();
    }
  });

  els.createCategoryForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage(els.catModalError, '');
    showMessage(els.catModalSuccess, '');

    const name = els.catCreateName.value.trim();
    if (!name) {
      showMessage(els.catModalError, 'Nama kategori tidak boleh kosong.');
      els.catCreateName.focus();
      return;
    }

    try {
      const data = await apiRequest('/api/categories', {
        method: 'POST',
        body: JSON.stringify({
          name,
          color: state.createCategoryColor,
          icon: state.createCategoryIcon,
        }),
      });
      state.categories = data.categories;
      els.catCreateName.value = '';
      renderManageCategoriesList();
      await onCategoriesChangedCallback();
      showMessage(els.catModalSuccess, `Kategori "${data.category.name}" ditambahkan.`);
      els.catCreateName.focus();
    } catch (err) {
      showMessage(els.catModalError, err.message);
    }
  });
}
