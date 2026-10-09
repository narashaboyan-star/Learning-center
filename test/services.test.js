const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createOwner } = require('../server/auth');
const { PROJECT_ROOT, loadConfig } = require('../server/config');
const { createHttpApp } = require('../server/http-app');

function uniqueDatabasePath() {
  return path.join(PROJECT_ROOT, '.data', `services-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite3`);
}

async function stop(server, app) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  app.close();
}

async function login(baseUrl) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'services-owner@example.test', password: 'testing-password-123' }),
  });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}

test('services are public, updates are owner-only and persist after restart', async () => {
  const databasePath = uniqueDatabasePath();
  const config = loadConfig({ databasePath, port: 0, sessionHours: 1 });
  let app = createHttpApp(config);
  createOwner(app.database, 'services-owner@example.test', 'testing-password-123');
  let server = await app.listen(0);
  let baseUrl = `http://127.0.0.1:${server.address().port}`;

  const publicResponse = await fetch(`${baseUrl}/api/services`);
  assert.equal(publicResponse.status, 200);
  const publicBody = await publicResponse.json();
  assert.equal(publicBody.ok, true);
  assert.deepEqual(publicBody.services.map((service) => service.key), [
    'trial-lesson', 'individual', 'group', 'online', 'offline',
  ]);
  assert.deepEqual(Object.keys(publicBody.services[0].translations).sort(), ['en', 'hy', 'ru']);

  const blockedGet = await fetch(`${baseUrl}/api/admin/services`);
  assert.equal(blockedGet.status, 401);
  const blockedPut = await fetch(`${baseUrl}/api/admin/services`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'individual', translations: { ru: { name: 'Новое', description: '' } } }),
  });
  assert.equal(blockedPut.status, 401);

  const cookie = await login(baseUrl);
  const update = await fetch(`${baseUrl}/api/admin/services`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      key: 'individual',
      translations: {
        ru: { name: 'Индивидуальный урок', description: 'Описание после редактирования' },
        hy: { name: 'Անհատական դաս', description: '' },
        en: { name: 'One-to-one lesson', description: 'Edited description' },
      },
    }),
  });
  assert.equal(update.status, 200);
  const updatedBody = await update.json();
  assert.equal(updatedBody.service.translations.ru.name, 'Индивидуальный урок');
  assert.equal(updatedBody.service.translations.ru.description, 'Описание после редактирования');

  await stop(server, app);
  app = createHttpApp(config);
  server = await app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const afterRestart = await fetch(`${baseUrl}/api/services`);
  const restartedService = (await afterRestart.json()).services.find((service) => service.key === 'individual');
  assert.equal(restartedService.translations.ru.name, 'Индивидуальный урок');
  assert.equal(restartedService.translations.ru.description, 'Описание после редактирования');

  await stop(server, app);
});

test('unknown service, language and non-editable fields are rejected', async () => {
  const config = loadConfig({ databasePath: uniqueDatabasePath(), port: 0, sessionHours: 1 });
  const app = createHttpApp(config);
  createOwner(app.database, 'services-owner@example.test', 'testing-password-123');
  const server = await app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const cookie = await login(baseUrl);

  async function put(body) {
    return fetch(`${baseUrl}/api/admin/services`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(body),
    });
  }

  const unknownKey = await put({ key: 'invented', translations: { ru: { name: 'X', description: '' } } });
  assert.equal(unknownKey.status, 400);
  assert.equal((await unknownKey.json()).code, 'unknown_service');

  const unknownLanguage = await put({ key: 'group', translations: { fr: { name: 'Groupe', description: '' } } });
  assert.equal(unknownLanguage.status, 400);
  assert.equal((await unknownLanguage.json()).code, 'unknown_language');

  const forbiddenField = await put({ key: 'group', hidden: true, translations: { ru: { name: 'Группа', description: '' } } });
  assert.equal(forbiddenField.status, 400);
  assert.equal((await forbiddenField.json()).code, 'unsupported_field');

  await stop(server, app);
});
