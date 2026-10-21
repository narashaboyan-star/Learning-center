const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function responseRecorder() {
  const headers = new Map();
  let resolve;
  const finished = new Promise((done) => { resolve = done; });
  return {
    headers,
    response: {
      statusCode: 200,
      setHeader(name, value) { headers.set(name.toLowerCase(), value); },
      end(body = '') { resolve({ body: String(body), status: this.statusCode }); },
    },
    finished,
  };
}

async function request(handler, method, url, body) {
  const recorder = responseRecorder();
  await handler({
    method,
    url,
    body,
    headers: { host: 'preview.example.test', origin: 'https://preview.example.test' },
  }, recorder.response);
  const result = await recorder.finished;
  return { ...result, json: result.body ? JSON.parse(result.body) : null };
}

test('Vercel handler migrates Turso-compatible storage and keeps a submitted application', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kostanyan-serverless-'));
  process.env.TURSO_DATABASE_URL = `file:${path.join(directory, 'preview.sqlite3')}`;
  process.env.TURSO_AUTH_TOKEN = 'local-test-token';
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  const handler = require('../api/index');
  handler._resetForTests();

  const health = await request(handler, 'GET', '/api/health');
  assert.equal(health.status, 200);
  assert.deepEqual(health.json, { ok: true, environment: 'production', storage: 'turso', version: 'local' });

  const services = await request(handler, 'GET', '/api/services');
  assert.equal(services.status, 200);
  assert.equal(services.json.services.length, 5);

  const application = {
    parentName: 'Учебный родитель',
    phone: '091234567',
    childName: 'Учебный ребёнок',
    grade: '5',
    lessonType: 'individual',
    mode: 'online',
    helpNeeded: 'Проверка serverless-хранилища',
    language: 'ru',
    submissionKey: '00000000-0000-4000-8000-000000000017',
  };
  const created = await request(handler, 'POST', '/api/telegram', application);
  assert.equal(created.status, 202);
  assert.equal(created.json.ok, true);
  assert.equal(created.json.warning, 'configuration_missing');

  const duplicate = await request(handler, 'POST', '/api/telegram', application);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.json.duplicate, true);
  assert.equal(duplicate.json.applicationId, created.json.applicationId);
});
