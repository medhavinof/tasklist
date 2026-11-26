const path = require('node:path');
const { execFile } = require('node:child_process');
const { createDatabase } = require('./src/db');
const { createApp } = require('./src/app');

function isRunningAsSea() {
  try {
    return require('node:sea').isSea();
  } catch {
    return false;
  }
}

function openBrowser(url) {
  if (process.platform === 'win32') {
    execFile('cmd.exe', ['/c', 'start', '', url], { windowsHide: true }, () => {});
  } else if (process.platform === 'darwin') {
    execFile('open', [url], () => {});
  } else {
    execFile('xdg-open', [url], () => {});
  }
}

function listenWithFallback(app, preferredPort, allowFallback) {
  return new Promise((resolve, reject) => {
    const maxAttempts = allowFallback ? 10 : 0;

    function tryPort(port, attempt) {
      const server = app.listen(port, () => resolve(server));
      server.once('error', (err) => {
        if (err && err.code === 'EADDRINUSE' && allowFallback) {
          if (attempt < maxAttempts) {
            return tryPort(port + 1, attempt + 1);
          }
          if (attempt === maxAttempts) {
            return tryPort(0, attempt + 1);
          }
        }
        return reject(err);
      });
    }

    tryPort(preferredPort, 0);
  });
}

const isSea = isRunningAsSea();
const appRoot = isSea ? path.dirname(process.execPath) : __dirname;
const hasExplicitPort = Boolean(process.env.PORT);
const port = Number(process.env.PORT) || 3000;
const dbPath = process.env.DB_PATH || path.join(appRoot, 'data', 'todo.db');
const shouldOpenBrowser =
  isSea && !process.argv.includes('--no-open') && process.env.NO_OPEN !== '1';

const db = createDatabase(dbPath);
const app = createApp(db);

let activeServer = null;

listenWithFallback(app, port, isSea && !hasExplicitPort)
  .then((server) => {
    activeServer = server;
    const address = server.address();
    const activePort = typeof address === 'object' && address ? address.port : port;
    const url = `http://localhost:${activePort}`;
    console.log(`Simple Task List berjalan di ${url}`);
    console.log(`Database lokal: ${dbPath}`);
    if (shouldOpenBrowser) {
      openBrowser(url);
    }
  })
  .catch((err) => {
    console.error('Gagal menjalankan server:', err);
    db.close();
    process.exit(1);
  });

function shutdown() {
  if (!activeServer) {
    db.close();
    process.exit(0);
    return;
  }
  activeServer.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
