const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createOwner } = require('../server/auth');
const { PROJECT_ROOT, loadConfig } = require('../server/config');
const { createHttpApp } = require('../server/http-app');
const {
  buildTelegramMessage,
  createApplicationRoutes,
} = require('../features/applications-routes');

function uniqueDatabasePath() {
  return path.join(PROJECT_ROOT, '.data', `applications-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite3`);
}

async function stop(server, app) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  app.close();
}

async function login(baseUrl) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.test', password: 'testing-password-123' }),
  });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}

function payload(overrides = {}) {
  return {
    parentName: 'Анна <script>',
    phone: '091234567',
    childName: 'Ани',
    grade: '3',
    lessonType: 'individual',
    mode: 'online',
    helpNeeded: 'Математика & чтение',
    language: 'ru',
    ...overrides,
  };
}

function telegramSuccessFetch(calls) {
  return async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, async json() { return { ok: true }; } };
  };
}

test('saves immutable snapshots, notifies once, protects and lists applications after restart', async () => {
  const databasePath = uniqueDatabasePath();
  const config = loadConfig({ databasePath, port: 0 });
  const telegramCalls = [];
  const routes = createApplicationRoutes({
    env: { TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_CHAT_ID: 'test-chat' },
    fetchImpl: telegramSuccessFetch(telegramCalls),
  });
  let app = createHttpApp(config, { featureRoutes: routes });
  createOwner(app.database, 'owner@example.test', 'testing-password-123');
  let server = await app.listen(0);
  let baseUrl = `http://127.0.0.1:${server.address().port}`;

  const blocked = await fetch(`${baseUrl}/api/admin/applications`);
  assert.equal(blocked.status, 401);

  const created = await fetch(`${baseUrl}/api/telegram`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload()),
  });
  assert.equal(created.status, 200);
  assert.deepEqual(await created.json(), { ok: true, applicationId: 1 });
  assert.equal(telegramCalls.length, 2);
  assert.match(JSON.parse(telegramCalls[1].options.body).text, /Анна &lt;script&gt;/);

  const application = app.database.prepare('SELECT * FROM applications').get();
  assert.ok(application.telegram_notified_at);
  assert.equal(application.telegram_error_code, null);
  const originalItems = app.database.prepare(`
    SELECT item_kind, item_key, name_snapshot FROM application_items ORDER BY id
  `).all().map((row) => ({ ...row }));
  assert.deepEqual(originalItems, [
    { item_kind: 'service', item_key: 'trial-lesson', name_snapshot: 'Пробное занятие' },
    { item_kind: 'lesson_type', item_key: 'individual', name_snapshot: 'Индивидуальное' },
    { item_kind: 'mode', item_key: 'online', name_snapshot: 'Онлайн' },
  ]);

  app.database.prepare(`
    UPDATE service_translations SET name = 'Изменённое название'
    WHERE language = 'ru' AND service_id = (SELECT id FROM services WHERE service_key = 'individual')
  `).run();
  await stop(server, app);

  app = createHttpApp(config, { featureRoutes: routes });
  server = await app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const cookie = await login(baseUrl);
  const list = await fetch(`${baseUrl}/api/admin/applications`, { headers: { Cookie: cookie } });
  assert.equal(list.status, 200);
  const listed = await list.json();
  assert.equal(listed.applications.length, 1);
  assert.equal(listed.applications[0].parentName, 'Анна <script>');
  assert.equal(listed.applications[0].status, 'new');

  const details = await fetch(`${baseUrl}/api/admin/applications?id=${application.id}`, { headers: { Cookie: cookie } });
  assert.equal(details.status, 200);
  const detailed = (await details.json()).application;
  assert.deepEqual(detailed.items.map((item) => item.name), ['Пробное занятие', 'Индивидуальное', 'Онлайн']);
  assert.deepEqual(detailed.price, { amount: null, currency: 'AMD', period: 'consultation' });
  await stop(server, app);
});

test('keeps the application and a safe error code when Telegram fails', async () => {
  const config = loadConfig({ databasePath: uniqueDatabasePath(), port: 0 });
  const routes = createApplicationRoutes({
    env: { TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_CHAT_ID: 'test-chat' },
    fetchImpl: async () => { throw new Error('network details must not escape'); },
  });
  const app = createHttpApp(config, { featureRoutes: routes });
  const server = await app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const response = await fetch(`${baseUrl}/api/telegram`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload({ parentName: 'Failure case' })),
  });
  assert.equal(response.status, 202);
  const warning = await response.json();
  assert.equal(warning.ok, true);
  assert.equal(warning.warning, 'telegram_unavailable');
  const saved = app.database.prepare('SELECT telegram_error_code FROM applications').get();
  assert.equal(saved.telegram_error_code, 'telegram_unavailable');
  assert.equal(app.database.prepare('SELECT COUNT(*) AS count FROM application_items').get().count, 3);
  await stop(server, app);
});

test('rejects invalid input before saving or contacting Telegram', async () => {
  let called = false;
  const config = loadConfig({ databasePath: uniqueDatabasePath(), port: 0 });
  const routes = createApplicationRoutes({
    env: { TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_CHAT_ID: 'test-chat' },
    fetchImpl: async () => { called = true; },
  });
  const app = createHttpApp(config, { featureRoutes: routes });
  const server = await app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${baseUrl}/api/telegram`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload({ phone: '123' })),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'invalid_phone');
  assert.equal(app.database.prepare('SELECT COUNT(*) AS count FROM applications').get().count, 0);
  assert.equal(called, false);
  assert.match(buildTelegramMessage(payload()), /Математика &amp; чтение/);
  await stop(server, app);
});
