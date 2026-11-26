const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'data', 'todo.db');

/**
 * Opens a SQLite database connection and ensures the required tables exist.
 * Accepts ":memory:" for isolated automated tests.
 */
function createDatabase(dbPath = DEFAULT_DB_PATH) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');

  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      avatar TEXT,
      security_question TEXT,
      security_answer_hash TEXT,
      theme TEXT NOT NULL DEFAULT 'light',
      accent_color TEXT NOT NULL DEFAULT 'indigo',
      auto_lock_minutes INTEGER NOT NULL DEFAULT 0,
      auto_complete_subtasks INTEGER NOT NULL DEFAULT 1,
      categories_seeded INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      completed INTEGER NOT NULL DEFAULT 0,
      priority TEXT NOT NULL DEFAULT 'medium',
      due_at TEXT,
      category TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS subtasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL COLLATE NOCASE,
      color TEXT NOT NULL DEFAULT 'indigo',
      icon TEXT NOT NULL DEFAULT 'tag',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, name)
    );

    CREATE TABLE IF NOT EXISTS task_categories (
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      PRIMARY KEY (task_id, category_id)
    );
  `);

  ensureUserColumns(db);
  ensureTaskColumns(db);
  ensureCategoryColumns(db);
  migrateLegacyTaskCategories(db);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON tasks(user_id, completed, id);
    CREATE INDEX IF NOT EXISTS idx_tasks_user_due ON tasks(user_id, due_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_user_priority ON tasks(user_id, priority);
    CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id, position, id);
    CREATE INDEX IF NOT EXISTS idx_task_categories_cat ON task_categories(category_id, task_id);
  `);

  return db;
}

/**
 * Idempotently adds user columns introduced after the initial schema.
 */
function ensureUserColumns(db) {
  const columns = new Set(
    db.prepare('PRAGMA table_info(users)').all().map((col) => col.name)
  );

  if (!columns.has('display_name')) {
    db.exec('ALTER TABLE users ADD COLUMN display_name TEXT;');
  }
  if (!columns.has('avatar')) {
    db.exec('ALTER TABLE users ADD COLUMN avatar TEXT;');
  }
  if (!columns.has('security_question')) {
    db.exec('ALTER TABLE users ADD COLUMN security_question TEXT;');
  }
  if (!columns.has('security_answer_hash')) {
    db.exec('ALTER TABLE users ADD COLUMN security_answer_hash TEXT;');
  }
  if (!columns.has('theme')) {
    db.exec("ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'light';");
  }
  if (!columns.has('accent_color')) {
    db.exec("ALTER TABLE users ADD COLUMN accent_color TEXT NOT NULL DEFAULT 'indigo';");
  }
  if (!columns.has('auto_lock_minutes')) {
    db.exec('ALTER TABLE users ADD COLUMN auto_lock_minutes INTEGER NOT NULL DEFAULT 0;');
  }
  if (!columns.has('auto_complete_subtasks')) {
    db.exec('ALTER TABLE users ADD COLUMN auto_complete_subtasks INTEGER NOT NULL DEFAULT 1;');
  }
  if (!columns.has('categories_seeded')) {
    db.exec('ALTER TABLE users ADD COLUMN categories_seeded INTEGER NOT NULL DEFAULT 0;');
  }
}

/**
 * Idempotently adds category columns introduced after initial schema.
 */
function ensureCategoryColumns(db) {
  const columns = new Set(
    db.prepare('PRAGMA table_info(categories)').all().map((col) => col.name)
  );

  if (!columns.has('color')) {
    db.exec("ALTER TABLE categories ADD COLUMN color TEXT NOT NULL DEFAULT 'indigo';");
  }
  if (!columns.has('icon')) {
    db.exec("ALTER TABLE categories ADD COLUMN icon TEXT NOT NULL DEFAULT 'tag';");
  }
}

/**
 * Backfills legacy single-category string values into the categories and task_categories tables.
 */
function migrateLegacyTaskCategories(db) {
  const legacyTasks = db
    .prepare(
      `SELECT t.id AS task_id, t.user_id, t.category
       FROM tasks t
       WHERE t.category IS NOT NULL
         AND TRIM(t.category) != ''
         AND NOT EXISTS (
           SELECT 1 FROM task_categories tc WHERE tc.task_id = t.id
         )`
    )
    .all();

  if (legacyTasks.length === 0) {
    return;
  }

  const insertCatStmt = db.prepare(
    'INSERT OR IGNORE INTO categories (user_id, name) VALUES (?, ?)'
  );
  const findCatStmt = db.prepare(
    'SELECT id FROM categories WHERE user_id = ? AND name = ?'
  );
  const linkStmt = db.prepare(
    'INSERT OR IGNORE INTO task_categories (task_id, category_id) VALUES (?, ?)'
  );

  for (const row of legacyTasks) {
    const cleanName = row.category.trim().slice(0, 32);
    if (!cleanName) {
      continue;
    }
    insertCatStmt.run(row.user_id, cleanName);
    const cat = findCatStmt.get(row.user_id, cleanName);
    if (cat) {
      linkStmt.run(row.task_id, cat.id);
    }
  }
}

/**
 * Idempotently adds columns introduced after the initial schema to existing databases.
 */
function ensureTaskColumns(db) {
  const columns = new Set(
    db.prepare('PRAGMA table_info(tasks)').all().map((col) => col.name)
  );

  if (!columns.has('description')) {
    db.exec('ALTER TABLE tasks ADD COLUMN description TEXT;');
  }
  if (!columns.has('priority')) {
    db.exec("ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium';");
  }
  if (!columns.has('due_at')) {
    db.exec('ALTER TABLE tasks ADD COLUMN due_at TEXT;');
  }
  if (!columns.has('category')) {
    db.exec('ALTER TABLE tasks ADD COLUMN category TEXT;');
  }
}

module.exports = {
  createDatabase,
  DEFAULT_DB_PATH,
};
