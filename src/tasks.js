const express = require('express');
const { requireAuth } = require('./auth');
const {
  seedDefaultCategoriesIfNeeded,
  ensureUserCategory,
  listUserCategories,
} = require('./categories');

const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;
const VALID_STATUSES = new Set(['all', 'active', 'completed']);
const VALID_PRIORITIES = new Set(['low', 'medium', 'high']);
const VALID_DUE_FILTERS = new Set(['all', 'today', 'overdue']);
const VALID_SORTS = new Set(['newest', 'due_asc', 'priority_desc']);
const VALID_CATEGORY_MODES = new Set(['and', 'or']);
const LOCAL_DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function formatLocalDateTime(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function parseLocalDateTime(rawValue) {
  if (typeof rawValue !== 'string') {
    return null;
  }

  const trimmed = rawValue.trim();
  const match = LOCAL_DATETIME_PATTERN.exec(trimmed);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);

  const probe = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    probe.getFullYear() !== year ||
    probe.getMonth() !== month - 1 ||
    probe.getDate() !== day ||
    probe.getHours() !== hour ||
    probe.getMinutes() !== minute
  ) {
    return null;
  }

  return trimmed;
}

function serializeSubtask(row) {
  return {
    id: row.id,
    task_id: row.task_id,
    title: row.title,
    completed: Boolean(row.completed),
    position: row.position,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function computeSubtaskStats(subtasks) {
  const total = subtasks.length;
  const completed = subtasks.filter((item) => item.completed).length;
  return {
    total,
    completed,
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
  };
}

function serializeTask(row, subtaskRows = [], categories = []) {
  const subtasks = subtaskRows.map(serializeSubtask);
  return {
    id: row.id,
    title: row.title,
    description: row.description || null,
    completed: Boolean(row.completed),
    priority: row.priority || 'medium',
    due_at: row.due_at || null,
    category: categories[0]?.name || null,
    categories,
    subtasks,
    subtask_stats: computeSubtaskStats(subtasks),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function validateTitle(rawTitle, label = 'Judul tugas') {
  if (typeof rawTitle !== 'string') {
    return { error: `${label} wajib diisi.` };
  }

  const trimmed = rawTitle.trim();
  if (!trimmed) {
    return { error: `${label} tidak boleh kosong.` };
  }

  if (trimmed.length > MAX_TITLE_LENGTH) {
    return { error: `${label} maksimal ${MAX_TITLE_LENGTH} karakter.` };
  }

  return { title: trimmed };
}

function validateDescription(rawDescription) {
  if (rawDescription === undefined || rawDescription === null) {
    return { description: null };
  }

  if (typeof rawDescription !== 'string') {
    return { error: 'Deskripsi tugas harus berupa teks.' };
  }

  const normalized = rawDescription.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return { description: null };
  }

  if (normalized.length > MAX_DESCRIPTION_LENGTH) {
    return { error: `Deskripsi tugas maksimal ${MAX_DESCRIPTION_LENGTH} karakter.` };
  }

  return { description: normalized };
}

function validatePriority(rawPriority, defaultValue) {
  if (rawPriority === undefined || rawPriority === null || rawPriority === '') {
    if (defaultValue !== undefined) {
      return { priority: defaultValue };
    }
    return { error: 'Prioritas harus berupa low, medium, atau high.' };
  }

  if (typeof rawPriority !== 'string' || !VALID_PRIORITIES.has(rawPriority)) {
    return { error: 'Prioritas harus berupa low, medium, atau high.' };
  }

  return { priority: rawPriority };
}

function validateDueAt(rawDueAt) {
  if (rawDueAt === undefined || rawDueAt === null || rawDueAt === '') {
    return { dueAt: null };
  }

  const parsed = parseLocalDateTime(rawDueAt);
  if (!parsed) {
    return { error: 'Format tenggat waktu tidak valid (gunakan YYYY-MM-DDTHH:mm).' };
  }

  return { dueAt: parsed };
}

function parsePositiveId(rawId) {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  return id;
}

/**
 * Resolves multi-category IDs, category name arrays, or a legacy single category field.
 */
function resolveTaskCategoryIds(db, userId, body) {
  const hasCategoryIds = Object.prototype.hasOwnProperty.call(body, 'category_ids');
  const hasCategories = Object.prototype.hasOwnProperty.call(body, 'categories');
  const hasLegacyCategory = Object.prototype.hasOwnProperty.call(body, 'category');

  if (!hasCategoryIds && !hasCategories && !hasLegacyCategory) {
    return { provided: false, categoryIds: [] };
  }

  seedDefaultCategoriesIfNeeded(db, userId);

  if (hasCategoryIds) {
    if (!Array.isArray(body.category_ids)) {
      return { error: 'category_ids harus berupa array.' };
    }
    const findOwnedCat = db.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?');
    const seen = new Set();
    const resolvedIds = [];
    for (const rawId of body.category_ids) {
      const catId = parsePositiveId(rawId);
      if (!catId) {
        return { error: 'ID kategori tidak valid.' };
      }
      if (seen.has(catId)) {
        continue;
      }
      const found = findOwnedCat.get(catId, userId);
      if (!found) {
        return { error: 'Kategori tidak ditemukan.' };
      }
      seen.add(catId);
      resolvedIds.push(catId);
    }
    return { provided: true, categoryIds: resolvedIds };
  }

  const rawNames = hasCategories
    ? body.categories
    : body.category === null || body.category === ''
      ? []
      : [body.category];

  if (!Array.isArray(rawNames)) {
    return { error: 'categories harus berupa array.' };
  }

  const seen = new Set();
  const resolvedIds = [];
  for (const rawName of rawNames) {
    if (rawName === null || rawName === undefined || String(rawName).trim() === '') {
      continue;
    }
    const ensured = ensureUserCategory(db, userId, rawName);
    if (ensured.error) {
      return { error: ensured.error };
    }
    if (!seen.has(ensured.category.id)) {
      seen.add(ensured.category.id);
      resolvedIds.push(ensured.category.id);
    }
  }

  return { provided: true, categoryIds: resolvedIds };
}

function syncTaskCategories(db, taskId, categoryIds) {
  db.prepare('DELETE FROM task_categories WHERE task_id = ?').run(taskId);
  const insertLinkStmt = db.prepare(
    'INSERT OR IGNORE INTO task_categories (task_id, category_id) VALUES (?, ?)'
  );
  for (const categoryId of categoryIds) {
    insertLinkStmt.run(taskId, categoryId);
  }
}

function getTaskCounts(db, userId) {
  const row = db
    .prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN completed = 0 THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) AS completed
      FROM tasks
      WHERE user_id = ?`
    )
    .get(userId);

  return {
    all: Number(row?.total || 0),
    active: Number(row?.active || 0),
    completed: Number(row?.completed || 0),
  };
}

function getDashboardSummary(db, userId, nowStr) {
  const todayDate = nowStr.slice(0, 10);

  const metrics = db
    .prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN completed = 0 THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN completed = 0 AND due_at IS NOT NULL AND substr(due_at, 1, 10) = ? THEN 1 ELSE 0 END) AS due_today,
        SUM(CASE WHEN completed = 0 AND due_at IS NOT NULL AND due_at < ? THEN 1 ELSE 0 END) AS overdue,
        SUM(CASE WHEN completed = 0 AND priority = 'high' THEN 1 ELSE 0 END) AS high_priority
      FROM tasks
      WHERE user_id = ?`
    )
    .get(todayDate, nowStr, userId);

  const categoryRows = db
    .prepare(
      `SELECT
        c.id,
        c.name,
        c.color,
        c.icon,
        COUNT(t.id) AS total,
        SUM(CASE WHEN t.completed = 0 THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN t.completed = 1 THEN 1 ELSE 0 END) AS completed
      FROM categories c
      JOIN task_categories tc ON tc.category_id = c.id
      JOIN tasks t ON t.id = tc.task_id AND t.user_id = c.user_id
      WHERE c.user_id = ?
      GROUP BY c.id
      ORDER BY active DESC, total DESC, c.name ASC`
    )
    .all(userId);

  const total = Number(metrics?.total || 0);
  const completed = Number(metrics?.completed || 0);

  return {
    total,
    active: Number(metrics?.active || 0),
    completed,
    completionRate: total === 0 ? 0 : Math.round((completed / total) * 100),
    dueToday: Number(metrics?.due_today || 0),
    overdue: Number(metrics?.overdue || 0),
    highPriority: Number(metrics?.high_priority || 0),
    byCategory: categoryRows.map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color || 'indigo',
      icon: row.icon || 'tag',
      total: Number(row.total || 0),
      active: Number(row.active || 0),
      completed: Number(row.completed || 0),
    })),
  };
}

function resolveSortOrderClause(sort) {
  if (sort === 'due_asc') {
    return 'completed ASC, CASE WHEN due_at IS NULL THEN 1 ELSE 0 END ASC, due_at ASC, id DESC';
  }
  if (sort === 'priority_desc') {
    return "completed ASC, CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END ASC, CASE WHEN due_at IS NULL THEN 1 ELSE 0 END ASC, due_at ASC, id DESC";
  }
  return 'id DESC';
}

function syncParentCompletionFromSubtasks(db, taskId, userId, autoCompleteEnabled) {
  if (!autoCompleteEnabled) {
    return;
  }

  const stats = db
    .prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) AS completed_count
      FROM subtasks
      WHERE task_id = ? AND user_id = ?`
    )
    .get(taskId, userId);

  const total = Number(stats?.total || 0);
  const completedCount = Number(stats?.completed_count || 0);

  if (total === 0) {
    return;
  }

  const nextCompleted = completedCount === total ? 1 : 0;
  db.prepare(
    "UPDATE tasks SET completed = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ? AND completed != ?"
  ).run(nextCompleted, taskId, userId, nextCompleted);
}

/**
 * Builds the Express router for user-scoped task CRUD, multi-category assignment, filtering, and subtasks.
 */
function createTasksRouter(db) {
  const router = express.Router();
  router.use(requireAuth(db));

  const findTaskStmt = db.prepare(
    'SELECT id, title, description, completed, priority, due_at, created_at, updated_at FROM tasks WHERE id = ? AND user_id = ?'
  );
  const insertTaskStmt = db.prepare(
    'INSERT INTO tasks (user_id, title, description, priority, due_at) VALUES (?, ?, ?, ?, ?)'
  );
  const updateTaskStmt = db.prepare(
    "UPDATE tasks SET title = ?, description = ?, completed = ?, priority = ?, due_at = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?"
  );
  const deleteTaskStmt = db.prepare(
    'DELETE FROM tasks WHERE id = ? AND user_id = ?'
  );

  const listAllUserSubtasksStmt = db.prepare(
    'SELECT id, task_id, title, completed, position, created_at, updated_at FROM subtasks WHERE user_id = ? ORDER BY position ASC, id ASC'
  );
  const listTaskSubtasksStmt = db.prepare(
    'SELECT id, task_id, title, completed, position, created_at, updated_at FROM subtasks WHERE task_id = ? AND user_id = ? ORDER BY position ASC, id ASC'
  );
  const listAllUserTaskCategoriesStmt = db.prepare(
    `SELECT tc.task_id, c.id, c.name, c.color, c.icon
     FROM task_categories tc
     JOIN categories c ON c.id = tc.category_id
     WHERE c.user_id = ?
     ORDER BY c.id ASC`
  );
  const listTaskCategoriesStmt = db.prepare(
    `SELECT c.id, c.name, c.color, c.icon
     FROM task_categories tc
     JOIN categories c ON c.id = tc.category_id
     WHERE tc.task_id = ? AND c.user_id = ?
     ORDER BY c.id ASC`
  );
  const findSubtaskStmt = db.prepare(
    'SELECT id, task_id, title, completed, position, created_at, updated_at FROM subtasks WHERE id = ? AND task_id = ? AND user_id = ?'
  );
  const nextSubtaskPositionStmt = db.prepare(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM subtasks WHERE task_id = ? AND user_id = ?'
  );
  const insertSubtaskStmt = db.prepare(
    'INSERT INTO subtasks (task_id, user_id, title, position) VALUES (?, ?, ?, ?)'
  );
  const updateSubtaskStmt = db.prepare(
    "UPDATE subtasks SET title = ?, completed = ?, updated_at = datetime('now') WHERE id = ? AND task_id = ? AND user_id = ?"
  );
  const deleteSubtaskStmt = db.prepare(
    'DELETE FROM subtasks WHERE id = ? AND task_id = ? AND user_id = ?'
  );
  const completeAllSubtasksStmt = db.prepare(
    "UPDATE subtasks SET completed = 1, updated_at = datetime('now') WHERE task_id = ? AND user_id = ? AND completed = 0"
  );

  function buildMutationResponse(userId, taskId, nowStr) {
    const taskRow = findTaskStmt.get(taskId, userId);
    const subtaskRows = listTaskSubtasksStmt.all(taskId, userId);
    const taskCats = listTaskCategoriesStmt.all(taskId, userId);
    return {
      task: serializeTask(taskRow, subtaskRows, taskCats),
      counts: getTaskCounts(db, userId),
      summary: getDashboardSummary(db, userId, nowStr),
      categories: listUserCategories(db, userId),
    };
  }

  router.get('/', (req, res) => {
    seedDefaultCategoriesIfNeeded(db, req.user.id);

    const status = req.query.status ? String(req.query.status) : 'all';
    if (!VALID_STATUSES.has(status)) {
      return res.status(400).json({ error: 'Filter status tidak valid.' });
    }

    const priorityFilter = req.query.priority ? String(req.query.priority) : 'all';
    if (priorityFilter !== 'all' && !VALID_PRIORITIES.has(priorityFilter)) {
      return res.status(400).json({ error: 'Filter prioritas tidak valid.' });
    }

    const dueFilter = req.query.due ? String(req.query.due) : 'all';
    if (!VALID_DUE_FILTERS.has(dueFilter)) {
      return res.status(400).json({ error: 'Filter tenggat waktu tidak valid.' });
    }

    const sort = req.query.sort ? String(req.query.sort) : 'newest';
    if (!VALID_SORTS.has(sort)) {
      return res.status(400).json({ error: 'Opsi pengurutan tidak valid.' });
    }

    const categoryMode = req.query.category_mode ? String(req.query.category_mode) : 'and';
    if (!VALID_CATEGORY_MODES.has(categoryMode)) {
      return res.status(400).json({ error: 'Mode filter kategori harus and atau or.' });
    }

    const rawNow = req.query.now ? String(req.query.now) : '';
    const nowStr = parseLocalDateTime(rawNow) || formatLocalDateTime(new Date());
    const todayDate = nowStr.slice(0, 10);

    const conditions = ['user_id = ?'];
    const params = [req.user.id];

    if (status !== 'all') {
      conditions.push('completed = ?');
      params.push(status === 'completed' ? 1 : 0);
    }

    if (priorityFilter !== 'all') {
      conditions.push('priority = ?');
      params.push(priorityFilter);
    }

    const rawCategoryIds = req.query.category_ids ? String(req.query.category_ids).trim() : '';
    const rawCategories = req.query.categories ? String(req.query.categories).trim() : '';
    const legacyCategoryFilter = req.query.category ? String(req.query.category).trim() : 'all';

    if (legacyCategoryFilter === 'none') {
      conditions.push(
        'NOT EXISTS (SELECT 1 FROM task_categories tc WHERE tc.task_id = tasks.id)'
      );
    } else if (rawCategoryIds) {
      const idList = [...new Set(rawCategoryIds.split(',').map((v) => parsePositiveId(v.trim())).filter(Boolean))];
      if (idList.length === 0) {
        return res.status(400).json({ error: 'Filter ID kategori tidak valid.' });
      }
      const placeholders = idList.map(() => '?').join(', ');
      if (categoryMode === 'and') {
        conditions.push(
          `id IN (
            SELECT tc.task_id
            FROM task_categories tc
            JOIN categories c ON c.id = tc.category_id
            WHERE c.user_id = ? AND tc.category_id IN (${placeholders})
            GROUP BY tc.task_id
            HAVING COUNT(DISTINCT tc.category_id) = ?
          )`
        );
        params.push(req.user.id, ...idList, idList.length);
      } else {
        conditions.push(
          `EXISTS (
            SELECT 1
            FROM task_categories tc
            JOIN categories c ON c.id = tc.category_id
            WHERE tc.task_id = tasks.id AND c.user_id = ? AND tc.category_id IN (${placeholders})
          )`
        );
        params.push(req.user.id, ...idList);
      }
    } else if (rawCategories || (legacyCategoryFilter && legacyCategoryFilter !== 'all')) {
      const nameList = (rawCategories ? rawCategories.split(',') : [legacyCategoryFilter])
        .map((v) => v.trim())
        .filter(Boolean);
      const uniqueNames = [...new Set(nameList.map((n) => n.toLowerCase()))];

      if (uniqueNames.length > 0) {
        const userCats = listUserCategories(db, req.user.id);
        const catIdByLowerName = new Map(
          userCats.map((c) => [c.name.toLowerCase(), c.id])
        );
        const matchedIds = uniqueNames
          .map((name) => catIdByLowerName.get(name))
          .filter(Boolean);

        if (categoryMode === 'and' && matchedIds.length !== uniqueNames.length) {
          conditions.push('1 = 0');
        } else if (matchedIds.length === 0) {
          conditions.push('1 = 0');
        } else {
          const placeholders = matchedIds.map(() => '?').join(', ');
          if (categoryMode === 'and') {
            conditions.push(
              `id IN (
                SELECT tc.task_id
                FROM task_categories tc
                WHERE tc.category_id IN (${placeholders})
                GROUP BY tc.task_id
                HAVING COUNT(DISTINCT tc.category_id) = ?
              )`
            );
            params.push(...matchedIds, matchedIds.length);
          } else {
            conditions.push(
              `EXISTS (
                SELECT 1 FROM task_categories tc
                WHERE tc.task_id = tasks.id AND tc.category_id IN (${placeholders})
              )`
            );
            params.push(...matchedIds);
          }
        }
      }
    }

    if (dueFilter === 'today') {
      conditions.push('due_at IS NOT NULL AND substr(due_at, 1, 10) = ?');
      params.push(todayDate);
    } else if (dueFilter === 'overdue') {
      conditions.push('completed = 0 AND due_at IS NOT NULL AND due_at < ?');
      params.push(nowStr);
    }

    const orderBy = resolveSortOrderClause(sort);
    const sql = `
      SELECT id, title, description, completed, priority, due_at, created_at, updated_at
      FROM tasks
      WHERE ${conditions.join(' AND ')}
      ORDER BY ${orderBy}
    `;

    const rows = db.prepare(sql).all(...params);
    const allSubtasks = listAllUserSubtasksStmt.all(req.user.id);
    const subtasksByTask = new Map();
    for (const sub of allSubtasks) {
      if (!subtasksByTask.has(sub.task_id)) {
        subtasksByTask.set(sub.task_id, []);
      }
      subtasksByTask.get(sub.task_id).push(sub);
    }

    const allTaskCats = listAllUserTaskCategoriesStmt.all(req.user.id);
    const categoriesByTask = new Map();
    for (const tc of allTaskCats) {
      if (!categoriesByTask.has(tc.task_id)) {
        categoriesByTask.set(tc.task_id, []);
      }
      categoriesByTask.get(tc.task_id).push({
        id: tc.id,
        name: tc.name,
        color: tc.color || 'indigo',
        icon: tc.icon || 'tag',
      });
    }

    return res.json({
      tasks: rows.map((row) =>
        serializeTask(
          row,
          subtasksByTask.get(row.id) || [],
          categoriesByTask.get(row.id) || []
        )
      ),
      counts: getTaskCounts(db, req.user.id),
      summary: getDashboardSummary(db, req.user.id, nowStr),
      categories: listUserCategories(db, req.user.id),
    });
  });

  router.post('/', (req, res) => {
    const titleValidation = validateTitle(req.body?.title);
    if (titleValidation.error) {
      return res.status(400).json({ error: titleValidation.error });
    }

    const descValidation = validateDescription(req.body?.description);
    if (descValidation.error) {
      return res.status(400).json({ error: descValidation.error });
    }

    const priorityValidation = validatePriority(req.body?.priority, 'medium');
    if (priorityValidation.error) {
      return res.status(400).json({ error: priorityValidation.error });
    }

    const dueValidation = validateDueAt(req.body?.due_at);
    if (dueValidation.error) {
      return res.status(400).json({ error: dueValidation.error });
    }

    const catResolution = resolveTaskCategoryIds(db, req.user.id, req.body || {});
    if (catResolution.error) {
      return res.status(400).json({ error: catResolution.error });
    }

    let taskId;
    db.exec('BEGIN IMMEDIATE;');
    try {
      const result = insertTaskStmt.run(
        req.user.id,
        titleValidation.title,
        descValidation.description,
        priorityValidation.priority,
        dueValidation.dueAt
      );
      taskId = Number(result.lastInsertRowid);
      if (catResolution.provided) {
        syncTaskCategories(db, taskId, catResolution.categoryIds);
      }
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }

    const nowStr = formatLocalDateTime(new Date());
    return res.status(201).json(buildMutationResponse(req.user.id, taskId, nowStr));
  });

  router.patch('/:id', (req, res) => {
    const taskId = parsePositiveId(req.params.id);
    if (!taskId) {
      return res.status(400).json({ error: 'ID tugas tidak valid.' });
    }

    const existing = findTaskStmt.get(taskId, req.user.id);
    if (!existing) {
      return res.status(404).json({ error: 'Tugas tidak ditemukan.' });
    }

    const body = req.body || {};
    const hasTitle = Object.prototype.hasOwnProperty.call(body, 'title');
    const hasDescription = Object.prototype.hasOwnProperty.call(body, 'description');
    const hasCompleted = Object.prototype.hasOwnProperty.call(body, 'completed');
    const hasPriority = Object.prototype.hasOwnProperty.call(body, 'priority');
    const hasDueAt = Object.prototype.hasOwnProperty.call(body, 'due_at');

    const catResolution = resolveTaskCategoryIds(db, req.user.id, body);
    if (catResolution.error) {
      return res.status(400).json({ error: catResolution.error });
    }

    if (
      !hasTitle &&
      !hasDescription &&
      !hasCompleted &&
      !hasPriority &&
      !hasDueAt &&
      !catResolution.provided
    ) {
      return res.status(400).json({ error: 'Tidak ada perubahan yang dikirim.' });
    }

    let nextTitle = existing.title;
    if (hasTitle) {
      const validation = validateTitle(body.title);
      if (validation.error) {
        return res.status(400).json({ error: validation.error });
      }
      nextTitle = validation.title;
    }

    let nextDescription = existing.description || null;
    if (hasDescription) {
      const descValidation = validateDescription(body.description);
      if (descValidation.error) {
        return res.status(400).json({ error: descValidation.error });
      }
      nextDescription = descValidation.description;
    }

    let nextCompleted = existing.completed;
    if (hasCompleted) {
      if (typeof body.completed !== 'boolean') {
        return res.status(400).json({ error: 'Status selesai harus berupa boolean.' });
      }
      nextCompleted = body.completed ? 1 : 0;
    }

    let nextPriority = existing.priority || 'medium';
    if (hasPriority) {
      const priorityValidation = validatePriority(body.priority);
      if (priorityValidation.error) {
        return res.status(400).json({ error: priorityValidation.error });
      }
      nextPriority = priorityValidation.priority;
    }

    let nextDueAt = existing.due_at || null;
    if (hasDueAt) {
      const dueValidation = validateDueAt(body.due_at);
      if (dueValidation.error) {
        return res.status(400).json({ error: dueValidation.error });
      }
      nextDueAt = dueValidation.dueAt;
    }

    db.exec('BEGIN IMMEDIATE;');
    try {
      updateTaskStmt.run(
        nextTitle,
        nextDescription,
        nextCompleted,
        nextPriority,
        nextDueAt,
        taskId,
        req.user.id
      );

      if (catResolution.provided) {
        syncTaskCategories(db, taskId, catResolution.categoryIds);
      }

      if (hasCompleted && nextCompleted === 1 && req.user.auto_complete_subtasks) {
        completeAllSubtasksStmt.run(taskId, req.user.id);
      }

      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }

    const nowStr = formatLocalDateTime(new Date());
    return res.json(buildMutationResponse(req.user.id, taskId, nowStr));
  });

  router.delete('/:id', (req, res) => {
    const taskId = parsePositiveId(req.params.id);
    if (!taskId) {
      return res.status(400).json({ error: 'ID tugas tidak valid.' });
    }

    const result = deleteTaskStmt.run(taskId, req.user.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Tugas tidak ditemukan.' });
    }

    return res.status(204).end();
  });

  router.post('/:taskId/subtasks', (req, res) => {
    const taskId = parsePositiveId(req.params.taskId);
    if (!taskId) {
      return res.status(400).json({ error: 'ID tugas tidak valid.' });
    }

    const parentTask = findTaskStmt.get(taskId, req.user.id);
    if (!parentTask) {
      return res.status(404).json({ error: 'Tugas tidak ditemukan.' });
    }

    const titleValidation = validateTitle(req.body?.title, 'Judul sub-tugas');
    if (titleValidation.error) {
      return res.status(400).json({ error: titleValidation.error });
    }

    let createdSubtaskId;
    db.exec('BEGIN IMMEDIATE;');
    try {
      const posRow = nextSubtaskPositionStmt.get(taskId, req.user.id);
      const nextPos = Number(posRow?.next_pos || 0);
      const result = insertSubtaskStmt.run(taskId, req.user.id, titleValidation.title, nextPos);
      createdSubtaskId = Number(result.lastInsertRowid);

      syncParentCompletionFromSubtasks(db, taskId, req.user.id, req.user.auto_complete_subtasks);
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }

    const subtask = findSubtaskStmt.get(createdSubtaskId, taskId, req.user.id);
    const nowStr = formatLocalDateTime(new Date());
    return res.status(201).json({
      subtask: serializeSubtask(subtask),
      ...buildMutationResponse(req.user.id, taskId, nowStr),
    });
  });

  router.patch('/:taskId/subtasks/:subtaskId', (req, res) => {
    const taskId = parsePositiveId(req.params.taskId);
    const subtaskId = parsePositiveId(req.params.subtaskId);
    if (!taskId || !subtaskId) {
      return res.status(400).json({ error: 'ID tugas atau sub-tugas tidak valid.' });
    }

    const existing = findSubtaskStmt.get(subtaskId, taskId, req.user.id);
    if (!existing) {
      return res.status(404).json({ error: 'Sub-tugas tidak ditemukan.' });
    }

    const body = req.body || {};
    const hasTitle = Object.prototype.hasOwnProperty.call(body, 'title');
    const hasCompleted = Object.prototype.hasOwnProperty.call(body, 'completed');

    if (!hasTitle && !hasCompleted) {
      return res.status(400).json({ error: 'Tidak ada perubahan yang dikirim.' });
    }

    let nextTitle = existing.title;
    if (hasTitle) {
      const titleValidation = validateTitle(body.title, 'Judul sub-tugas');
      if (titleValidation.error) {
        return res.status(400).json({ error: titleValidation.error });
      }
      nextTitle = titleValidation.title;
    }

    let nextCompleted = existing.completed;
    if (hasCompleted) {
      if (typeof body.completed !== 'boolean') {
        return res.status(400).json({ error: 'Status sub-tugas harus berupa boolean.' });
      }
      nextCompleted = body.completed ? 1 : 0;
    }

    db.exec('BEGIN IMMEDIATE;');
    try {
      updateSubtaskStmt.run(nextTitle, nextCompleted, subtaskId, taskId, req.user.id);
      syncParentCompletionFromSubtasks(db, taskId, req.user.id, req.user.auto_complete_subtasks);
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }

    const updatedSubtask = findSubtaskStmt.get(subtaskId, taskId, req.user.id);
    const nowStr = formatLocalDateTime(new Date());
    return res.json({
      subtask: serializeSubtask(updatedSubtask),
      ...buildMutationResponse(req.user.id, taskId, nowStr),
    });
  });

  router.delete('/:taskId/subtasks/:subtaskId', (req, res) => {
    const taskId = parsePositiveId(req.params.taskId);
    const subtaskId = parsePositiveId(req.params.subtaskId);
    if (!taskId || !subtaskId) {
      return res.status(400).json({ error: 'ID tugas atau sub-tugas tidak valid.' });
    }

    const existing = findSubtaskStmt.get(subtaskId, taskId, req.user.id);
    if (!existing) {
      return res.status(404).json({ error: 'Sub-tugas tidak ditemukan.' });
    }

    db.exec('BEGIN IMMEDIATE;');
    try {
      deleteSubtaskStmt.run(subtaskId, taskId, req.user.id);
      syncParentCompletionFromSubtasks(db, taskId, req.user.id, req.user.auto_complete_subtasks);
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }

    const nowStr = formatLocalDateTime(new Date());
    return res.json(buildMutationResponse(req.user.id, taskId, nowStr));
  });

  return router;
}

module.exports = {
  createTasksRouter,
};
