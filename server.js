const path = require('node:path');
const { createDatabase } = require('./src/db');
const { createApp } = require('./src/app');

const port = Number(process.env.PORT) || 3000;
const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'todo.db');

const db = createDatabase(dbPath);
const app = createApp(db);

const server = app.listen(port, () => {
  console.log(`Simple Task List berjalan di http://localhost:${port}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
