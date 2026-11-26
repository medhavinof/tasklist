import { createSvgIcon } from './icons.js';
import { CATEGORY_COLORS, CATEGORY_ICONS, EMOJI_PRESETS, state } from './state.js';

export function renderEmojiPresets(container, selectedAvatar, onSelect) {
  container.innerHTML = '';
  for (const emoji of EMOJI_PRESETS) {
    const val = `emoji:${emoji}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `emoji-btn${selectedAvatar === val ? ' is-active' : ''}`;
    btn.textContent = emoji;
    btn.title = `Pilih avatar ${emoji}`;
    btn.setAttribute('aria-pressed', String(selectedAvatar === val));
    btn.addEventListener('click', () => onSelect(val));
    container.appendChild(btn);
  }
}

export function createCategoryBadge(cat) {
  const badge = document.createElement('span');
  const color = cat.color || 'indigo';
  const icon = cat.icon || 'tag';
  badge.className = `badge badge-cat-themed cat-color-${color}`;
  badge.append(createSvgIcon(icon, 12), document.createTextNode(cat.name));
  return badge;
}

export function renderCategoryPicker(container, selectedIdsSet, onChange) {
  container.innerHTML = '';
  if (state.categories.length === 0) {
    const emptyHint = document.createElement('span');
    emptyHint.className = 'field-hint';
    emptyHint.textContent = 'Belum ada kategori. Klik "Kelola Kategori" untuk membuat.';
    container.appendChild(emptyHint);
    return;
  }

  for (const cat of state.categories) {
    const isSelected = selectedIdsSet.has(cat.id);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `category-pick-chip cat-color-${cat.color || 'indigo'}${isSelected ? ' is-selected' : ''}`;
    chip.setAttribute('aria-pressed', String(isSelected));
    chip.append(createSvgIcon(cat.icon || 'tag', 13), document.createTextNode(cat.name));
    chip.addEventListener('click', () => {
      if (selectedIdsSet.has(cat.id)) {
        selectedIdsSet.delete(cat.id);
      } else {
        selectedIdsSet.add(cat.id);
      }
      renderCategoryPicker(container, selectedIdsSet, onChange);
      if (onChange) {
        onChange();
      }
    });
    container.appendChild(chip);
  }
}

export function renderColorSwatches(container, selectedColor, onSelect) {
  container.innerHTML = '';
  for (const color of CATEGORY_COLORS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `cat-color-swatch cat-color-${color}${selectedColor === color ? ' is-selected' : ''}`;
    btn.title = `Warna ${color}`;
    btn.setAttribute('aria-label', `Pilih warna ${color}`);
    btn.setAttribute('aria-pressed', String(selectedColor === color));
    btn.addEventListener('click', () => onSelect(color));
    container.appendChild(btn);
  }
}

export function renderIconPicker(container, selectedIcon, onSelect) {
  container.innerHTML = '';
  for (const icon of CATEGORY_ICONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `cat-icon-btn${selectedIcon === icon ? ' is-selected' : ''}`;
    btn.title = `Ikon ${icon}`;
    btn.setAttribute('aria-label', `Pilih ikon ${icon}`);
    btn.setAttribute('aria-pressed', String(selectedIcon === icon));
    btn.appendChild(createSvgIcon(icon, 15));
    btn.addEventListener('click', () => onSelect(icon));
    container.appendChild(btn);
  }
}
