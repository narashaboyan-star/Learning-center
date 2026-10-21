const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const test = require('node:test');
const { createOwner } = require('../server/auth');
const { PROJECT_ROOT, loadConfig } = require('../server/config');
const { createHttpApp } = require('../server/http-app');
const serviceRoutes = require('../features/services-routes');
const { createApplicationRoutes } = require('../features/applications-routes');
const { createCustomerRoutes } = require('../features/customer-routes');

function uniqueDatabasePath() {
  return path.join(PROJECT_ROOT, '.data', `customer-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite3`);
}

async function stop(server, app) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  app.close();
}

function applicationPayload(overrides = {}) {
  return {
    parentName: 'Тестовый родитель', phone: '091234567', childName: 'Тестовый ребёнок', grade: '4',
    lessonType: 'group', mode: 'offline', helpNeeded: 'Учебный тест', language: 'ru',
    submissionKey: crypto.randomUUID(), ...overrides,
  };
}

async function mockLogin(baseUrl, persona) {
  const response = await fetch(`${baseUrl}/api/customer/auth/mock`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ persona }),
  });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}

async function ownerLogin(baseUrl) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.test', password: 'testing-password-123' }),
  });
  return response.headers.get('set-cookie').split(';')[0];
}

test('optional account links new applications, protects ownership and survives restart', async () => {
  const databasePath = uniqueDatabasePath();
  const config = loadConfig({ databasePath, port: 0, customerAuthMode: 'mock' });
  const telegramCalls = [];
  const applicationRoutes = createApplicationRoutes({
    env: { TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_CHAT_ID: 'test-chat' },
    fetchImpl: async (url) => {
      telegramCalls.push(url);
      return { ok: true, status: 200, async json() { return { ok: true }; } };
    },
  });
  const routes = [...serviceRoutes, ...applicationRoutes, ...createCustomerRoutes()];
  let app = createHttpApp(config, { featureRoutes: routes });
  createOwner(app.database, 'owner@example.test', 'testing-password-123');
  let server = await app.listen(0);
  let baseUrl = `http://127.0.0.1:${server.address().port}`;

  const guest = await fetch(`${baseUrl}/api/telegram`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(applicationPayload({ childName: 'Гостевая заявка' })),
  });
  assert.equal(guest.status, 200);

  const customerA = await mockLogin(baseUrl, 'parent-a');
  const invalidProfile = await fetch(`${baseUrl}/api/customer/profile`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: customerA },
    body: JSON.stringify({ parentName: 'Родитель A', phone: '123' }),
  });
  assert.equal(invalidProfile.status, 400);
  const profile = await fetch(`${baseUrl}/api/customer/profile`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: customerA },
    body: JSON.stringify({ parentName: 'Родитель A', phone: '091234567' }),
  });
  assert.equal(profile.status, 200);
  const rejectedOrigin = await fetch(`${baseUrl}/api/customer/profile`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: customerA, Origin: 'https://attacker.example' },
    body: JSON.stringify({ parentName: 'Чужой запрос', phone: '091234567' }),
  });
  assert.equal(rejectedOrigin.status, 403);

  const payload = applicationPayload({ customerId: 999999, childName: 'Ребёнок A' });
  const created = await fetch(`${baseUrl}/api/telegram`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: customerA },
    body: JSON.stringify(payload),
  });
  assert.equal(created.status, 200);
  const createdBody = await created.json();
  assert.equal(createdBody.ok, true);
  const callsAfterCreate = telegramCalls.length;

  const duplicate = await fetch(`${baseUrl}/api/telegram`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: customerA },
    body: JSON.stringify(payload),
  });
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).duplicate, true);
  assert.equal(telegramCalls.length, callsAfterCreate);

  const listA = await fetch(`${baseUrl}/api/customer/applications`, { headers: { Cookie: customerA } });
  const applicationsA = (await listA.json()).applications;
  assert.equal(applicationsA.length, 1);
  assert.equal(applicationsA[0].childName, 'Ребёнок A');
  assert.deepEqual(applicationsA[0].price, { amount: 15000, currency: 'AMD', period: 'month' });

  const customerB = await mockLogin(baseUrl, 'parent-b');
  const forbiddenDetails = await fetch(`${baseUrl}/api/customer/applications?id=${createdBody.applicationId}`, {
    headers: { Cookie: customerB },
  });
  assert.equal(forbiddenDetails.status, 404);
  const adminWithCustomerCookie = await fetch(`${baseUrl}/api/admin/applications`, { headers: { Cookie: customerA } });
  assert.equal(adminWithCustomerCookie.status, 401);

  const owner = await ownerLogin(baseUrl);
  const statusUpdate = await fetch(`${baseUrl}/api/admin/applications`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: owner },
    body: JSON.stringify({ id: createdBody.applicationId, status: 'in_progress' }),
  });
  assert.equal(statusUpdate.status, 200);
  const detailsA = await fetch(`${baseUrl}/api/customer/applications?id=${createdBody.applicationId}`, {
    headers: { Cookie: customerA },
  });
  assert.equal((await detailsA.json()).application.status, 'in_progress');

  await fetch(`${baseUrl}/api/customer/logout`, { method: 'POST', headers: { Cookie: customerA } });
  const afterLogout = await fetch(`${baseUrl}/api/customer/applications`, { headers: { Cookie: customerA } });
  assert.equal(afterLogout.status, 401);
  await stop(server, app);

  app = createHttpApp(config, { featureRoutes: routes });
  server = await app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const customerAAgain = await mockLogin(baseUrl, 'parent-a');
  const afterRestart = await fetch(`${baseUrl}/api/customer/applications`, { headers: { Cookie: customerAAgain } });
  assert.equal((await afterRestart.json()).applications[0].status, 'in_progress');
  assert.equal(app.database.prepare('SELECT COUNT(*) AS count FROM customer_accounts').get().count, 2);
  assert.equal(app.database.prepare('SELECT COUNT(*) AS count FROM applications WHERE customer_id IS NULL').get().count, 1);
  app.database.prepare("UPDATE customer_sessions SET expires_at = '2000-01-01T00:00:00.000Z'").run();
  const expired = await fetch(`${baseUrl}/api/customer/applications`, { headers: { Cookie: customerAAgain } });
  assert.equal(expired.status, 401);
  await stop(server, app);
});
