const path = require('node:path');
const express = require('express');
const { createAuthRouter } = require('./auth');
const { createTasksRouter } = require('./tasks');
const { createCategoriesRouter } = require('./categories');
const { createProfileRouter } = require('./profile');

const EMBEDDED_ASSETS = {
  '/': { key: 'public/index.html', contentType: 'text/html; charset=utf-8' },
  '/index.html': { key: 'public/index.html', contentType: 'text/html; charset=utf-8' },
  '/styles.css': { key: 'public/styles.css', contentType: 'text/css; charset=utf-8' },
  '/app.js': { key: 'public/app.js', contentType: 'application/javascript; charset=utf-8' },
};

function getSeaModule() {
  try {
    return require('node:sea');
  } catch {
    return null;
  }
}

/**
 * Serves pre-bundled frontend assets when running inside a Node.js Single Executable
 * Application (SEA) or when `embeddedAssets` are explicitly provided in tests.
 */
function createEmbeddedAssetsMiddleware(embeddedAssets) {
  const sea = embeddedAssets ? null : getSeaModule();
  const isActive = Boolean(embeddedAssets) || Boolean(sea && sea.isSea());

  return (req, res, next) => {
    if (!isActive || (req.method !== 'GET' && req.method !== 'HEAD')) {
      return next();
    }

    const entry = EMBEDDED_ASSETS[req.path];
    if (!entry) {
      return next();
    }

    let body = null;
    if (embeddedAssets) {
      body = embeddedAssets[entry.key] ?? null;
    } else if (sea) {
      try {
        body = Buffer.from(sea.getRawAsset(entry.key));
      } catch {
        body = null;
      }
    }

    if (body === null || body === undefined) {
      return next();
    }

    res.setHeader('Content-Type', entry.contentType);
    if (req.method === 'HEAD') {
      return res.status(200).end();
    }
    return res.status(200).send(body);
  };
}

/**
 * Builds and configures the Express application with injected SQLite database.
 */
function createApp(db, options = {}) {
  const app = express();

  app.use(express.json({ limit: '2mb' }));
  app.use('/api/auth', createAuthRouter(db));
  app.use('/api/tasks', createTasksRouter(db));
  app.use('/api/categories', createCategoriesRouter(db));
  app.use('/api/profile', createProfileRouter(db));

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Endpoint tidak ditemukan.' });
  });

  app.use(createEmbeddedAssetsMiddleware(options.embeddedAssets));
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
