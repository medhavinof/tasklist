const express = require('express');
const { requireAuth } = require('./auth');

const CATEGORY_COLORS = [
  'indigo',
  'blue',
  'emerald',
  'rose',
  'amber',
  'violet',
  'cyan',
  'slate',
];

const CATEGORY_ICONS = [
  'tag',
  'briefcase',
  'user',
  'shopping-bag',
  'book',
  'heart',
  'star',
  'zap',
  'home',
];

const VALID_CATEGORY_COLORS = new Set(CATEGORY_COLORS);
const VALID_CATEGORY_ICONS = new Set(CATEGORY_ICONS);

const DEFAULT_CATEGORIES = [
  { name: 'Kerja', color: 'blue', icon: 'briefcase' },
  { name: 'Pribadi', color: 'emerald', icon: 'user' },
  { name: 'Belanja', color: 'amber', icon: 'shopping-bag' },
];

const MAX_CATEGORY_LENGTH = 32;

function validateCategoryName(rawName) {
  if (typeof rawName !== 'string') {
    return { error: 'Nama kategori harus berupa teks.' };
  }

  const trimmed = rawName.trim();
  if (!trimmed) {
    return { error: 'Nama kategori tidak boleh kosong.' };
  }

  if (trimmed.length > MAX_CATEGORY_LENGTH) {
    return { error: `Nama kategori maksimal ${MAX_CATEGORY_LENGTH} karakter.` };
  }

  return { name: trimmed };
}

function validateCategoryColor(rawColor, fallback = 'indigo') {
  if (rawColor === undefined || rawColor === null || rawColor === '') {
    return { color: fallback };
  }
  if (typeof rawColor !== 'string' || !VALID_CATEGORY_COLORS.has(rawColor)) {
    return { error: 'Warna kategori tidak valid.' };
  }
  return { color: rawColor };
}

function validateCategoryIcon(rawIcon, fallback = 'tag') {
  if (rawIcon === undefined || rawIcon === null || rawIcon === '') {
    return { icon: fallback };
  }
  if (typeof rawIcon !== 'string' || !VALID_CATEGORY_ICONS.has(rawIcon)) {
    return { error: 'Ikon kategori tidak valid.' };
  }
  return { icon: rawIcon };
}

function findDefaultPreset(name) {
  const lower = name.toLowerCase();
  return DEFAULT_CATEGORIES.find((item) => item.name.toLowerCase() === lower) || null;
}

function serializeCategory(row) {
  return {
    id: row.id,
    name: row.name,
    color: row.color || 'indigo',
    icon: row.icon || 'tag',
  };
}

/**
 * Seeds starter categories once per local profile so all categories are editable and deletable.
 */
function seedDefaultCategoriesIfNeeded(db, userId) {
  const userRow = db
    .prepare('SELECT categories_seeded FROM users WHERE id = ?')
    .get(userId);

  if (!userRow || userRow.categories_seeded) {
    return;
  }

  const insertStmt = db.prepare(
    'INSERT OR IGNORE INTO categories (user_id, name, color, icon) VALUES (?, ?, ?, ?)'
  );
  for (const preset of DEFAULT_CATEGORIES) {
    insertStmt.run(userId, preset.name, preset.color, preset.icon);
  }
  db.prepare('UPDATE users SET categories_seeded = 1 WHERE id = ?').run(userId);
}

/**
 * Normalizes a category name and persists it if not yet present for the user.
 */
function ensureUserCategory(db, userId, rawName, options = {}) {
  const validation = validateCategoryName(rawName);
  if (validation.error) {
    return validation;
  }

  seedDefaultCategoriesIfNeeded(db, userId);

  const existing = db
    .prepare('SELECT id, name, color, icon FROM categories WHERE user_id = ? AND name = ?')
    .get(userId, validation.name);

  if (existing) {
    return {
      name: existing.name,
      category: serializeCategory(existing),
    };
  }

  const preset = findDefaultPreset(validation.name);
  const color = VALID_CATEGORY_COLORS.has(options.color)
    ? options.color
    : preset?.color || 'indigo';
  const icon = VALID_CATEGORY_ICONS.has(options.icon)
    ? options.icon
    : preset?.icon || 'tag';

  const result = db
    .prepare('INSERT INTO categories (user_id, name, color, icon) VALUES (?, ?, ?, ?)')
    .run(userId, validation.name, color, icon);

  const created = {
    id: Number(result.lastInsertRowid),
    name: validation.name,
    color,
    icon,
  };

  return {
    name: created.name,
    category: created,
  };
}

/**
 * Returns all categories belonging to the local profile.
 */
function listUserCategories(db, userId) {
  seedDefaultCategoriesIfNeeded(db, userId);

  const rows = db
    .prepare('SELECT id, name, color, icon FROM categories WHERE user_id = ? ORDER BY id ASC')
    .all(userId);

  return rows.map(serializeCategory);
}

/**
 * Builds the Express router for listing, creating, updating, and deleting profile categories.
 */
function createCategoriesRouter(db) {
  const router = express.Router();
  router.use(requireAuth(db));

  router.get('/', (req, res) => {
    return res.json({
      categories: listUserCategories(db, req.user.id),
      palette: {
        colors: CATEGORY_COLORS,
        icons: CATEGORY_ICONS,
      },
    });
  });

  router.post('/', (req, res) => {
    seedDefaultCategoriesIfNeeded(db, req.user.id);

    const validation = validateCategoryName(req.body?.name);
    if (validation.error) {
      return res.status(400).json({ error: validation.error });
    }

    const colorValidation = validateCategoryColor(req.body?.color, 'indigo');
    if (colorValidation.error) {
      return res.status(400).json({ error: colorValidation.error });
    }

    const iconValidation = validateCategoryIcon(req.body?.icon, 'tag');
    if (iconValidation.error) {
      return res.status(400).json({ error: iconValidation.error });
    }

    const existing = db
      .prepare('SELECT id FROM categories WHERE user_id = ? AND name = ?')
      .get(req.user.id, validation.name);

    if (existing) {
      return res.status(409).json({ error: 'Kategori dengan nama tersebut sudah ada.' });
    }

    const result = db
      .prepare('INSERT INTO categories (user_id, name, color, icon) VALUES (?, ?, ?, ?)')
      .run(req.user.id, validation.name, colorValidation.color, iconValidation.icon);

    const created = {
      id: Number(result.lastInsertRowid),
      name: validation.name,
      color: colorValidation.color,
      icon: iconValidation.icon,
    };

    return res.status(201).json({
      category: created,
      categories: listUserCategories(db, req.user.id),
    });
  });

  router.patch('/:id', (req, res) => {
    seedDefaultCategoriesIfNeeded(db, req.user.id);

    const categoryId = Number(req.params.id);
    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      return res.status(400).json({ error: 'ID kategori tidak valid.' });
    }

    const existing = db
      .prepare('SELECT id, name, color, icon FROM categories WHERE id = ? AND user_id = ?')
      .get(categoryId, req.user.id);

    if (!existing) {
      return res.status(404).json({ error: 'Kategori tidak ditemukan.' });
    }

    const body = req.body || {};
    const hasName = Object.prototype.hasOwnProperty.call(body, 'name');
    const hasColor = Object.prototype.hasOwnProperty.call(body, 'color');
    const hasIcon = Object.prototype.hasOwnProperty.call(body, 'icon');

    if (!hasName && !hasColor && !hasIcon) {
      return res.status(400).json({ error: 'Tidak ada perubahan kategori yang dikirim.' });
    }

    let nextName = existing.name;
    if (hasName) {
      const nameValidation = validateCategoryName(body.name);
      if (nameValidation.error) {
        return res.status(400).json({ error: nameValidation.error });
      }
      const conflict = db
        .prepare('SELECT id FROM categories WHERE user_id = ? AND name = ? AND id != ?')
        .get(req.user.id, nameValidation.name, categoryId);
      if (conflict) {
        return res.status(409).json({ error: 'Kategori dengan nama tersebut sudah ada.' });
      }
      nextName = nameValidation.name;
    }

    let nextColor = existing.color || 'indigo';
    if (hasColor) {
      const colorValidation = validateCategoryColor(body.color, nextColor);
      if (colorValidation.error) {
        return res.status(400).json({ error: colorValidation.error });
      }
      nextColor = colorValidation.color;
    }

    let nextIcon = existing.icon || 'tag';
    if (hasIcon) {
      const iconValidation = validateCategoryIcon(body.icon, nextIcon);
      if (iconValidation.error) {
        return res.status(400).json({ error: iconValidation.error });
      }
      nextIcon = iconValidation.icon;
    }

    db.prepare('UPDATE categories SET name = ?, color = ?, icon = ? WHERE id = ? AND user_id = ?').run(
      nextName,
      nextColor,
      nextIcon,
      categoryId,
      req.user.id
    );

    const updated = db
      .prepare('SELECT id, name, color, icon FROM categories WHERE id = ? AND user_id = ?')
      .get(categoryId, req.user.id);

    return res.json({
      category: serializeCategory(updated),
      categories: listUserCategories(db, req.user.id),
    });
  });

  router.delete('/:id', (req, res) => {
    seedDefaultCategoriesIfNeeded(db, req.user.id);

    const categoryId = Number(req.params.id);
    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      return res.status(400).json({ error: 'ID kategori tidak valid.' });
    }

    const existing = db
      .prepare('SELECT id, name FROM categories WHERE id = ? AND user_id = ?')
      .get(categoryId, req.user.id);

    if (!existing) {
      return res.status(404).json({ error: 'Kategori tidak ditemukan.' });
    }

    db.prepare(
      'UPDATE tasks SET category = NULL WHERE user_id = ? AND category = ? COLLATE NOCASE'
    ).run(req.user.id, existing.name);
    db.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?').run(
      categoryId,
      req.user.id
    );

    return res.status(204).end();
  });

  return router;
}

module.exports = {
  CATEGORY_COLORS,
  CATEGORY_ICONS,
  DEFAULT_CATEGORIES,
  validateCategoryName,
  seedDefaultCategoriesIfNeeded,
  ensureUserCategory,
  listUserCategories,
  createCategoriesRouter,
};
