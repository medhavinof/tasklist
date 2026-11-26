const crypto = require('node:crypto');
const express = require('express');

const SESSION_COOKIE = 'tasklist_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const USERNAME_PATTERN = /^[a-zA-Z0-9._-]+$/;
const PIN_PATTERN = /^\d{4,6}$/;
const AVATAR_DATA_URL_PATTERN = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const MAX_AVATAR_LENGTH = 550 * 1024;

/**
 * Hashes a plaintext secret (password, PIN, or security answer) with a random salt using scrypt.
 */
function hashPassword(secret) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(secret, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

/**
 * Verifies a plaintext secret against a stored "salt:hash" string.
 */
function verifyPassword(secret, storedHash) {
  if (typeof secret !== 'string' || typeof storedHash !== 'string') {
    return false;
  }

  const parts = storedHash.split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return false;
  }

  const [salt, expectedHex] = parts;
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  const actualBuf = crypto.scryptSync(secret, salt, 64);

  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') {
    return cookies;
  }

  for (const pair of cookieHeader.split(';')) {
    const separatorIndex = pair.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }
    const key = pair.slice(0, separatorIndex).trim();
    const rawValue = pair.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }
    try {
      cookies[key] = decodeURIComponent(rawValue);
    } catch {
      cookies[key] = rawValue;
    }
  }

  return cookies;
}

function setSessionCookie(res, sessionId) {
  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });
}

function createSession(db, userId) {
  const sessionId = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(
    sessionId,
    userId,
    expiresAt
  );

  return sessionId;
}

function validateUsername(rawUsername) {
  if (typeof rawUsername !== 'string') {
    return { error: 'Username wajib diisi.' };
  }

  const trimmed = rawUsername.trim();
  if (trimmed.length < 3 || trimmed.length > 32) {
    return { error: 'Username harus terdiri dari 3 hingga 32 karakter.' };
  }

  if (!USERNAME_PATTERN.test(trimmed)) {
    return {
      error: 'Username hanya boleh berisi huruf, angka, titik (.), garis bawah (_), atau tanda hubung (-).',
    };
  }

  return { username: trimmed };
}

/**
 * Validates either a standard password (6-128 chars) or a 4-6 digit numeric PIN.
 */
function validateSecret(rawSecret, label = 'Password / PIN') {
  if (typeof rawSecret !== 'string' || !rawSecret) {
    return { error: `${label} wajib diisi.` };
  }

  if (rawSecret.length > 128) {
    return { error: `${label} maksimal 128 karakter.` };
  }

  if (rawSecret.length < 6 && !PIN_PATTERN.test(rawSecret)) {
    return {
      error: `${label} minimal 6 karakter atau gunakan PIN 4–6 digit angka.`,
    };
  }

  return { secret: rawSecret };
}

function validateDisplayName(rawName) {
  if (rawName === undefined || rawName === null) {
    return { displayName: null };
  }
  if (typeof rawName !== 'string') {
    return { error: 'Nama tampilan harus berupa teks.' };
  }
  const trimmed = rawName.trim();
  if (!trimmed) {
    return { displayName: null };
  }
  if (trimmed.length > 50) {
    return { error: 'Nama tampilan maksimal 50 karakter.' };
  }
  return { displayName: trimmed };
}

function validateAvatar(rawAvatar) {
  if (rawAvatar === undefined || rawAvatar === null || rawAvatar === '') {
    return { avatar: null };
  }
  if (typeof rawAvatar !== 'string') {
    return { error: 'Format avatar tidak valid.' };
  }

  const trimmed = rawAvatar.trim();
  if (!trimmed) {
    return { avatar: null };
  }

  if (trimmed.startsWith('emoji:')) {
    const emojiVal = trimmed.slice('emoji:'.length).trim();
    if (!emojiVal || trimmed.length > 32) {
      return { error: 'Avatar emoji tidak valid.' };
    }
    return { avatar: `emoji:${emojiVal}` };
  }

  if (trimmed.length > MAX_AVATAR_LENGTH) {
    return { error: 'Ukuran gambar avatar terlalu besar (maksimal ~400 KB).' };
  }

  if (!AVATAR_DATA_URL_PATTERN.test(trimmed)) {
    return { error: 'Format gambar avatar harus PNG, JPEG, WEBP, atau GIF.' };
  }

  return { avatar: trimmed };
}

function validateSecurityQuestionPair(rawQuestion, rawAnswer) {
  if (typeof rawQuestion !== 'string' || typeof rawAnswer !== 'string') {
    return { error: 'Pertanyaan dan jawaban keamanan wajib diisi.' };
  }

  const question = rawQuestion.trim();
  const answer = rawAnswer.trim().toLowerCase();

  if (question.length < 5 || question.length > 160) {
    return { error: 'Pertanyaan keamanan harus terdiri dari 5 hingga 160 karakter.' };
  }

  if (answer.length < 2 || answer.length > 100) {
    return { error: 'Jawaban keamanan minimal 2 karakter.' };
  }

  return { question, answer };
}

function serializeUser(row) {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name || row.username,
    avatar: row.avatar || null,
    has_security_question: Boolean(row.security_question && row.security_answer_hash),
    security_question: row.security_question || null,
    theme: row.theme || 'light',
    accent_color: row.accent_color || 'indigo',
    auto_lock_minutes: Number(row.auto_lock_minutes || 0),
    auto_complete_subtasks: Boolean(row.auto_complete_subtasks),
  };
}

const USER_PROFILE_COLUMNS = `
  u.id,
  u.username,
  u.display_name,
  u.avatar,
  u.security_question,
  u.security_answer_hash,
  u.theme,
  u.accent_color,
  u.auto_lock_minutes,
  u.auto_complete_subtasks
`;

/**
 * Middleware that authenticates requests via the SQLite-backed session cookie.
 */
function requireAuth(db) {
  const findSessionStmt = db.prepare(`
    SELECT s.id AS session_id, s.expires_at, ${USER_PROFILE_COLUMNS}
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ?
  `);
  const deleteSessionStmt = db.prepare('DELETE FROM sessions WHERE id = ?');

  return (req, res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    const sessionId = cookies[SESSION_COOKIE];

    if (!sessionId) {
      return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
    }

    const session = findSessionStmt.get(sessionId);
    if (!session) {
      clearSessionCookie(res);
      return res.status(401).json({ error: 'Sesi tidak valid. Silakan masuk kembali.' });
    }

    if (new Date(session.expires_at).getTime() <= Date.now()) {
      deleteSessionStmt.run(session.session_id);
      clearSessionCookie(res);
      return res.status(401).json({ error: 'Sesi telah berakhir. Silakan masuk kembali.' });
    }

    req.user = serializeUser(session);
    req.sessionId = session.session_id;
    return next();
  };
}

/**
 * Builds the Express router for local account registration, login, switcher, recovery, and unlock.
 */
function createAuthRouter(db) {
  const router = express.Router();
  const findByUsernameStmt = db.prepare(
    `SELECT u.password_hash, ${USER_PROFILE_COLUMNS} FROM users u WHERE u.username = ?`
  );
  const findByIdStmt = db.prepare(
    `SELECT u.password_hash, ${USER_PROFILE_COLUMNS} FROM users u WHERE u.id = ?`
  );
  const listAccountsStmt = db.prepare(`
    SELECT id, username, display_name, avatar, security_question, security_answer_hash
    FROM users
    ORDER BY username ASC
  `);
  const insertUserStmt = db.prepare(`
    INSERT INTO users (username, password_hash, display_name, avatar, security_question, security_answer_hash)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const updateAutoCompleteStmt = db.prepare(
    'UPDATE users SET auto_complete_subtasks = ? WHERE id = ?'
  );
  const updatePasswordStmt = db.prepare(
    'UPDATE users SET password_hash = ? WHERE id = ?'
  );
  const deleteUserSessionsStmt = db.prepare('DELETE FROM sessions WHERE user_id = ?');
  const deleteSessionStmt = db.prepare('DELETE FROM sessions WHERE id = ?');

  router.get('/accounts', (req, res) => {
    const rows = listAccountsStmt.all();
    return res.json({
      accounts: rows.map((row) => ({
        id: row.id,
        username: row.username,
        display_name: row.display_name || row.username,
        avatar: row.avatar || null,
        has_security_question: Boolean(row.security_question && row.security_answer_hash),
      })),
    });
  });

  router.post('/register', (req, res) => {
    const userValidation = validateUsername(req.body?.username);
    if (userValidation.error) {
      return res.status(400).json({ error: userValidation.error });
    }

    const secretValidation = validateSecret(req.body?.password);
    if (secretValidation.error) {
      return res.status(400).json({ error: secretValidation.error });
    }

    const nameValidation = validateDisplayName(req.body?.display_name);
    if (nameValidation.error) {
      return res.status(400).json({ error: nameValidation.error });
    }

    const avatarValidation = validateAvatar(req.body?.avatar);
    if (avatarValidation.error) {
      return res.status(400).json({ error: avatarValidation.error });
    }

    let secQuestion = null;
    let secAnswerHash = null;
    const rawQuestion = req.body?.security_question;
    const rawAnswer = req.body?.security_answer;
    if ((rawQuestion && String(rawQuestion).trim()) || (rawAnswer && String(rawAnswer).trim())) {
      const secValidation = validateSecurityQuestionPair(rawQuestion, rawAnswer);
      if (secValidation.error) {
        return res.status(400).json({ error: secValidation.error });
      }
      secQuestion = secValidation.question;
      secAnswerHash = hashPassword(secValidation.answer);
    }

    const existing = findByUsernameStmt.get(userValidation.username);
    if (existing) {
      return res.status(409).json({ error: 'Username sudah terdaftar. Gunakan username lain.' });
    }

    const passwordHash = hashPassword(secretValidation.secret);

    try {
      const result = insertUserStmt.run(
        userValidation.username,
        passwordHash,
        nameValidation.displayName,
        avatarValidation.avatar,
        secQuestion,
        secAnswerHash
      );
      const userId = Number(result.lastInsertRowid);
      const sessionId = createSession(db, userId);
      setSessionCookie(res, sessionId);

      const createdUser = findByIdStmt.get(userId);
      return res.status(201).json({
        user: serializeUser(createdUser),
      });
    } catch (err) {
      if (String(err?.message).includes('UNIQUE')) {
        return res.status(409).json({ error: 'Username sudah terdaftar. Gunakan username lain.' });
      }
      throw err;
    }
  });

  router.post('/login', (req, res) => {
    const rawUsername = req.body?.username;
    const rawPassword = req.body?.password;

    if (typeof rawUsername !== 'string' || typeof rawPassword !== 'string') {
      return res.status(400).json({ error: 'Username dan password/PIN wajib diisi.' });
    }

    const trimmedUsername = rawUsername.trim();
    if (!trimmedUsername || !rawPassword) {
      return res.status(400).json({ error: 'Username dan password/PIN wajib diisi.' });
    }

    const user = findByUsernameStmt.get(trimmedUsername);
    if (!user || !verifyPassword(rawPassword, user.password_hash)) {
      return res.status(401).json({ error: 'Username atau password/PIN salah.' });
    }

    const sessionId = createSession(db, user.id);
    setSessionCookie(res, sessionId);

    return res.json({
      user: serializeUser(user),
    });
  });

  router.post('/unlock', requireAuth(db), (req, res) => {
    const rawPassword = req.body?.password;
    if (typeof rawPassword !== 'string' || !rawPassword) {
      return res.status(400).json({ error: 'Masukkan password atau PIN untuk membuka kunci.' });
    }

    const user = findByIdStmt.get(req.user.id);
    if (!user || !verifyPassword(rawPassword, user.password_hash)) {
      return res.status(401).json({ error: 'Password atau PIN salah.' });
    }

    return res.json({ unlocked: true, user: serializeUser(user) });
  });

  router.post('/recover/question', (req, res) => {
    const rawUsername = req.body?.username;
    if (typeof rawUsername !== 'string' || !rawUsername.trim()) {
      return res.status(400).json({ error: 'Username wajib diisi.' });
    }

    const user = findByUsernameStmt.get(rawUsername.trim());
    if (!user) {
      return res.status(404).json({ error: 'Akun dengan username tersebut tidak ditemukan.' });
    }

    if (!user.security_question || !user.security_answer_hash) {
      return res.status(400).json({
        error: 'Akun ini belum mengatur pertanyaan keamanan lokal.',
      });
    }

    return res.json({
      username: user.username,
      security_question: user.security_question,
    });
  });

  router.post('/recover/reset', (req, res) => {
    const rawUsername = req.body?.username;
    const rawAnswer = req.body?.security_answer;
    const rawNewPassword = req.body?.new_password;

    if (typeof rawUsername !== 'string' || !rawUsername.trim()) {
      return res.status(400).json({ error: 'Username wajib diisi.' });
    }
    if (typeof rawAnswer !== 'string' || !rawAnswer.trim()) {
      return res.status(400).json({ error: 'Jawaban keamanan wajib diisi.' });
    }

    const secretValidation = validateSecret(rawNewPassword, 'Password / PIN baru');
    if (secretValidation.error) {
      return res.status(400).json({ error: secretValidation.error });
    }

    const user = findByUsernameStmt.get(rawUsername.trim());
    if (!user || !user.security_question || !user.security_answer_hash) {
      return res.status(400).json({ error: 'Pemulihan tidak tersedia untuk akun ini.' });
    }

    const normalizedAnswer = rawAnswer.trim().toLowerCase();
    if (!verifyPassword(normalizedAnswer, user.security_answer_hash)) {
      return res.status(401).json({ error: 'Jawaban keamanan tidak sesuai.' });
    }

    const newHash = hashPassword(secretValidation.secret);
    db.exec('BEGIN IMMEDIATE;');
    try {
      updatePasswordStmt.run(newHash, user.id);
      deleteUserSessionsStmt.run(user.id);
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }

    const sessionId = createSession(db, user.id);
    setSessionCookie(res, sessionId);
    const updatedUser = findByIdStmt.get(user.id);

    return res.json({
      user: serializeUser(updatedUser),
    });
  });

  router.post('/logout', (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const sessionId = cookies[SESSION_COOKIE];
    if (sessionId) {
      deleteSessionStmt.run(sessionId);
    }
    clearSessionCookie(res);
    return res.json({ ok: true });
  });

  router.get('/me', requireAuth(db), (req, res) => {
    return res.json({ user: req.user });
  });

  router.patch('/preferences', requireAuth(db), (req, res) => {
    const value = req.body?.auto_complete_subtasks;
    if (typeof value !== 'boolean') {
      return res.status(400).json({ error: 'auto_complete_subtasks harus berupa boolean.' });
    }

    updateAutoCompleteStmt.run(value ? 1 : 0, req.user.id);
    const updated = findByIdStmt.get(req.user.id);
    return res.json({
      user: serializeUser(updated),
    });
  });

  return router;
}

module.exports = {
  SESSION_COOKIE,
  hashPassword,
  verifyPassword,
  clearSessionCookie,
  validateUsername,
  validateSecret,
  validateDisplayName,
  validateAvatar,
  validateSecurityQuestionPair,
  serializeUser,
  requireAuth,
  createAuthRouter,
};
