const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@libsql/client');
const { normalizeApplication } = require('../server/contracts');
const { APPLICATION_STATUSES, buildTelegramMessage, priceSnapshot } = require('../features/applications-routes');
const {
  CUSTOMER_COOKIE_NAME, OIDC_BROWSER_COOKIE_NAME, clearCookie, cookie, safeReturnPath, validateTelegramIdToken,
} = require('../server/customer-auth');
const {
  COOKIE_NAME, clearSessionCookie, hashPassword, parseCookies, sessionCookie, verifyPassword,
} = require('../server/auth');
const { SERVICES } = require('../server/seed-data');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const TELEGRAM_ISSUER = 'https://oauth.telegram.org';
const ITEM_SPECS = [
  { kind: 'service', key: () => 'trial-lesson' },
  { kind: 'lesson_type', key: (application) => application.lessonType },
  { kind: 'mode', key: (application) => application.mode },
];
let client;
let initialization;

function database() {
  if (client) return client;
  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) throw new Error('turso_configuration_missing');
  client = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  return client;
}

function statement(sql, args = []) { return { sql, args }; }
async function one(db, sql, args = []) { return (await db.execute(statement(sql, args))).rows[0] || null; }
async function all(db, sql, args = []) { return (await db.execute(statement(sql, args))).rows; }
function splitSql(sql) { return sql.split(/;\s*(?:\r?\n|$)/).map((part) => part.trim()).filter(Boolean); }

async function applyMigrations(db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const applied = new Set((await all(db, 'SELECT name FROM schema_migrations')).map((row) => String(row.name)));
  const directory = path.join(PROJECT_ROOT, 'db', 'migrations');
  const files = fs.readdirSync(directory).filter((name) => name.endsWith('.sql')).sort();
  for (const name of files) {
    if (applied.has(name)) continue;
    const sql = fs.readFileSync(path.join(directory, name), 'utf8');
    await db.batch([...splitSql(sql), statement('INSERT INTO schema_migrations (name) VALUES (?)', [name])], 'write');
  }
}

async function seedServices(db) {
  await db.batch(SERVICES.map((service) => statement(`
    INSERT INTO services (service_key, kind, sort_order) VALUES (?, ?, ?)
    ON CONFLICT(service_key) DO NOTHING
  `, [service.key, service.kind, service.order])), 'write');
  for (const service of SERVICES) {
    const row = await one(db, 'SELECT id FROM services WHERE service_key = ?', [service.key]);
    await db.batch(Object.entries(service.names).map(([language, name]) => statement(`
      INSERT INTO service_translations (service_id, language, name, description) VALUES (?, ?, ?, '')
      ON CONFLICT(service_id, language) DO NOTHING
    `, [row.id, language, name])), 'write');
  }
}

async function seedOwner(db) {
  const email = String(process.env.ADMIN_OWNER_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD || '';
  if (!email || !password) return;
  if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 12) throw new Error('invalid_admin_bootstrap');
  if (!await one(db, 'SELECT id FROM owners WHERE email = ? COLLATE NOCASE', [email])) {
    await db.execute(statement('INSERT INTO owners (email, password_hash) VALUES (?, ?)', [email, hashPassword(password)]));
  }
}

async function initialize() {
  if (!initialization) {
    initialization = (async () => {
      const db = database();
      await applyMigrations(db);
      await seedServices(db);
      await seedOwner(db);
      return db;
    })().catch((error) => { initialization = null; throw error; });
  }
  return initialization;
}

function sendJson(response, status, body, headers = {}) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.end(JSON.stringify(body));
}
function redirect(response, location, headers = {}) {
  response.statusCode = 302;
  response.setHeader('Location', location);
  response.setHeader('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.end();
}
async function readJson(request) {
  if (request.body && typeof request.body === 'object') return request.body;
  if (typeof request.body === 'string') return request.body ? JSON.parse(request.body) : {};
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 64 * 1024) throw new Error('body_too_large');
  }
  return body ? JSON.parse(body) : {};
}
function sameOrigin(request) {
  if (!request.headers.origin) return true;
  return new URL(request.headers.origin).host === (request.headers['x-forwarded-host'] || request.headers.host);
}
function hashToken(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString('base64url'); }

async function ownerFromRequest(db, request) {
  const token = parseCookies(request.headers.cookie || '')[COOKIE_NAME];
  if (!token) return null;
  return one(db, `SELECT owners.id, owners.email FROM owner_sessions
    JOIN owners ON owners.id = owner_sessions.owner_id
    WHERE owner_sessions.token_hash = ? AND owner_sessions.expires_at > ?`,
  [hashToken(token), new Date().toISOString()]);
}
async function customerFromRequest(db, request) {
  const token = parseCookies(request.headers.cookie || '')[CUSTOMER_COOKIE_NAME];
  if (!token) return null;
  return one(db, `SELECT customer_accounts.id, customer_accounts.provider, customer_accounts.provider_subject,
    customer_accounts.provider_display_name, customer_profiles.parent_name, customer_profiles.phone
    FROM customer_sessions JOIN customer_accounts ON customer_accounts.id = customer_sessions.customer_id
    LEFT JOIN customer_profiles ON customer_profiles.customer_id = customer_accounts.id
    WHERE customer_sessions.token_hash = ? AND customer_sessions.expires_at > ?`,
  [hashToken(token), new Date().toISOString()]);
}
function authMode() {
  return process.env.TELEGRAM_OIDC_CLIENT_ID && process.env.TELEGRAM_OIDC_CLIENT_SECRET ? 'telegram' : 'disabled';
}
function publicBaseUrl(request) {
  return process.env.PUBLIC_BASE_URL || `https://${request.headers['x-forwarded-host'] || request.headers.host}`;
}

function mapApplication(row, items) {
  return {
    id: Number(row.id), parentName: String(row.parent_name), phone: String(row.phone),
    childName: String(row.child_name), grade: String(row.grade), helpNeeded: String(row.help_needed || ''),
    language: String(row.language), status: String(row.status),
    price: { amount: row.price_amount_snapshot === null ? null : Number(row.price_amount_snapshot),
      currency: String(row.price_currency_snapshot), period: String(row.price_period_snapshot) },
    telegram: { notifiedAt: row.telegram_notified_at ? String(row.telegram_notified_at) : null,
      errorCode: row.telegram_error_code ? String(row.telegram_error_code) : null },
    createdAt: String(row.created_at),
    ...(items ? { items: items.map((item) => ({ kind: String(item.item_kind), key: String(item.item_key),
      name: String(item.name_snapshot), quantity: Number(item.quantity) })) } : {}),
  };
}

async function listServices(db) {
  const rows = await all(db, `SELECT services.service_key, services.kind, services.sort_order,
    service_translations.language, service_translations.name, service_translations.description
    FROM services JOIN service_translations ON service_translations.service_id = services.id
    ORDER BY services.sort_order, service_translations.language`);
  const services = new Map();
  for (const row of rows) {
    const key = String(row.service_key);
    if (!services.has(key)) services.set(key, { key, kind: String(row.kind), sortOrder: Number(row.sort_order), translations: {} });
    services.get(key).translations[String(row.language)] = { name: String(row.name), description: String(row.description || '') };
  }
  return [...services.values()];
}

async function applicationDetails(db, id, customerId = undefined) {
  const row = customerId === undefined
    ? await one(db, 'SELECT * FROM applications WHERE id = ?', [id])
    : await one(db, 'SELECT * FROM applications WHERE id = ? AND customer_id = ?', [id, customerId]);
  if (!row) return null;
  const items = await all(db, `SELECT item_kind, item_key, name_snapshot, quantity
    FROM application_items WHERE application_id = ? ORDER BY id`, [id]);
  return mapApplication(row, items);
}

async function saveApplication(db, application, customerId) {
  const existing = application.submissionKey
    ? await one(db, 'SELECT id FROM applications WHERE submission_key = ?', [application.submissionKey]) : null;
  if (existing) return { id: Number(existing.id), created: false };
  const price = priceSnapshot(application);
  const names = [];
  for (const spec of ITEM_SPECS) {
    const key = spec.key(application);
    const row = await one(db, `SELECT COALESCE(requested.name, fallback.name, services.service_key) AS name
      FROM services LEFT JOIN service_translations requested ON requested.service_id = services.id AND requested.language = ?
      LEFT JOIN service_translations fallback ON fallback.service_id = services.id AND fallback.language = 'ru'
      WHERE services.kind = ? AND services.service_key = ?`, [application.language, spec.kind, key]);
    if (!row) throw new Error('service_not_found');
    names.push({ kind: spec.kind, key, name: String(row.name) });
  }
  const inserted = await db.execute(statement(`INSERT INTO applications (
    parent_name, phone, child_name, grade, help_needed, language, customer_id, status,
    price_amount_snapshot, price_currency_snapshot, price_period_snapshot, submission_key
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?) ON CONFLICT DO NOTHING`, [
    application.parentName, application.phone, application.childName, application.grade,
    application.helpNeeded, application.language, customerId || null, price.amount,
    price.currency, price.period, application.submissionKey || null,
  ]));
  if (inserted.rowsAffected === 0) {
    const duplicate = await one(db, 'SELECT id FROM applications WHERE submission_key = ?', [application.submissionKey]);
    return { id: Number(duplicate.id), created: false };
  }
  const id = Number(inserted.lastInsertRowid);
  await db.batch(names.map((item) => statement(`INSERT INTO application_items
    (application_id, item_kind, item_key, name_snapshot) VALUES (?, ?, ?, ?)`,
  [id, item.kind, item.key, item.name])), 'write');
  return { id, created: true };
}

async function deliverTelegram(application) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { ok: false, code: 'configuration_missing' };
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: buildTelegramMessage(application),
        parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    const result = await response.json().catch(() => ({}));
    return response.ok && result.ok === true ? { ok: true } : { ok: false, code: 'telegram_rejected' };
  } catch { return { ok: false, code: 'telegram_unavailable' }; }
}

async function upsertCustomer(db, subject, claims) {
  const displayName = String(claims.name || claims.first_name || '').trim().slice(0, 120);
  const username = String(claims.preferred_username || claims.username || '').trim().slice(0, 120) || null;
  await db.execute(statement(`INSERT INTO customer_accounts
    (provider, provider_subject, provider_username, provider_display_name) VALUES ('telegram', ?, ?, ?)
    ON CONFLICT(provider, provider_subject) DO UPDATE SET provider_username = excluded.provider_username,
    provider_display_name = excluded.provider_display_name, updated_at = CURRENT_TIMESTAMP`,
  [String(subject), username, displayName]));
  const account = await one(db, `SELECT id, provider, provider_subject, provider_display_name
    FROM customer_accounts WHERE provider = 'telegram' AND provider_subject = ?`, [String(subject)]);
  await db.execute(statement(`INSERT INTO customer_profiles (customer_id, parent_name, phone) VALUES (?, ?, '')
    ON CONFLICT(customer_id) DO NOTHING`, [account.id, displayName]));
  return account;
}

async function handleTelegramOidc(db, request, response, url) {
  const callbackUrl = new URL('/api/customer/auth/telegram/callback', publicBaseUrl(request)).toString();
  const clientId = process.env.TELEGRAM_OIDC_CLIENT_ID;
  const clientSecret = process.env.TELEGRAM_OIDC_CLIENT_SECRET;
  if (!clientId || !clientSecret) return sendJson(response, 503, { ok: false, code: 'telegram_oidc_configuration_missing' });
  if (url.pathname.endsWith('/start')) {
    const state = randomToken(); const browserToken = randomToken(); const verifier = randomToken(48); const nonce = randomToken(24);
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    await db.execute(statement(`INSERT INTO customer_oidc_transactions
      (state_hash, browser_hash, code_verifier, nonce, return_path, expires_at) VALUES (?, ?, ?, ?, ?, ?)`, [
      hashToken(state), hashToken(browserToken), verifier, nonce, safeReturnPath(url.searchParams.get('return')),
      new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    ]));
    const authorizationUrl = new URL(`${TELEGRAM_ISSUER}/auth`);
    for (const [name, value] of Object.entries({ client_id: clientId, redirect_uri: callbackUrl,
      response_type: 'code', scope: 'openid profile', state, nonce, code_challenge: challenge,
      code_challenge_method: 'S256' })) authorizationUrl.searchParams.set(name, value);
    return redirect(response, authorizationUrl.toString(), { 'Set-Cookie': cookie(OIDC_BROWSER_COOKIE_NAME,
      browserToken, { maxAge: 600, secure: true, sameSite: 'Lax' }) });
  }
  const browserToken = parseCookies(request.headers.cookie || '')[OIDC_BROWSER_COOKIE_NAME];
  const transaction = url.searchParams.get('state') && browserToken ? await one(db, `SELECT * FROM customer_oidc_transactions
    WHERE state_hash = ? AND browser_hash = ? AND consumed_at IS NULL AND expires_at > ?`,
  [hashToken(url.searchParams.get('state')), hashToken(browserToken), new Date().toISOString()]) : null;
  const returnPath = transaction?.return_path ? String(transaction.return_path) : safeReturnPath();
  if (!transaction || url.searchParams.get('error') || !url.searchParams.get('code')) {
    return redirect(response, `${returnPath}&auth=cancelled`, { 'Set-Cookie': clearCookie(OIDC_BROWSER_COOKIE_NAME, true) });
  }
  await db.execute(statement('UPDATE customer_oidc_transactions SET consumed_at = CURRENT_TIMESTAMP WHERE state_hash = ?', [transaction.state_hash]));
  try {
    const tokenResponse = await fetch(`${TELEGRAM_ISSUER}/token`, { method: 'POST', headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }, body: new URLSearchParams({ grant_type: 'authorization_code', code: url.searchParams.get('code'),
      redirect_uri: callbackUrl, client_id: clientId, code_verifier: String(transaction.code_verifier) }) });
    if (!tokenResponse.ok) throw new Error('telegram_code_exchange_failed');
    const tokens = await tokenResponse.json();
    const claims = await validateTelegramIdToken(tokens.id_token, { clientId, nonce: String(transaction.nonce) });
    const account = await upsertCustomer(db, claims.sub, claims);
    const token = randomToken();
    await db.execute(statement('INSERT INTO customer_sessions (token_hash, customer_id, expires_at) VALUES (?, ?, ?)',
      [hashToken(token), account.id, new Date(Date.now() + 168 * 60 * 60 * 1000).toISOString()]));
    return redirect(response, `${returnPath}&auth=success`, { 'Set-Cookie': [
      cookie(CUSTOMER_COOKIE_NAME, token, { maxAge: 168 * 60 * 60, secure: true, sameSite: 'Strict' }),
      clearCookie(OIDC_BROWSER_COOKIE_NAME, true),
    ] });
  } catch { return redirect(response, `${returnPath}&auth=failed`, { 'Set-Cookie': clearCookie(OIDC_BROWSER_COOKIE_NAME, true) }); }
}

async function handler(request, response) {
  try {
    const db = await initialize();
    const url = new URL(request.url, `https://${request.headers['x-forwarded-host'] || request.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    if (request.method === 'GET' && pathname === '/api/health') return sendJson(response, 200, {
      ok: true, environment: 'production', storage: 'turso', version: process.env.VERCEL_GIT_COMMIT_SHA || 'local',
    });
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) && !sameOrigin(request)) {
      return sendJson(response, 403, { ok: false, code: 'origin_rejected' });
    }
    if (request.method === 'POST' && pathname === '/api/auth/login') {
      const body = await readJson(request);
      const owner = await one(db, 'SELECT id, email, password_hash FROM owners WHERE email = ? COLLATE NOCASE', [String(body.email || '').trim()]);
      if (!owner || !verifyPassword(body.password, owner.password_hash)) return sendJson(response, 401, { ok: false, code: 'invalid_credentials' });
      const token = randomToken();
      await db.execute(statement('INSERT INTO owner_sessions (token_hash, owner_id, expires_at) VALUES (?, ?, ?)',
        [hashToken(token), owner.id, new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()]));
      return sendJson(response, 200, { ok: true, owner: { email: String(owner.email) } }, { 'Set-Cookie': sessionCookie(token, true) });
    }
    if (request.method === 'POST' && pathname === '/api/auth/logout') {
      const token = parseCookies(request.headers.cookie || '')[COOKIE_NAME];
      if (token) await db.execute(statement('DELETE FROM owner_sessions WHERE token_hash = ?', [hashToken(token)]));
      return sendJson(response, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie(true) });
    }
    const owner = await ownerFromRequest(db, request);
    const customer = await customerFromRequest(db, request);
    if (request.method === 'GET' && pathname === '/api/admin/session') return owner
      ? sendJson(response, 200, { ok: true, owner: { email: String(owner.email) } })
      : sendJson(response, 401, { ok: false, code: 'authentication_required' });
    if (request.method === 'GET' && pathname === '/api/services') return sendJson(response, 200, { ok: true, services: await listServices(db) });
    if (pathname === '/api/admin/services') {
      if (!owner) return sendJson(response, 401, { ok: false, code: 'authentication_required' });
      if (request.method === 'GET') return sendJson(response, 200, { ok: true, services: await listServices(db) });
      if (request.method === 'PUT') {
        const body = await readJson(request);
        if (!SERVICES.some((service) => service.key === body.key) || !body.translations || typeof body.translations !== 'object') {
          return sendJson(response, 400, { ok: false, code: 'invalid_service' });
        }
        const row = await one(db, 'SELECT id FROM services WHERE service_key = ?', [body.key]);
        const updates = [];
        for (const [language, translation] of Object.entries(body.translations)) {
          if (!['ru', 'hy', 'en'].includes(language) || !translation?.name) return sendJson(response, 400, { ok: false, code: 'invalid_translation' });
          updates.push(statement(`UPDATE service_translations SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP
            WHERE service_id = ? AND language = ?`, [String(translation.name).trim().slice(0, 120),
            String(translation.description || '').trim().slice(0, 1000), row.id, language]));
        }
        await db.batch(updates, 'write');
        return sendJson(response, 200, { ok: true, service: (await listServices(db)).find((service) => service.key === body.key) });
      }
    }
    if (request.method === 'POST' && pathname === '/api/telegram') {
      let application;
      try { application = normalizeApplication(await readJson(request)); }
      catch (error) { return sendJson(response, 400, { ok: false, code: error.message, error: 'Invalid application data' }); }
      const saved = await saveApplication(db, application, customer?.id || null);
      if (!saved.created) return sendJson(response, 200, { ok: true, duplicate: true, applicationId: saved.id });
      const delivery = await deliverTelegram(application);
      await db.execute(statement('UPDATE applications SET telegram_notified_at = ?, telegram_error_code = ? WHERE id = ?',
        [delivery.ok ? new Date().toISOString() : null, delivery.ok ? null : delivery.code, saved.id]));
      return sendJson(response, delivery.ok ? 200 : 202, { ok: true, applicationId: saved.id,
        ...(!delivery.ok ? { warning: delivery.code } : {}) });
    }
    if (pathname === '/api/admin/applications') {
      if (!owner) return sendJson(response, 401, { ok: false, code: 'authentication_required' });
      if (request.method === 'GET' && !url.searchParams.has('id')) {
        const rows = await all(db, 'SELECT * FROM applications ORDER BY created_at DESC, id DESC LIMIT 200');
        return sendJson(response, 200, { ok: true, applications: rows.map((row) => mapApplication(row)) });
      }
      if (request.method === 'GET') {
        const id = Number(url.searchParams.get('id'));
        if (!Number.isSafeInteger(id) || id < 1) return sendJson(response, 400, { ok: false, code: 'invalid_application_id' });
        const application = await applicationDetails(db, id);
        return application ? sendJson(response, 200, { ok: true, application })
          : sendJson(response, 404, { ok: false, code: 'application_not_found' });
      }
      if (request.method === 'PUT') {
        const body = await readJson(request); const id = Number(body.id);
        if (!Number.isSafeInteger(id) || id < 1 || !APPLICATION_STATUSES.includes(body.status)) {
          return sendJson(response, 400, { ok: false, code: 'invalid_application_status_update' });
        }
        const result = await db.execute(statement('UPDATE applications SET status = ? WHERE id = ?', [body.status, id]));
        if (result.rowsAffected !== 1) return sendJson(response, 404, { ok: false, code: 'application_not_found' });
        return sendJson(response, 200, { ok: true, application: await applicationDetails(db, id) });
      }
    }
    if (request.method === 'GET' && pathname === '/api/customer/session') return sendJson(response, 200, {
      ok: true, authenticated: Boolean(customer), authMode: authMode(), customer: customer ? { profile: {
        parentName: String(customer.parent_name || ''), phone: String(customer.phone || ''),
      } } : null,
    });
    if (request.method === 'GET' && ['/api/customer/auth/telegram/start', '/api/customer/auth/telegram/callback'].includes(pathname)) {
      return handleTelegramOidc(db, request, response, url);
    }
    if (request.method === 'POST' && pathname === '/api/customer/logout') {
      const token = parseCookies(request.headers.cookie || '')[CUSTOMER_COOKIE_NAME];
      if (token) await db.execute(statement('DELETE FROM customer_sessions WHERE token_hash = ?', [hashToken(token)]));
      return sendJson(response, 200, { ok: true }, { 'Set-Cookie': clearCookie(CUSTOMER_COOKIE_NAME, true) });
    }
    if (pathname === '/api/customer/profile') {
      if (!customer) return sendJson(response, 401, { ok: false, code: 'customer_authentication_required' });
      if (request.method === 'GET') return sendJson(response, 200, { ok: true, profile: {
        parentName: String(customer.parent_name || ''), phone: String(customer.phone || ''),
      } });
      if (request.method === 'PUT') {
        const body = await readJson(request); const parentName = String(body.parentName || '').trim().slice(0, 120);
        const phone = String(body.phone || '').trim().slice(0, 80);
        if (!parentName || !/^0\d{8}$/.test(phone)) return sendJson(response, 400, {
          ok: false, code: !parentName ? 'parent_name_required' : 'invalid_phone',
        });
        await db.execute(statement(`UPDATE customer_profiles SET parent_name = ?, phone = ?, updated_at = CURRENT_TIMESTAMP
          WHERE customer_id = ?`, [parentName, phone, customer.id]));
        return sendJson(response, 200, { ok: true, profile: { parentName, phone } });
      }
    }
    if (request.method === 'GET' && pathname === '/api/customer/applications') {
      if (!customer) return sendJson(response, 401, { ok: false, code: 'customer_authentication_required' });
      if (!url.searchParams.has('id')) {
        const rows = await all(db, `SELECT * FROM applications WHERE customer_id = ?
          ORDER BY created_at DESC, id DESC LIMIT 200`, [customer.id]);
        return sendJson(response, 200, { ok: true, applications: rows.map((row) => mapApplication(row)) });
      }
      const id = Number(url.searchParams.get('id'));
      if (!Number.isSafeInteger(id) || id < 1) return sendJson(response, 400, { ok: false, code: 'invalid_application_id' });
      const application = await applicationDetails(db, id, customer.id);
      return application ? sendJson(response, 200, { ok: true, application })
        : sendJson(response, 404, { ok: false, code: 'application_not_found' });
    }
    return sendJson(response, 404, { ok: false, code: 'not_found' });
  } catch (error) {
    console.error(error);
    const input = error instanceof SyntaxError || ['body_too_large', 'password_too_short'].includes(error.message);
    return sendJson(response, input ? 400 : 500, { ok: false, code: input ? error.message : 'internal_error' });
  }
}

module.exports = handler;
module.exports._resetForTests = () => { client = undefined; initialization = undefined; };
