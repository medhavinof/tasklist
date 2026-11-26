const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');

function extractCookie(setCookieHeader) {
  assert.ok(setCookieHeader, 'Expected Set-Cookie header');
  return setCookieHeader.split(';')[0];
}

async function startTestServer(dbPath = ':memory:') {
  const db = createDatabase(dbPath);
  const app = createApp(db);

  await new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      app._testServer = server;
      resolve();
    });
  });

  const { port } = app._testServer.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  async function request(urlPath, { method = 'GET', body, cookie } = {}) {
    const headers = {};
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (cookie) {
      headers.Cookie = cookie;
    }

    const res = await fetch(`${baseUrl}${urlPath}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }

    return {
      status: res.status,
      headers: res.headers,
      json,
      text,
    };
  }

  async function close() {
    await new Promise((resolve) => app._testServer.close(resolve));
    db.close();
  }

  return { db, baseUrl, request, close };
}

describe('Simple Task List API', () => {
  let ctx;

  beforeEach(async () => {
    ctx = await startTestServer(':memory:');
  });

  afterEach(async () => {
    if (ctx) {
      await ctx.close();
    }
  });

  it('serves the web frontend and blocks unauthenticated API access', async () => {
    const htmlRes = await ctx.request('/');
    assert.equal(htmlRes.status, 200);
    assert.match(htmlRes.text, /Simple Task List/);

    const meRes = await ctx.request('/api/auth/me');
    assert.equal(meRes.status, 401);

    const tasksRes = await ctx.request('/api/tasks');
    assert.equal(tasksRes.status, 401);
  });

  it('registers local account, rejects duplicates, and supports login/logout', async () => {
    const invalidRes = await ctx.request('/api/auth/register', {
      method: 'POST',
      body: { username: 'ab', password: '123' },
    });
    assert.equal(invalidRes.status, 400);

    const regRes = await ctx.request('/api/auth/register', {
      method: 'POST',
      body: { username: 'Budi_01', password: 'password123' },
    });
    assert.equal(regRes.status, 201);
    assert.equal(regRes.json.user.username, 'Budi_01');
    const regCookie = extractCookie(regRes.headers.get('set-cookie'));

    const meRes = await ctx.request('/api/auth/me', { cookie: regCookie });
    assert.equal(meRes.status, 200);
    assert.equal(meRes.json.user.username, 'Budi_01');

    // Case-insensitive duplicate check
    const dupRes = await ctx.request('/api/auth/register', {
      method: 'POST',
      body: { username: 'budi_01', password: 'password123' },
    });
    assert.equal(dupRes.status, 409);

    const logoutRes = await ctx.request('/api/auth/logout', {
      method: 'POST',
      cookie: regCookie,
    });
    assert.equal(logoutRes.status, 200);

    const afterLogoutMe = await ctx.request('/api/auth/me', { cookie: regCookie });
    assert.equal(afterLogoutMe.status, 401);

    const badLogin = await ctx.request('/api/auth/login', {
      method: 'POST',
      body: { username: 'Budi_01', password: 'wrongpassword' },
    });
    assert.equal(badLogin.status, 401);

    const goodLogin = await ctx.request('/api/auth/login', {
      method: 'POST',
      body: { username: 'Budi_01', password: 'password123' },
    });
    assert.equal(goodLogin.status, 200);
    assert.equal(goodLogin.json.user.username, 'Budi_01');
  });

  it('supports create, complete, edit, status filter, and delete for tasks', async () => {
    const regRes = await ctx.request('/api/auth/register', {
      method: 'POST',
      body: { username: 'ani', password: 'secret123' },
    });
    const cookie = extractCookie(regRes.headers.get('set-cookie'));

    const emptyTitleRes = await ctx.request('/api/tasks', {
      method: 'POST',
      cookie,
      body: { title: '   ' },
    });
    assert.equal(emptyTitleRes.status, 400);

    const first = await ctx.request('/api/tasks', {
      method: 'POST',
      cookie,
      body: { title: 'Belajar SQLite' },
    });
    assert.equal(first.status, 201);
    assert.equal(first.json.task.title, 'Belajar SQLite');
    assert.equal(first.json.task.completed, false);

    const second = await ctx.request('/api/tasks', {
      method: 'POST',
      cookie,
      body: { title: 'Buat UI Task List' },
    });
    assert.equal(second.status, 201);
    assert.deepEqual(second.json.counts, { all: 2, active: 2, completed: 0 });

    // Complete first task & edit its title
    const patched = await ctx.request(`/api/tasks/${first.json.task.id}`, {
      method: 'PATCH',
      cookie,
      body: { title: 'Belajar SQLite Dasar', completed: true },
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.json.task.title, 'Belajar SQLite Dasar');
    assert.equal(patched.json.task.completed, true);
    assert.deepEqual(patched.json.counts, { all: 2, active: 1, completed: 1 });

    // Filter All, Active, Completed
    const allRes = await ctx.request('/api/tasks?status=all', { cookie });
    assert.equal(allRes.status, 200);
    assert.equal(allRes.json.tasks.length, 2);

    const activeRes = await ctx.request('/api/tasks?status=active', { cookie });
    assert.equal(activeRes.status, 200);
    assert.equal(activeRes.json.tasks.length, 1);
    assert.equal(activeRes.json.tasks[0].id, second.json.task.id);

    const completedRes = await ctx.request('/api/tasks?status=completed', { cookie });
    assert.equal(completedRes.status, 200);
    assert.equal(completedRes.json.tasks.length, 1);
    assert.equal(completedRes.json.tasks[0].id, first.json.task.id);

    const invalidFilterRes = await ctx.request('/api/tasks?status=archived', { cookie });
    assert.equal(invalidFilterRes.status, 400);

    // Delete second task
    const delRes = await ctx.request(`/api/tasks/${second.json.task.id}`, {
      method: 'DELETE',
      cookie,
    });
    assert.equal(delRes.status, 204);

    const afterDeleteRes = await ctx.request('/api/tasks', { cookie });
    assert.equal(afterDeleteRes.json.tasks.length, 1);
    assert.deepEqual(afterDeleteRes.json.counts, { all: 1, active: 0, completed: 1 });
  });

  it('isolates tasks between separate local accounts', async () => {
    const userARes = await ctx.request('/api/auth/register', {
      method: 'POST',
      body: { username: 'user_a', password: 'password123' },
    });
    const cookieA = extractCookie(userARes.headers.get('set-cookie'));

    const userBRes = await ctx.request('/api/auth/register', {
      method: 'POST',
      body: { username: 'user_b', password: 'password123' },
    });
    const cookieB = extractCookie(userBRes.headers.get('set-cookie'));

    const taskARes = await ctx.request('/api/tasks', {
      method: 'POST',
      cookie: cookieA,
      body: { title: 'Tugas rahasia User A' },
    });
    const taskAId = taskARes.json.task.id;

    const listB = await ctx.request('/api/tasks', { cookie: cookieB });
    assert.equal(listB.status, 200);
    assert.equal(listB.json.tasks.length, 0);

    const patchByB = await ctx.request(`/api/tasks/${taskAId}`, {
      method: 'PATCH',
      cookie: cookieB,
      body: { completed: true },
    });
    assert.equal(patchByB.status, 404);

    const deleteByB = await ctx.request(`/api/tasks/${taskAId}`, {
      method: 'DELETE',
      cookie: cookieB,
    });
    assert.equal(deleteByB.status, 404);
  });

  it('persists accounts and tasks to a SQLite file across restarts', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-sqlite-'));
    const tempDbPath = path.join(tempDir, 'todo.db');

    let server1;
    let server2;
    try {
      server1 = await startTestServer(tempDbPath);
      const reg = await server1.request('/api/auth/register', {
        method: 'POST',
        body: { username: 'persist_user', password: 'password123' },
      });
      assert.equal(reg.status, 201);
      const cookie = extractCookie(reg.headers.get('set-cookie'));

      const created = await server1.request('/api/tasks', {
        method: 'POST',
        cookie,
        body: { title: 'Tersimpan di SQLite' },
      });
      assert.equal(created.status, 201);
      await server1.close();
      server1 = null;

      server2 = await startTestServer(tempDbPath);
      const tasksAfterRestart = await server2.request('/api/tasks', { cookie });
      assert.equal(tasksAfterRestart.status, 200);
      assert.equal(tasksAfterRestart.json.tasks.length, 1);
      assert.equal(tasksAfterRestart.json.tasks[0].title, 'Tersimpan di SQLite');
    } finally {
      if (server1) await server1.close();
      if (server2) await server2.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('migrates legacy tasks tables lacking priority, due_at, and category columns', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-migrate-'));
    const tempDbPath = path.join(tempDir, 'legacy.db');

    let migratedDb;
    try {
      const legacyDb = new DatabaseSync(tempDbPath);
      legacyDb.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE COLLATE NOCASE,
          password_hash TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          completed INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO users (username, password_hash) VALUES ('legacy_user', 'salt:hash');
        INSERT INTO tasks (user_id, title) VALUES (1, 'Tugas lama');
      `);
      legacyDb.close();

      migratedDb = createDatabase(tempDbPath);
      const cols = migratedDb
        .prepare('PRAGMA table_info(tasks)')
        .all()
        .map((c) => c.name);
      assert.ok(cols.includes('priority'));
      assert.ok(cols.includes('due_at'));
      assert.ok(cols.includes('category'));

      const row = migratedDb.prepare('SELECT title, priority, due_at, category FROM tasks WHERE id = 1').get();
      assert.equal(row.title, 'Tugas lama');
      assert.equal(row.priority, 'medium');
      assert.equal(row.due_at, null);
      assert.equal(row.category, null);
    } finally {
      if (migratedDb) migratedDb.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('supports default and custom categories with per-user isolation', async () => {
    const userA = await ctx.request('/api/auth/register', {
      method: 'POST',
      body: { username: 'cat_a', password: 'password123' },
    });
    const cookieA = extractCookie(userA.headers.get('set-cookie'));

    const userB = await ctx.request('/api/auth/register', {
      method: 'POST',
      body: { username: 'cat_b', password: 'password123' },
    });
    const cookieB = extractCookie(userB.headers.get('set-cookie'));

    const initialCats = await ctx.request('/api/categories', { cookie: cookieA });
    assert.equal(initialCats.status, 200);
    assert.deepEqual(
      initialCats.json.categories.map((c) => c.name),
      ['Kerja', 'Pribadi', 'Belanja']
    );

    const dupDefault = await ctx.request('/api/categories', {
      method: 'POST',
      cookie: cookieA,
      body: { name: 'kerja' },
    });
    assert.equal(dupDefault.status, 409);

    const createdCat = await ctx.request('/api/categories', {
      method: 'POST',
      cookie: cookieA,
      body: { name: 'Kuliah', color: 'violet', icon: 'book' },
    });
    assert.equal(createdCat.status, 201);
    assert.equal(createdCat.json.category.name, 'Kuliah');
    assert.equal(createdCat.json.category.color, 'violet');
    assert.equal(createdCat.json.category.icon, 'book');

    // Edit category name, color, and icon (including starter category!)
    const kerjaCat = initialCats.json.categories.find((c) => c.name === 'Kerja');
    const editedKerja = await ctx.request(`/api/categories/${kerjaCat.id}`, {
      method: 'PATCH',
      cookie: cookieA,
      body: { name: 'Kantor', color: 'rose', icon: 'zap' },
    });
    assert.equal(editedKerja.status, 200);
    assert.equal(editedKerja.json.category.name, 'Kantor');
    assert.equal(editedKerja.json.category.color, 'rose');
    assert.equal(editedKerja.json.category.icon, 'zap');

    // User B does not see User A's custom or edited categories
    const catsB = await ctx.request('/api/categories', { cookie: cookieB });
    assert.deepEqual(
      catsB.json.categories.map((c) => c.name),
      ['Kerja', 'Pribadi', 'Belanja']
    );

    // Assign custom category to a task, then delete the category (task remains, category unlinked)
    const taskRes = await ctx.request('/api/tasks', {
      method: 'POST',
      cookie: cookieA,
      body: { title: 'Kerjakan tugas kuliah', category: 'Kuliah' },
    });
    assert.equal(taskRes.status, 201);
    assert.equal(taskRes.json.task.category, 'Kuliah');
    assert.equal(taskRes.json.task.categories.length, 1);

    const delCat = await ctx.request(`/api/categories/${createdCat.json.category.id}`, {
      method: 'DELETE',
      cookie: cookieA,
    });
    assert.equal(delCat.status, 204);

    const tasksAfterDel = await ctx.request('/api/tasks', { cookie: cookieA });
    assert.equal(tasksAfterDel.json.tasks.length, 1);
    assert.equal(tasksAfterDel.json.tasks[0].category, null);
    assert.deepEqual(tasksAfterDel.json.tasks[0].categories, []);
  });

  it('handles due_at, priority, category filtering, sorting, and dashboard summary', async () => {
    const reg = await ctx.request('/api/auth/register', {
      method: 'POST',
      body: { username: 'dash_user', password: 'password123' },
    });
    const cookie = extractCookie(reg.headers.get('set-cookie'));

    const invalidPriority = await ctx.request('/api/tasks', {
      method: 'POST',
      cookie,
      body: { title: 'Test', priority: 'urgent' },
    });
    assert.equal(invalidPriority.status, 400);

    const invalidDate = await ctx.request('/api/tasks', {
      method: 'POST',
      cookie,
      body: { title: 'Test', due_at: '2026-02-30T10:00' },
    });
    assert.equal(invalidDate.status, 400);

    // 1. Overdue high-priority task in Kerja
    const t1 = await ctx.request('/api/tasks', {
      method: 'POST',
      cookie,
      body: {
        title: 'Kirim laporan',
        priority: 'high',
        category: 'Kerja',
        due_at: '2026-11-25T09:00',
      },
    });
    assert.equal(t1.status, 201);

    // 2. Due today medium-priority task in Belanja
    const t2 = await ctx.request('/api/tasks', {
      method: 'POST',
      cookie,
      body: {
        title: 'Beli bahan makan',
        priority: 'medium',
        category: 'Belanja',
        due_at: '2026-11-26T18:00',
      },
    });
    assert.equal(t2.status, 201);

    // 3. Completed high-priority task in Kerja
    const t3 = await ctx.request('/api/tasks', {
      method: 'POST',
      cookie,
      body: {
        title: 'Review PR',
        priority: 'high',
        category: 'Kerja',
        due_at: '2026-11-26T08:00',
      },
    });
    await ctx.request(`/api/tasks/${t3.json.task.id}`, {
      method: 'PATCH',
      cookie,
      body: { completed: true },
    });

    // 4. Low-priority task without due date
    const t4 = await ctx.request('/api/tasks', {
      method: 'POST',
      cookie,
      body: {
        title: 'Rapikan meja',
        priority: 'low',
        category: 'Pribadi',
      },
    });
    assert.equal(t4.status, 201);

    const nowQuery = 'now=2026-11-26T10:00';

    const allRes = await ctx.request(`/api/tasks?${nowQuery}`, { cookie });
    assert.equal(allRes.status, 200);
    assert.equal(allRes.json.summary.total, 4);
    assert.equal(allRes.json.summary.active, 3);
    assert.equal(allRes.json.summary.completed, 1);
    assert.equal(allRes.json.summary.completionRate, 25);
    assert.equal(allRes.json.summary.dueToday, 1);
    assert.equal(allRes.json.summary.overdue, 1);
    assert.equal(allRes.json.summary.highPriority, 1);
    assert.deepEqual(
      allRes.json.summary.byCategory.map(({ name, total, active, completed }) => ({
        name,
        total,
        active,
        completed,
      })),
      [
        { name: 'Kerja', total: 2, active: 1, completed: 1 },
        { name: 'Belanja', total: 1, active: 1, completed: 0 },
        { name: 'Pribadi', total: 1, active: 1, completed: 0 },
      ]
    );

    const todayRes = await ctx.request(`/api/tasks?status=active&due=today&${nowQuery}`, { cookie });
    assert.equal(todayRes.json.tasks.length, 1);
    assert.equal(todayRes.json.tasks[0].id, t2.json.task.id);

    const overdueRes = await ctx.request(`/api/tasks?status=active&due=overdue&${nowQuery}`, { cookie });
    assert.equal(overdueRes.json.tasks.length, 1);
    assert.equal(overdueRes.json.tasks[0].id, t1.json.task.id);

    const highKerjaRes = await ctx.request(
      `/api/tasks?status=active&priority=high&category=Kerja&${nowQuery}`,
      { cookie }
    );
    assert.equal(highKerjaRes.json.tasks.length, 1);
    assert.equal(highKerjaRes.json.tasks[0].id, t1.json.task.id);

    const sortedByDue = await ctx.request(`/api/tasks?sort=due_asc&${nowQuery}`, { cookie });
    assert.deepEqual(
      sortedByDue.json.tasks.map((t) => t.id),
      [t1.json.task.id, t2.json.task.id, t4.json.task.id, t3.json.task.id]
    );

    const sortedByPriority = await ctx.request(`/api/tasks?sort=priority_desc&${nowQuery}`, { cookie });
    assert.deepEqual(
      sortedByPriority.json.tasks.map((t) => t.id),
      [t1.json.task.id, t2.json.task.id, t4.json.task.id, t3.json.task.id]
    );
  });

  it('migrates legacy users and tasks for description, auto_complete_subtasks, and subtasks table', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-submigrate-'));
    const tempDbPath = path.join(tempDir, 'legacy.db');

    let migratedDb;
    try {
      const legacyDb = new DatabaseSync(tempDbPath);
      legacyDb.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE COLLATE NOCASE,
          password_hash TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          completed INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO users (username, password_hash) VALUES ('legacy_u', 'salt:hash');
      `);
      legacyDb.close();

      migratedDb = createDatabase(tempDbPath);
      const userCols = migratedDb
        .prepare('PRAGMA table_info(users)')
        .all()
        .map((c) => c.name);
      const taskCols = migratedDb
        .prepare('PRAGMA table_info(tasks)')
        .all()
        .map((c) => c.name);
      const subtaskTable = migratedDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'subtasks'")
        .get();

      assert.ok(userCols.includes('auto_complete_subtasks'));
      assert.ok(taskCols.includes('description'));
      assert.equal(subtaskTable?.name, 'subtasks');

      const userRow = migratedDb.prepare('SELECT auto_complete_subtasks FROM users WHERE id = 1').get();
      assert.equal(userRow.auto_complete_subtasks, 1);
    } finally {
      if (migratedDb) migratedDb.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('supports task description, nested subtasks, progress stats, and auto-complete setting', async () => {
    const userRes = await ctx.request('/api/auth/register', {
      method: 'POST',
      body: { username: 'sub_user', password: 'password123' },
    });
    assert.equal(userRes.status, 201);
    assert.equal(userRes.json.user.auto_complete_subtasks, true);
    const cookie = extractCookie(userRes.headers.get('set-cookie'));

    const otherUserRes = await ctx.request('/api/auth/register', {
      method: 'POST',
      body: { username: 'other_sub', password: 'password123' },
    });
    const otherCookie = extractCookie(otherUserRes.headers.get('set-cookie'));

    const created = await ctx.request('/api/tasks', {
      method: 'POST',
      cookie,
      body: {
        title: 'Rilis Aplikasi',
        description: 'Checklist rilis:\n- Jalankan test\n- Cek https://example.com',
      },
    });
    assert.equal(created.status, 201);
    assert.equal(
      created.json.task.description,
      'Checklist rilis:\n- Jalankan test\n- Cek https://example.com'
    );
    assert.deepEqual(created.json.task.subtask_stats, { total: 0, completed: 0, percent: 0 });
    const taskId = created.json.task.id;

    // Update description
    const updatedDesc = await ctx.request(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      cookie,
      body: { description: 'Catatan baru' },
    });
    assert.equal(updatedDesc.status, 200);
    assert.equal(updatedDesc.json.task.description, 'Catatan baru');

    // Add 2 subtasks
    const s1 = await ctx.request(`/api/tasks/${taskId}/subtasks`, {
      method: 'POST',
      cookie,
      body: { title: 'Langkah 1' },
    });
    assert.equal(s1.status, 201);
    assert.deepEqual(s1.json.task.subtask_stats, { total: 1, completed: 0, percent: 0 });

    const s2 = await ctx.request(`/api/tasks/${taskId}/subtasks`, {
      method: 'POST',
      cookie,
      body: { title: 'Langkah 2' },
    });
    assert.equal(s2.status, 201);
    assert.deepEqual(s2.json.task.subtask_stats, { total: 2, completed: 0, percent: 0 });

    // Other user cannot add or toggle subtask on this task
    const forbiddenSub = await ctx.request(`/api/tasks/${taskId}/subtasks`, {
      method: 'POST',
      cookie: otherCookie,
      body: { title: 'Penyusup' },
    });
    assert.equal(forbiddenSub.status, 404);

    // Check first subtask -> 50%, parent still active
    const check1 = await ctx.request(`/api/tasks/${taskId}/subtasks/${s1.json.subtask.id}`, {
      method: 'PATCH',
      cookie,
      body: { completed: true },
    });
    assert.equal(check1.status, 200);
    assert.deepEqual(check1.json.task.subtask_stats, { total: 2, completed: 1, percent: 50 });
    assert.equal(check1.json.task.completed, false);

    // Check second subtask -> 100%, parent auto-completes (setting is ON)
    const check2 = await ctx.request(`/api/tasks/${taskId}/subtasks/${s2.json.subtask.id}`, {
      method: 'PATCH',
      cookie,
      body: { completed: true },
    });
    assert.equal(check2.status, 200);
    assert.deepEqual(check2.json.task.subtask_stats, { total: 2, completed: 2, percent: 100 });
    assert.equal(check2.json.task.completed, true);

    // Uncheck first subtask -> parent automatically reverts to active
    const uncheck1 = await ctx.request(`/api/tasks/${taskId}/subtasks/${s1.json.subtask.id}`, {
      method: 'PATCH',
      cookie,
      body: { completed: false },
    });
    assert.equal(uncheck1.status, 200);
    assert.equal(uncheck1.json.task.completed, false);

    // Check parent task -> all subtasks auto-complete
    const checkParent = await ctx.request(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      cookie,
      body: { completed: true },
    });
    assert.equal(checkParent.status, 200);
    assert.deepEqual(checkParent.json.task.subtask_stats, { total: 2, completed: 2, percent: 100 });
    assert.equal(checkParent.json.task.subtasks.every((s) => s.completed), true);

    // Turn OFF auto_complete_subtasks preference and verify independent behavior
    const prefOff = await ctx.request('/api/auth/preferences', {
      method: 'PATCH',
      cookie,
      body: { auto_complete_subtasks: false },
    });
    assert.equal(prefOff.status, 200);
    assert.equal(prefOff.json.user.auto_complete_subtasks, false);

    const t2 = await ctx.request('/api/tasks', {
      method: 'POST',
      cookie,
      body: { title: 'Tugas independen' },
    });
    const t2Sub = await ctx.request(`/api/tasks/${t2.json.task.id}/subtasks`, {
      method: 'POST',
      cookie,
      body: { title: 'Sub independen' },
    });
    const t2CheckSub = await ctx.request(
      `/api/tasks/${t2.json.task.id}/subtasks/${t2Sub.json.subtask.id}`,
      {
        method: 'PATCH',
        cookie,
        body: { completed: true },
      }
    );
    assert.equal(t2CheckSub.status, 200);
    assert.deepEqual(t2CheckSub.json.task.subtask_stats, { total: 1, completed: 1, percent: 100 });
    assert.equal(t2CheckSub.json.task.completed, false);

    // Delete subtask
    const delSub = await ctx.request(
      `/api/tasks/${t2.json.task.id}/subtasks/${t2Sub.json.subtask.id}`,
      {
        method: 'DELETE',
        cookie,
      }
    );
    assert.equal(delSub.status, 200);
    assert.deepEqual(delSub.json.task.subtask_stats, { total: 0, completed: 0, percent: 0 });
  });

  it('migrates legacy users table with profile, security question, theme, and auto-lock columns', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-profmigrate-'));
    const tempDbPath = path.join(tempDir, 'legacy.db');

    let migratedDb;
    try {
      const legacyDb = new DatabaseSync(tempDbPath);
      legacyDb.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE COLLATE NOCASE,
          password_hash TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO users (username, password_hash) VALUES ('old_profile', 'salt:hash');
      `);
      legacyDb.close();

      migratedDb = createDatabase(tempDbPath);
      const cols = new Set(
        migratedDb
          .prepare('PRAGMA table_info(users)')
          .all()
          .map((c) => c.name)
      );
      for (const expected of [
        'display_name',
        'avatar',
        'security_question',
        'security_answer_hash',
        'theme',
        'accent_color',
        'auto_lock_minutes',
        'auto_complete_subtasks',
      ]) {
        assert.ok(cols.has(expected), `Missing migrated column ${expected}`);
      }

      const row = migratedDb.prepare('SELECT theme, accent_color, auto_lock_minutes FROM users WHERE id = 1').get();
      assert.equal(row.theme, 'light');
      assert.equal(row.accent_color, 'indigo');
      assert.equal(row.auto_lock_minutes, 0);
    } finally {
      if (migratedDb) migratedDb.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('supports PIN registration, profile identity updates, account switcher, security question recovery, and unlock', async () => {
    // Register with 4-digit PIN, display_name, emoji avatar, and security question
    const regPin = await ctx.request('/api/auth/register', {
      method: 'POST',
      body: {
        username: 'pin_user',
        password: '1234',
        display_name: 'Rina Pin',
        avatar: 'emoji:🚀',
        security_question: 'Kota kelahiran ibu?',
        security_answer: 'Bandung',
      },
    });
    assert.equal(regPin.status, 201);
    assert.equal(regPin.json.user.display_name, 'Rina Pin');
    assert.equal(regPin.json.user.avatar, 'emoji:🚀');
    assert.equal(regPin.json.user.has_security_question, true);
    const cookie = extractCookie(regPin.headers.get('set-cookie'));

    // Register second account for switcher
    const reg2 = await ctx.request('/api/auth/register', {
      method: 'POST',
      body: { username: 'second_acc', password: 'password123' },
    });
    assert.equal(reg2.status, 201);
    const cookie2 = extractCookie(reg2.headers.get('set-cookie'));

    // Account switcher lists local accounts safely
    const accountsRes = await ctx.request('/api/auth/accounts');
    assert.equal(accountsRes.status, 200);
    assert.equal(accountsRes.json.accounts.length, 2);
    assert.equal(accountsRes.json.accounts[0].password_hash, undefined);

    // Update profile display_name, username (unique conflict vs success), and base64 image avatar
    const conflictUsername = await ctx.request('/api/profile', {
      method: 'PATCH',
      cookie,
      body: { username: 'SECOND_ACC' },
    });
    assert.equal(conflictUsername.status, 409);

    const samplePngDataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const updatedProfile = await ctx.request('/api/profile', {
      method: 'PATCH',
      cookie,
      body: {
        display_name: 'Rina Update',
        username: 'rina_u',
        avatar: samplePngDataUrl,
      },
    });
    assert.equal(updatedProfile.status, 200);
    assert.equal(updatedProfile.json.user.display_name, 'Rina Update');
    assert.equal(updatedProfile.json.user.username, 'rina_u');
    assert.equal(updatedProfile.json.user.avatar, samplePngDataUrl);

    // Change PIN -> 567890
    const badChange = await ctx.request('/api/profile/password', {
      method: 'PATCH',
      cookie,
      body: { current_password: '9999', new_password: '567890' },
    });
    assert.equal(badChange.status, 401);

    const goodChange = await ctx.request('/api/profile/password', {
      method: 'PATCH',
      cookie,
      body: { current_password: '1234', new_password: '567890' },
    });
    assert.equal(goodChange.status, 200);

    // Unlock verification
    const badUnlock = await ctx.request('/api/auth/unlock', {
      method: 'POST',
      cookie,
      body: { password: '1234' },
    });
    assert.equal(badUnlock.status, 401);

    const goodUnlock = await ctx.request('/api/auth/unlock', {
      method: 'POST',
      cookie,
      body: { password: '567890' },
    });
    assert.equal(goodUnlock.status, 200);
    assert.equal(goodUnlock.json.unlocked, true);

    // Security question recovery flow (case-insensitive answer)
    const getQuestion = await ctx.request('/api/auth/recover/question', {
      method: 'POST',
      body: { username: 'rina_u' },
    });
    assert.equal(getQuestion.status, 200);
    assert.equal(getQuestion.json.security_question, 'Kota kelahiran ibu?');

    const wrongRecovery = await ctx.request('/api/auth/recover/reset', {
      method: 'POST',
      body: {
        username: 'rina_u',
        security_answer: 'Jakarta',
        new_password: 'newpass123',
      },
    });
    assert.equal(wrongRecovery.status, 401);

    const goodRecovery = await ctx.request('/api/auth/recover/reset', {
      method: 'POST',
      body: {
        username: 'rina_u',
        security_answer: '  bandung ',
        new_password: 'newpass123',
      },
    });
    assert.equal(goodRecovery.status, 200);
    const recoveredCookie = extractCookie(goodRecovery.headers.get('set-cookie'));

    // Old session invalidated after recovery; new login with newpass123 works
    const oldSessionMe = await ctx.request('/api/auth/me', { cookie });
    assert.equal(oldSessionMe.status, 401);

    const newSessionMe = await ctx.request('/api/auth/me', { cookie: recoveredCookie });
    assert.equal(newSessionMe.status, 200);

    // Update security question via profile endpoint
    const updateSecQ = await ctx.request('/api/profile/security-question', {
      method: 'PATCH',
      cookie: recoveredCookie,
      body: {
        current_password: 'newpass123',
        security_question: 'Makanan favorit?',
        security_answer: 'Rendang',
      },
    });
    assert.equal(updateSecQ.status, 200);
    assert.equal(updateSecQ.json.user.security_question, 'Makanan favorit?');

    // Delete second_acc permanently
    const delSecondBad = await ctx.request('/api/profile', {
      method: 'DELETE',
      cookie: cookie2,
      body: { password: 'wrong' },
    });
    assert.equal(delSecondBad.status, 401);

    const delSecondGood = await ctx.request('/api/profile', {
      method: 'DELETE',
      cookie: cookie2,
      body: { password: 'password123' },
    });
    assert.equal(delSecondGood.status, 204);

    const accountsAfterDel = await ctx.request('/api/auth/accounts');
    assert.equal(accountsAfterDel.json.accounts.length, 1);
  });

  it('supports theme/accent/auto-lock preferences, JSON export/import (merge & replace), and task reset', async () => {
    const reg = await ctx.request('/api/auth/register', {
      method: 'POST',
      body: { username: 'backup_user', password: 'password123' },
    });
    const cookie = extractCookie(reg.headers.get('set-cookie'));

    // Preferences
    const prefRes = await ctx.request('/api/profile/preferences', {
      method: 'PATCH',
      cookie,
      body: {
        theme: 'dark',
        accent_color: 'emerald',
        auto_lock_minutes: 5,
        auto_complete_subtasks: false,
      },
    });
    assert.equal(prefRes.status, 200);
    assert.equal(prefRes.json.user.theme, 'dark');
    assert.equal(prefRes.json.user.accent_color, 'emerald');
    assert.equal(prefRes.json.user.auto_lock_minutes, 5);
    assert.equal(prefRes.json.user.auto_complete_subtasks, false);

    // Create task + description + subtask + custom category
    const t1 = await ctx.request('/api/tasks', {
      method: 'POST',
      cookie,
      body: {
        title: 'Tugas Cadangan',
        description: 'Detail penting\n- Poin 1',
        priority: 'high',
        category: 'Proyek',
        due_at: '2026-12-01T09:30',
      },
    });
    assert.equal(t1.status, 201);
    await ctx.request(`/api/tasks/${t1.json.task.id}/subtasks`, {
      method: 'POST',
      cookie,
      body: { title: 'Sub langkah A' },
    });

    // Export backup JSON
    const exportRes = await ctx.request('/api/profile/export', { cookie });
    assert.equal(exportRes.status, 200);
    const backupBundle = exportRes.json;
    assert.equal(backupBundle.version, 1);
    assert.equal(backupBundle.profile.theme, 'dark');
    assert.equal(backupBundle.tasks.length, 1);
    assert.equal(backupBundle.tasks[0].subtasks.length, 1);
    assert.ok(backupBundle.categories.some((c) => c.name === 'Proyek'));

    // Reset all tasks (keeps account!)
    const resetRes = await ctx.request('/api/profile/reset-tasks', {
      method: 'POST',
      cookie,
      body: { password: 'password123' },
    });
    assert.equal(resetRes.status, 200);
    assert.equal(resetRes.json.deleted_tasks, 1);

    const afterReset = await ctx.request('/api/tasks', { cookie });
    assert.equal(afterReset.json.tasks.length, 0);

    // Create 1 extra task before testing merge import
    await ctx.request('/api/tasks', {
      method: 'POST',
      cookie,
      body: { title: 'Tugas Sementara' },
    });

    // Import mode: merge (1 existing + 1 imported = 2)
    const mergeRes = await ctx.request('/api/profile/import', {
      method: 'POST',
      cookie,
      body: { mode: 'merge', data: backupBundle },
    });
    assert.equal(mergeRes.status, 200);
    assert.equal(mergeRes.json.imported.tasks, 1);
    assert.equal(mergeRes.json.imported.subtasks, 1);

    const afterMerge = await ctx.request('/api/tasks', { cookie });
    assert.equal(afterMerge.json.tasks.length, 2);

    // Import mode: replace (replaces the 2 tasks with just the 1 from backup)
    const replaceRes = await ctx.request('/api/profile/import', {
      method: 'POST',
      cookie,
      body: { mode: 'replace', data: backupBundle },
    });
    assert.equal(replaceRes.status, 200);

    const afterReplace = await ctx.request('/api/tasks', { cookie });
    assert.equal(afterReplace.json.tasks.length, 1);
    assert.equal(afterReplace.json.tasks[0].title, 'Tugas Cadangan');
    assert.equal(afterReplace.json.tasks[0].description, 'Detail penting\n- Poin 1');
    assert.equal(afterReplace.json.tasks[0].subtasks.length, 1);
  });

  it('supports multi-category assignment, AND/OR filtering, and legacy category migration', async () => {
    // 1. Legacy single-category backfill migration
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-multicat-'));
    const tempDbPath = path.join(tempDir, 'legacy.db');
    let migratedDb;
    try {
      const legacyDb = new DatabaseSync(tempDbPath);
      legacyDb.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE COLLATE NOCASE,
          password_hash TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          completed INTEGER NOT NULL DEFAULT 0,
          category TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO users (username, password_hash) VALUES ('legacy_mc', 'salt:hash');
        INSERT INTO tasks (user_id, title, category) VALUES (1, 'Tugas lama', 'Kerja');
      `);
      legacyDb.close();

      migratedDb = createDatabase(tempDbPath);
      const linked = migratedDb
        .prepare(
          `SELECT c.name FROM task_categories tc
           JOIN categories c ON c.id = tc.category_id
           WHERE tc.task_id = 1`
        )
        .all();
      assert.deepEqual(
        linked.map((r) => r.name),
        ['Kerja']
      );
    } finally {
      if (migratedDb) migratedDb.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    // 2. Multi-category assignment and AND/OR filtering via API
    const reg = await ctx.request('/api/auth/register', {
      method: 'POST',
      body: { username: 'multi_user', password: 'password123' },
    });
    const cookie = extractCookie(reg.headers.get('set-cookie'));

    const urgentCat = await ctx.request('/api/categories', {
      method: 'POST',
      cookie,
      body: { name: 'Urgent', color: 'rose', icon: 'zap' },
    });
    assert.equal(urgentCat.status, 201);
    const cats = urgentCat.json.categories;
    const kerjaId = cats.find((c) => c.name === 'Kerja').id;
    const pribadiId = cats.find((c) => c.name === 'Pribadi').id;
    const urgentId = urgentCat.json.category.id;

    // Task A: Kerja + Urgent
    const taskA = await ctx.request('/api/tasks', {
      method: 'POST',
      cookie,
      body: { title: 'Presentasi Klien', category_ids: [kerjaId, urgentId] },
    });
    assert.equal(taskA.status, 201);
    assert.deepEqual(
      taskA.json.task.categories.map((c) => c.name),
      ['Kerja', 'Urgent']
    );

    // Task B: Kerja only
    const taskB = await ctx.request('/api/tasks', {
      method: 'POST',
      cookie,
      body: { title: 'Rapikan Dokumen', category_ids: [kerjaId] },
    });
    assert.equal(taskB.status, 201);

    // Task C: Pribadi + Urgent
    const taskC = await ctx.request('/api/tasks', {
      method: 'POST',
      cookie,
      body: { title: 'Bayar Listrik', category_ids: [pribadiId, urgentId] },
    });
    assert.equal(taskC.status, 201);

    // Task D: No categories
    const taskD = await ctx.request('/api/tasks', {
      method: 'POST',
      cookie,
      body: { title: 'Catatan Lepas' },
    });
    assert.equal(taskD.status, 201);

    // Filter AND: Kerja AND Urgent -> only Task A
    const andFilter = await ctx.request(
      `/api/tasks?category_ids=${kerjaId},${urgentId}&category_mode=and`,
      { cookie }
    );
    assert.equal(andFilter.status, 200);
    assert.deepEqual(
      andFilter.json.tasks.map((t) => t.id),
      [taskA.json.task.id]
    );

    // Filter OR: Kerja OR Pribadi -> Task C, B, A
    const orFilter = await ctx.request(
      `/api/tasks?category_ids=${kerjaId},${pribadiId}&category_mode=or`,
      { cookie }
    );
    assert.equal(orFilter.status, 200);
    assert.equal(orFilter.json.tasks.length, 3);

    // Filter none -> only Task D
    const noneFilter = await ctx.request('/api/tasks?category=none', { cookie });
    assert.equal(noneFilter.status, 200);
    assert.deepEqual(
      noneFilter.json.tasks.map((t) => t.id),
      [taskD.json.task.id]
    );

    // Deleting Urgent unlinks it from Task A and Task C without deleting the tasks
    const delUrgent = await ctx.request(`/api/categories/${urgentId}`, {
      method: 'DELETE',
      cookie,
    });
    assert.equal(delUrgent.status, 204);

    const afterDelete = await ctx.request('/api/tasks', { cookie });
    assert.equal(afterDelete.json.tasks.length, 4);
    const updatedTaskA = afterDelete.json.tasks.find((t) => t.id === taskA.json.task.id);
    assert.deepEqual(
      updatedTaskA.categories.map((c) => c.name),
      ['Kerja']
    );
  });

  it('serves all modular ES component scripts and CSS stylesheets without broken imports', async () => {
    const htmlRes = await ctx.request('/');
    assert.equal(htmlRes.status, 200);
    assert.match(htmlRes.text, /<script type="module" src="\/js\/main\.js"><\/script>/);

    const stylesRes = await ctx.request('/styles.css');
    assert.equal(stylesRes.status, 200);

    const cssImports = [...stylesRes.text.matchAll(/@import\s+url\(['"]([^'"]+)['"]\)/g)].map(
      (m) => m[1]
    );
    assert.ok(cssImports.length >= 6);
    for (const cssPath of cssImports) {
      const res = await ctx.request(cssPath);
      assert.equal(res.status, 200, `Expected 200 for ${cssPath}`);
    }

    // Recursively verify every ES module import starting from /js/main.js
    const visited = new Set();
    const queue = ['/js/main.js'];
    while (queue.length > 0) {
      const currentPath = queue.shift();
      if (visited.has(currentPath)) {
        continue;
      }
      visited.add(currentPath);

      const res = await ctx.request(currentPath);
      assert.equal(res.status, 200, `Expected 200 for ES module ${currentPath}`);

      const importMatches = [...res.text.matchAll(/from\s+['"](\.[^'"]+)['"]/g)].map((m) => m[1]);
      for (const relImport of importMatches) {
        const resolved = path.posix.normalize(
          path.posix.join(path.posix.dirname(currentPath), relImport)
        );
        queue.push(resolved);
      }
    }

    assert.ok(visited.size >= 15, `Expected at least 15 modular JS files, got ${visited.size}`);
  });

  it('serves embedded production assets when embeddedAssets option is configured', async () => {
    const db = createDatabase(':memory:');
    const embeddedApp = createApp(db, {
      embeddedAssets: {
        'public/index.html': Buffer.from('<!DOCTYPE html><html><body>Prod</body></html>'),
        'public/styles.css': Buffer.from('body{margin:0}'),
        'public/app.js': Buffer.from('console.log("prod");'),
      },
    });
    const server = await new Promise((resolve) => {
      const s = embeddedApp.listen(0, '127.0.0.1', () => resolve(s));
    });
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const htmlRes = await fetch(`${baseUrl}/`);
      assert.equal(htmlRes.status, 200);
      assert.match(htmlRes.headers.get('content-type'), /text\/html/);
      assert.equal(await htmlRes.text(), '<!DOCTYPE html><html><body>Prod</body></html>');

      const cssRes = await fetch(`${baseUrl}/styles.css`);
      assert.equal(cssRes.status, 200);
      assert.match(cssRes.headers.get('content-type'), /text\/css/);
      assert.equal(await cssRes.text(), 'body{margin:0}');

      const jsRes = await fetch(`${baseUrl}/app.js`);
      assert.equal(jsRes.status, 200);
      assert.match(jsRes.headers.get('content-type'), /application\/javascript/);
      assert.equal(await jsRes.text(), 'console.log("prod");');

      const apiRes = await fetch(`${baseUrl}/api/auth/accounts`);
      assert.equal(apiRes.status, 200);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      db.close();
    }
  });
});
