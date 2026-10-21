const crypto = require('node:crypto');

const COOKIE_NAME = 'kostanyan_admin_session';

function hashPassword(password, salt = crypto.randomBytes(16)) {
  if (String(password).length < 12) throw new Error('password_too_short');
  const derived = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

function verifyPassword(password, encoded) {
  const [algorithm, saltHex, hashHex] = String(encoded).split('$');
  if (algorithm !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createOwner(database, email, password) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) throw new Error('invalid_email');
  const passwordHash = hashPassword(password);
  database.prepare(`
    INSERT INTO owners (email, password_hash) VALUES (?, ?)
    ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, updated_at = CURRENT_TIMESTAMP
  `).run(normalizedEmail, passwordHash);
  return database.prepare('SELECT id, email FROM owners WHERE email = ?').get(normalizedEmail);
}

function authenticate(database, email, password) {
  const owner = database.prepare('SELECT id, email, password_hash FROM owners WHERE email = ? COLLATE NOCASE')
    .get(String(email || '').trim());
  return owner && verifyPassword(password, owner.password_hash) ? { id: owner.id, email: owner.email } : null;
}

function createSession(database, ownerId, sessionHours = 12) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + sessionHours * 60 * 60 * 1000).toISOString();
  database.prepare('INSERT INTO owner_sessions (token_hash, owner_id, expires_at) VALUES (?, ?, ?)')
    .run(hashToken(token), ownerId, expiresAt);
  return { token, expiresAt };
}

function ownerFromToken(database, token) {
  if (!token) return null;
  return database.prepare(`
    SELECT owners.id, owners.email
    FROM owner_sessions JOIN owners ON owners.id = owner_sessions.owner_id
    WHERE owner_sessions.token_hash = ? AND owner_sessions.expires_at > ?
  `).get(hashToken(token), new Date().toISOString()) || null;
}

function revokeSession(database, token) {
  if (token) database.prepare('DELETE FROM owner_sessions WHERE token_hash = ?').run(hashToken(token));
}

function requestPasswordReset(database, email, lifetimeMinutes = 30) {
  const owner = database.prepare('SELECT id FROM owners WHERE email = ? COLLATE NOCASE').get(String(email || '').trim());
  if (!owner) return null;
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + lifetimeMinutes * 60 * 1000).toISOString();
  database.prepare('INSERT INTO password_reset_tokens (token_hash, owner_id, expires_at) VALUES (?, ?, ?)')
    .run(hashToken(token), owner.id, expiresAt);
  return token;
}

function confirmPasswordReset(database, token, newPassword) {
  const row = database.prepare(`
    SELECT token_hash, owner_id FROM password_reset_tokens
    WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
  `).get(hashToken(token), new Date().toISOString());
  if (!row) return false;
  const passwordHash = hashPassword(newPassword);
  database.exec('BEGIN IMMEDIATE;');
  try {
    database.prepare('UPDATE owners SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(passwordHash, row.owner_id);
    database.prepare('UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE token_hash = ?')
      .run(row.token_hash);
    database.prepare('DELETE FROM owner_sessions WHERE owner_id = ?').run(row.owner_id);
    database.exec('COMMIT;');
    return true;
  } catch (error) {
    database.exec('ROLLBACK;');
    throw error;
  }
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => part.trim()).filter((part) => part.includes('=')).map((part) => {
    const separator = part.indexOf('=');
    return [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
  }));
}

function sessionCookie(token, secure = false) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${secure ? '; Secure' : ''}`;
}

function clearSessionCookie(secure = false) {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}

module.exports = {
  COOKIE_NAME,
  authenticate,
  clearSessionCookie,
  confirmPasswordReset,
  createOwner,
  createSession,
  hashPassword,
  ownerFromToken,
  parseCookies,
  requestPasswordReset,
  revokeSession,
  sessionCookie,
  verifyPassword,
};
