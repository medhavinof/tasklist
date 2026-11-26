const path = require('node:path');
const express = require('express');
const { createAuthRouter } = require('./auth');
const { createTasksRouter } = require('./tasks');
const { createCategoriesRouter } = require('./categories');
const { createProfileRouter } = require('./profile');

/**
 * Builds and configures the Express application with injected SQLite database.
 */
function createApp(db) {
  const app = express();

  app.use(express.json({ limit: '2mb' }));
  app.use('/api/auth', createAuthRouter(db));
  app.use('/api/tasks', createTasksRouter(db));
  app.use('/api/categories', createCategoriesRouter(db));
  app.use('/api/profile', createProfileRouter(db));

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Endpoint tidak ditemukan.' });
  });

  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Ukuran data melebihi batas maksimal 2 MB.' });
    }
    if (err && (err.type === 'entity.parse.failed' || (err instanceof SyntaxError && err.status === 400))) {
      return res.status(400).json({ error: 'Format JSON tidak valid.' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Terjadi kesalahan internal pada server.' });
  });

  return app;
}

module.exports = {
  createApp,
};
