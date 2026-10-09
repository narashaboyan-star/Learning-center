const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createOwner } = require('../server/auth');
const { PROJECT_ROOT, loadConfig } = require('../server/config');
const { createHttpApp } = require('../server/http-app');
const serviceRoutes = require('../features/services-routes');
const { createApplicationRoutes } = require('../features/applications-routes');

function uniqueDatabasePath() {
  return path.join(PROJECT_ROOT, '.data', `integration-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite3`);
}

async function stop(server, app) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  app.close();
}

test('service edit flows into a new immutable application snapshot', async () => {
  const config = loadConfig({ databasePath: uniqueDatabasePath(), port: 0 });
  const telegramCalls = [];
  const applicationRoutes = createApplicationRoutes({
    env: { TELEGRAM_BOT_TOKEN: 'integration-test-token', TELEGRAM_CHAT_ID: 'integration-test-chat' },
    fetchImpl: async (url) => {
      telegramCalls.push(url);
      return { ok: true, status: 200, async json() { return { ok: true }; } };
    },
  });
  const app = createHttpApp(config, { featureRoutes: [...serviceRoutes, ...applicationRoutes] });
  createOwner(app.database, 'integration-owner@example.test', 'testing-password-123');
  const server = await app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'integration-owner@example.test', password: 'testing-password-123' }),
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];

  const update = await fetch(`${baseUrl}/api/admin/services`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      key: 'group',
      translations: {
        ru: { name: 'Групповое занятие', description: '' },
        hy: { name: 'Փոքր խմբով դաս', description: '' },
        en: { name: 'Small-group lesson', description: '' },
      },
    }),
  });
  assert.equal(update.status, 200);

  const submission = await fetch(`${baseUrl}/api/telegram`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      parentName: 'Աննա',
      phone: '091234567',
      childName: 'Անի',
      grade: '4',
      lessonType: 'group',
      mode: 'offline',
      helpNeeded: 'Ընթերցանություն',
      language: 'hy',
    }),
  });
  assert.equal(submission.status, 200);
  assert.equal(telegramCalls.length, 2);

  const list = await fetch(`${baseUrl}/api/admin/applications`, { headers: { Cookie: cookie } });
  assert.equal(list.status, 200);
  const applications = (await list.json()).applications;
  assert.equal(applications.length, 1);

  const details = await fetch(`${baseUrl}/api/admin/applications?id=${applications[0].id}`, {
    headers: { Cookie: cookie },
  });
  const application = (await details.json()).application;
  assert.equal(application.items.find((item) => item.kind === 'lesson_type').name, 'Փոքր խմբով դաս');

  const servicesPage = await fetch(`${baseUrl}/admin/services.html`, { headers: { Cookie: cookie } });
  const applicationsPage = await fetch(`${baseUrl}/admin/applications.html`, { headers: { Cookie: cookie } });
  assert.equal(servicesPage.status, 200);
  assert.equal(applicationsPage.status, 200);

  await stop(server, app);
});
