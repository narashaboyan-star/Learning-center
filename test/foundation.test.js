const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createOwner } = require('../server/auth');
const { PROJECT_ROOT, loadConfig } = require('../server/config');
const { createHttpApp } = require('../server/http-app');

function uniqueDatabasePath() {
  return path.join(PROJECT_ROOT, '.data', `foundation-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite3`);
}

async function stop(server, app) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  app.close();
}

test('foundation migrates, protects admin and survives a restart', async () => {
  const databasePath = uniqueDatabasePath();
  const config = loadConfig({ databasePath, port: 0, sessionHours: 1 });
  let app = createHttpApp(config);
  createOwner(app.database, 'owner@example.test', 'testing-password-123');

  const services = app.database.prepare('SELECT service_key FROM services ORDER BY sort_order').all();
  assert.deepEqual(services.map((row) => row.service_key), ['trial-lesson', 'individual', 'group', 'online', 'offline']);
  assert.equal(app.database.prepare('SELECT COUNT(*) AS count FROM service_translations').get().count, 15);

  let server = await app.listen(0);
  let baseUrl = `http://127.0.0.1:${server.address().port}`;

  const blockedApi = await fetch(`${baseUrl}/api/admin/session`);
  assert.equal(blockedApi.status, 401);
  assert.deepEqual(await blockedApi.json(), { ok: false, code: 'authentication_required' });

  const blockedPage = await fetch(`${baseUrl}/admin/`, { redirect: 'manual' });
  assert.equal(blockedPage.status, 302);
  assert.equal(blockedPage.headers.get('location'), '/admin/login.html');

  const badOrigin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' },
    body: JSON.stringify({ email: 'owner@example.test', password: 'testing-password-123' }),
  });
  assert.equal(badOrigin.status, 403);

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.test', password: 'testing-password-123' }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.match(cookie, /^kostanyan_admin_session=/);

  const allowed = await fetch(`${baseUrl}/api/admin/session`, { headers: { Cookie: cookie } });
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).owner.email, 'owner@example.test');
  const allowedPage = await fetch(`${baseUrl}/admin/`, { headers: { Cookie: cookie } });
  assert.equal(allowedPage.status, 200);
  assert.match(await allowedPage.text(), /Общая защищённая основа готова/);

  app.database.prepare(`
    INSERT INTO applications (parent_name, phone, child_name, grade, language)
    VALUES ('Test parent', '091234567', 'Test child', '3', 'ru')
  `).run();
  await stop(server, app);

  let deliveredReset = null;
  app = createHttpApp(config, {
    deliverPasswordReset(message) { deliveredReset = message; },
  });
  assert.equal(app.database.prepare('SELECT COUNT(*) AS count FROM applications').get().count, 1);
  assert.equal(app.database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, 1);
  server = await app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const sessionAfterRestart = await fetch(`${baseUrl}/api/admin/session`, { headers: { Cookie: cookie } });
  assert.equal(sessionAfterRestart.status, 200);

  const resetRequest = await fetch(`${baseUrl}/api/auth/password-reset/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.test' }),
  });
  assert.equal(resetRequest.status, 202);
  assert.equal(deliveredReset.email, 'owner@example.test');
  assert.ok(deliveredReset.token);

  const resetConfirm = await fetch(`${baseUrl}/api/auth/password-reset/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: deliveredReset.token, password: 'new-testing-password-456' }),
  });
  assert.equal(resetConfirm.status, 200);
  const revokedSession = await fetch(`${baseUrl}/api/admin/session`, { headers: { Cookie: cookie } });
  assert.equal(revokedSession.status, 401);

  const loginWithNewPassword = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.test', password: 'new-testing-password-456' }),
  });
  assert.equal(loginWithNewPassword.status, 200);

  await stop(server, app);
});

test('production and database paths outside .data are refused', () => {
  assert.throws(() => loadConfig({ environment: 'production' }), /test-only/);
  assert.throws(() => loadConfig({ databasePath: '/tmp/not-project-data.sqlite3' }), /must stay inside/);
});
