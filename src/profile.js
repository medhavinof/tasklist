const express = require('express');
const {
  requireAuth,
  verifyPassword,
  hashPassword,
  clearSessionCookie,
  validateUsername,
  validateSecret,
  validateDisplayName,
  validateAvatar,
  validateSecurityQuestionPair,
  serializeUser,
} = require('./auth');
const { ensureUserCategory, listUserCategories } = require('./categories');

const VALID_THEMES = new Set(['light', 'dark']);
const VALID_ACCENTS = new Set(['indigo', 'blue', 'emerald', 'rose', 'amber']);
const VALID_PRIORITIES = new Set(['low', 'medium', 'high']);
const LOCAL_DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function createProfileRouter(db) {
  const router = express.Router();
  router.use(requireAuth(db));

  const findUserByIdStmt = db.prepare(`
    SELECT
      id, username, password_hash, display_name, avatar,
      security_question, security_answer_hash,
      theme, accent_color, auto_lock_minutes, auto_complete_subtasks
    FROM users
    WHERE id = ?
  `);
  const findUserByUsernameStmt = db.prepare(
    'SELECT id FROM users WHERE username = ? AND id != ?'
  );

  function loadSerializedUser(userId) {
    return serializeUser(findUserByIdStmt.get(userId));
  }

  router.patch('/', (req, res) => {
    const body = req.body || {};
    const current = findUserByIdStmt.get(req.user.id);

    const hasDisplayName = Object.prototype.hasOwnProperty.call(body, 'display_name');
    const hasUsername = Object.prototype.hasOwnProperty.call(body, 'username');
    const hasAvatar = Object.prototype.hasOwnProperty.call(body, 'avatar');

    if (!hasDisplayName && !hasUsername && !hasAvatar) {
      return res.status(400).json({ error: 'Tidak ada perubahan profil yang dikirim.' });
    }

    let nextDisplayName = current.display_name;
    if (hasDisplayName) {
      const nameValidation = validateDisplayName(body.display_name);
      if (nameValidation.error) {
        return res.status(400).json({ error: nameValidation.error });
      }
      nextDisplayName = nameValidation.displayName;
    }

    let nextUsername = current.username;
    if (hasUsername) {
      const userValidation = validateUsername(body.username);
      if (userValidation.error) {
        return res.status(400).json({ error: userValidation.error });
      }
      const conflict = findUserByUsernameStmt.get(userValidation.username, req.user.id);
      if (conflict) {
        return res.status(409).json({ error: 'Username sudah dipakai akun lain.' });
      }
      nextUsername = userValidation.username;
    }

    let nextAvatar = current.avatar;
    if (hasAvatar) {
      const avatarValidation = validateAvatar(body.avatar);
      if (avatarValidation.error) {
        return res.status(400).json({ error: avatarValidation.error });
      }
      nextAvatar = avatarValidation.avatar;
    }

    try {
      db.prepare('UPDATE users SET username = ?, display_name = ?, avatar = ? WHERE id = ?').run(
        nextUsername,
        nextDisplayName,
        nextAvatar,
        req.user.id
      );
    } catch (err) {
      if (String(err?.message).includes('UNIQUE')) {
        return res.status(409).json({ error: 'Username sudah dipakai akun lain.' });
      }
      throw err;
    }

    return res.json({ user: loadSerializedUser(req.user.id) });
  });

  router.patch('/password', (req, res) => {
    const currentPassword = req.body?.current_password;
    const newPassword = req.body?.new_password;

    if (typeof currentPassword !== 'string' || !currentPassword) {
      return res.status(400).json({ error: 'Password / PIN saat ini wajib diisi.' });
    }

    const secretValidation = validateSecret(newPassword, 'Password / PIN baru');
    if (secretValidation.error) {
      return res.status(400).json({ error: secretValidation.error });
    }

    const current = findUserByIdStmt.get(req.user.id);
    if (!verifyPassword(currentPassword, current.password_hash)) {
      return res.status(401).json({ error: 'Password / PIN saat ini salah.' });
    }

    const nextHash = hashPassword(secretValidation.secret);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(nextHash, req.user.id);

    return res.json({ ok: true });
  });

  router.patch('/security-question', (req, res) => {
    const currentPassword = req.body?.current_password;
    if (typeof currentPassword !== 'string' || !currentPassword) {
      return res.status(400).json({ error: 'Password / PIN saat ini wajib diisi untuk verifikasi.' });
    }

    const current = findUserByIdStmt.get(req.user.id);
    if (!verifyPassword(currentPassword, current.password_hash)) {
      return res.status(401).json({ error: 'Password / PIN saat ini salah.' });
    }

    const secValidation = validateSecurityQuestionPair(
      req.body?.security_question,
      req.body?.security_answer
    );
    if (secValidation.error) {
      return res.status(400).json({ error: secValidation.error });
    }

    const answerHash = hashPassword(secValidation.answer);
    db.prepare(
      'UPDATE users SET security_question = ?, security_answer_hash = ? WHERE id = ?'
    ).run(secValidation.question, answerHash, req.user.id);

    return res.json({ user: loadSerializedUser(req.user.id) });
  });

  router.patch('/preferences', (req, res) => {
    const body = req.body || {};
    const current = findUserByIdStmt.get(req.user.id);

    const hasTheme = Object.prototype.hasOwnProperty.call(body, 'theme');
    const hasAccent = Object.prototype.hasOwnProperty.call(body, 'accent_color');
    const hasAutoLock = Object.prototype.hasOwnProperty.call(body, 'auto_lock_minutes');
    const hasAutoSubtasks = Object.prototype.hasOwnProperty.call(body, 'auto_complete_subtasks');

    if (!hasTheme && !hasAccent && !hasAutoLock && !hasAutoSubtasks) {
      return res.status(400).json({ error: 'Tidak ada preferensi yang dikirim.' });
    }

    let nextTheme = current.theme || 'light';
    if (hasTheme) {
      if (!VALID_THEMES.has(body.theme)) {
        return res.status(400).json({ error: 'Tema harus berupa light atau dark.' });
      }
      nextTheme = body.theme;
    }

    let nextAccent = current.accent_color || 'indigo';
    if (hasAccent) {
      if (!VALID_ACCENTS.has(body.accent_color)) {
        return res.status(400).json({ error: 'Warna aksen tidak valid.' });
      }
      nextAccent = body.accent_color;
    }

    let nextAutoLock = Number(current.auto_lock_minutes || 0);
    if (hasAutoLock) {
      const minutes = Number(body.auto_lock_minutes);
      if (!Number.isInteger(minutes) || minutes < 0 || minutes > 120) {
        return res.status(400).json({ error: 'Durasi Auto-Lock harus antara 0 hingga 120 menit.' });
      }
      nextAutoLock = minutes;
    }

    let nextAutoSubtasks = Number(current.auto_complete_subtasks);
    if (hasAutoSubtasks) {
      if (typeof body.auto_complete_subtasks !== 'boolean') {
        return res.status(400).json({ error: 'auto_complete_subtasks harus berupa boolean.' });
      }
      nextAutoSubtasks = body.auto_complete_subtasks ? 1 : 0;
    }

    db.prepare(
      'UPDATE users SET theme = ?, accent_color = ?, auto_lock_minutes = ?, auto_complete_subtasks = ? WHERE id = ?'
    ).run(nextTheme, nextAccent, nextAutoLock, nextAutoSubtasks, req.user.id);

    return res.json({ user: loadSerializedUser(req.user.id) });
  });

  router.get('/export', (req, res) => {
    const user = loadSerializedUser(req.user.id);
    const categories = listUserCategories(db, req.user.id).map((cat) => ({
      name: cat.name,
      color: cat.color,
      icon: cat.icon,
    }));

    const taskRows = db
      .prepare(
        'SELECT id, title, description, completed, priority, due_at, created_at, updated_at FROM tasks WHERE user_id = ? ORDER BY id ASC'
      )
      .all(req.user.id);

    const subtaskRows = db
      .prepare(
        'SELECT task_id, title, completed, position FROM subtasks WHERE user_id = ? ORDER BY position ASC, id ASC'
      )
      .all(req.user.id);

    const taskCategoryRows = db
      .prepare(
        `SELECT tc.task_id, c.name
         FROM task_categories tc
         JOIN categories c ON c.id = tc.category_id
         WHERE c.user_id = ?
         ORDER BY c.id ASC`
      )
      .all(req.user.id);

    const subtasksByTask = new Map();
    for (const sub of subtaskRows) {
      if (!subtasksByTask.has(sub.task_id)) {
        subtasksByTask.set(sub.task_id, []);
      }
      subtasksByTask.get(sub.task_id).push({
        title: sub.title,
        completed: Boolean(sub.completed),
        position: sub.position,
      });
    }

    const categoriesByTask = new Map();
    for (const row of taskCategoryRows) {
      if (!categoriesByTask.has(row.task_id)) {
        categoriesByTask.set(row.task_id, []);
      }
      categoriesByTask.get(row.task_id).push(row.name);
    }

    const bundle = {
      version: 1,
      exported_at: new Date().toISOString(),
      profile: {
        username: user.username,
        display_name: user.display_name,
        avatar: user.avatar,
        theme: user.theme,
        accent_color: user.accent_color,
        auto_lock_minutes: user.auto_lock_minutes,
        auto_complete_subtasks: user.auto_complete_subtasks,
      },
      categories,
      tasks: taskRows.map((row) => {
        const taskCatNames = categoriesByTask.get(row.id) || [];
        return {
          title: row.title,
          description: row.description || null,
          completed: Boolean(row.completed),
          priority: row.priority || 'medium',
          due_at: row.due_at || null,
          category: taskCatNames[0] || null,
          categories: taskCatNames,
          subtasks: subtasksByTask.get(row.id) || [],
        };
      }),
    };

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="tasklist-backup-${user.username}.json"`
    );
    return res.json(bundle);
  });

  router.post('/import', (req, res) => {
    const mode = req.body?.mode === 'replace' ? 'replace' : req.body?.mode === 'merge' ? 'merge' : null;
    const data = req.body?.data;

    if (!mode) {
      return res.status(400).json({ error: 'Mode import harus berupa merge atau replace.' });
    }

    if (!data || typeof data !== 'object' || !Array.isArray(data.tasks)) {
      return res.status(400).json({ error: 'Format file cadangan JSON tidak valid.' });
    }

    if (data.tasks.length > 2000) {
      return res.status(400).json({ error: 'Jumlah tugas dalam cadangan melebihi batas (2000).' });
    }

    const normalizedTasks = [];
    for (const rawTask of data.tasks) {
      if (!rawTask || typeof rawTask !== 'object' || typeof rawTask.title !== 'string') {
        return res.status(400).json({ error: 'Ada entri tugas tanpa judul yang valid.' });
      }
      const title = rawTask.title.trim().slice(0, 200);
      if (!title) {
        return res.status(400).json({ error: 'Ada entri tugas dengan judul kosong.' });
      }

      const description =
        typeof rawTask.description === 'string' && rawTask.description.trim()
          ? rawTask.description.replace(/\r\n/g, '\n').trim().slice(0, 2000)
          : null;

      const priority = VALID_PRIORITIES.has(rawTask.priority) ? rawTask.priority : 'medium';
      const dueAt =
        typeof rawTask.due_at === 'string' && LOCAL_DATETIME_PATTERN.test(rawTask.due_at.trim())
          ? rawTask.due_at.trim()
          : null;
      const completed = Boolean(rawTask.completed) ? 1 : 0;

      const rawCatList = Array.isArray(rawTask.categories)
        ? rawTask.categories
        : typeof rawTask.category === 'string' && rawTask.category.trim()
          ? [rawTask.category]
          : [];
      const categories = [];
      for (const rawCat of rawCatList) {
        if (typeof rawCat === 'string' && rawCat.trim()) {
          categories.push(rawCat.trim().slice(0, 32));
        }
      }

      const subtasks = [];
      if (Array.isArray(rawTask.subtasks)) {
        rawTask.subtasks.forEach((rawSub, idx) => {
          if (rawSub && typeof rawSub.title === 'string' && rawSub.title.trim()) {
            subtasks.push({
              title: rawSub.title.trim().slice(0, 200),
              completed: Boolean(rawSub.completed) ? 1 : 0,
              position: Number.isInteger(rawSub.position) ? rawSub.position : idx,
            });
          }
        });
      }

      normalizedTasks.push({
        title,
        description,
        completed,
        priority,
        dueAt,
        categories,
        subtasks,
      });
    }

    let importedCategories = 0;
    let importedSubtasks = 0;

    const insertTaskStmt = db.prepare(
      'INSERT INTO tasks (user_id, title, description, completed, priority, due_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const insertTaskCategoryStmt = db.prepare(
      'INSERT OR IGNORE INTO task_categories (task_id, category_id) VALUES (?, ?)'
    );
    const insertSubtaskStmt = db.prepare(
      'INSERT INTO subtasks (task_id, user_id, title, completed, position) VALUES (?, ?, ?, ?, ?)'
    );

    db.exec('BEGIN IMMEDIATE;');
    try {
      if (mode === 'replace') {
        db.prepare('DELETE FROM tasks WHERE user_id = ?').run(req.user.id);
        db.prepare('DELETE FROM categories WHERE user_id = ?').run(req.user.id);
        db.prepare('UPDATE users SET categories_seeded = 1 WHERE id = ?').run(req.user.id);

        if (data.profile && typeof data.profile === 'object') {
          const current = findUserByIdStmt.get(req.user.id);
          const nameRes = validateDisplayName(data.profile.display_name);
          const avatarRes = validateAvatar(data.profile.avatar);
          const nextTheme = VALID_THEMES.has(data.profile.theme)
            ? data.profile.theme
            : current.theme;
          const nextAccent = VALID_ACCENTS.has(data.profile.accent_color)
            ? data.profile.accent_color
            : current.accent_color;
          const lockMins = Number(data.profile.auto_lock_minutes);
          const nextLock =
            Number.isInteger(lockMins) && lockMins >= 0 && lockMins <= 120
              ? lockMins
              : current.auto_lock_minutes;
          const nextAutoSub =
            typeof data.profile.auto_complete_subtasks === 'boolean'
              ? data.profile.auto_complete_subtasks
                ? 1
                : 0
              : current.auto_complete_subtasks;

          db.prepare(
            `UPDATE users
             SET display_name = ?, avatar = ?, theme = ?, accent_color = ?, auto_lock_minutes = ?, auto_complete_subtasks = ?
             WHERE id = ?`
          ).run(
            nameRes.error ? current.display_name : nameRes.displayName,
            avatarRes.error ? current.avatar : avatarRes.avatar,
            nextTheme,
            nextAccent,
            nextLock,
            nextAutoSub,
            req.user.id
          );
        }
      }

      if (Array.isArray(data.categories)) {
        for (const catItem of data.categories) {
          if (typeof catItem === 'string' && catItem.trim()) {
            const ensured = ensureUserCategory(db, req.user.id, catItem);
            if (!ensured.error) {
              importedCategories += 1;
            }
          } else if (catItem && typeof catItem === 'object' && typeof catItem.name === 'string') {
            const ensured = ensureUserCategory(db, req.user.id, catItem.name, {
              color: catItem.color,
              icon: catItem.icon,
            });
            if (!ensured.error) {
              importedCategories += 1;
            }
          }
        }
      }

      for (const task of normalizedTasks) {
        const taskResult = insertTaskStmt.run(
          req.user.id,
          task.title,
          task.description,
          task.completed,
          task.priority,
          task.dueAt
        );
        const taskId = Number(taskResult.lastInsertRowid);

        for (const catName of task.categories) {
          const ensured = ensureUserCategory(db, req.user.id, catName);
          if (!ensured.error) {
            insertTaskCategoryStmt.run(taskId, ensured.category.id);
          }
        }

        for (const sub of task.subtasks) {
          insertSubtaskStmt.run(taskId, req.user.id, sub.title, sub.completed, sub.position);
          importedSubtasks += 1;
        }
      }

      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }

    return res.json({
      imported: {
        tasks: normalizedTasks.length,
        subtasks: importedSubtasks,
        categories: importedCategories,
      },
      user: loadSerializedUser(req.user.id),
    });
  });

  router.post('/reset-tasks', (req, res) => {
    const rawPassword = req.body?.password;
    if (typeof rawPassword !== 'string' || !rawPassword) {
      return res.status(400).json({ error: 'Masukkan password / PIN untuk konfirmasi reset.' });
    }

    const current = findUserByIdStmt.get(req.user.id);
    if (!verifyPassword(rawPassword, current.password_hash)) {
      return res.status(401).json({ error: 'Password / PIN salah.' });
    }

    const result = db.prepare('DELETE FROM tasks WHERE user_id = ?').run(req.user.id);
    return res.json({ ok: true, deleted_tasks: Number(result.changes || 0) });
  });

  router.delete('/', (req, res) => {
    const rawPassword = req.body?.password;
    if (typeof rawPassword !== 'string' || !rawPassword) {
      return res.status(400).json({ error: 'Masukkan password / PIN untuk konfirmasi hapus profil.' });
    }

    const current = findUserByIdStmt.get(req.user.id);
    if (!verifyPassword(rawPassword, current.password_hash)) {
      return res.status(401).json({ error: 'Password / PIN salah.' });
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
    clearSessionCookie(res);
    return res.status(204).end();
  });

  return router;
}

module.exports = {
  createProfileRouter,
};
