const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const test = require('node:test');
const { PROJECT_ROOT, loadConfig } = require('../server/config');
const { createHttpApp } = require('../server/http-app');
const { openDatabase } = require('../server/database');
const { applyMigrations } = require('../server/migrations');
const {
  beginOidc,
  consumeOidcTransaction,
  safeReturnPath,
  validateTelegramIdToken,
} = require('../server/customer-auth');
const { createCustomerRoutes } = require('../features/customer-routes');

function database() {
  const file = path.join(PROJECT_ROOT, '.data', `oidc-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite3`);
  const db = openDatabase(file);
  applyMigrations(db, path.join(PROJECT_ROOT, 'db', 'migrations'));
  return db;
}

function signIdToken(privateKey, kid, claims) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

test('OIDC state is browser-bound, one-time and uses PKCE S256', () => {
  const db = database();
  const config = loadConfig({
    customerAuthMode: 'telegram', telegramOidcClientId: '12345', telegramOidcClientSecret: 'test-secret',
    publicBaseUrl: 'https://preview.example',
  });
  const flow = beginOidc(db, config, '/account.html?lang=hy');
  const authorizationUrl = new URL(flow.authorizationUrl);
  assert.equal(authorizationUrl.origin, 'https://oauth.telegram.org');
  assert.equal(authorizationUrl.searchParams.get('response_type'), 'code');
  assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(authorizationUrl.searchParams.get('code_challenge'));
  const state = authorizationUrl.searchParams.get('state');
  assert.equal(consumeOidcTransaction(db, state, 'wrong-browser'), null);
  const transaction = consumeOidcTransaction(db, state, flow.browserToken);
  assert.equal(transaction.return_path, '/account.html?lang=hy');
  assert.equal(consumeOidcTransaction(db, state, flow.browserToken), null);
  assert.equal(safeReturnPath('https://attacker.example/account.html'), '/account.html?lang=ru');
  db.close();
});

test('Telegram ID token signature, issuer, audience, expiry and nonce are verified', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = 'test-key';
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = kid;
  const now = Date.now();
  const claims = {
    iss: 'https://oauth.telegram.org', aud: '12345', sub: 'telegram-user-1', nonce: 'nonce-1',
    exp: Math.floor(now / 1000) + 300, iat: Math.floor(now / 1000), name: 'Test Parent',
  };
  const fetchImpl = async () => ({ ok: true, async json() { return { keys: [jwk] }; } });
  const token = signIdToken(privateKey, kid, claims);
  const verified = await validateTelegramIdToken(token, { clientId: '12345', nonce: 'nonce-1', fetchImpl, now });
  assert.equal(verified.sub, 'telegram-user-1');
  await assert.rejects(
    validateTelegramIdToken(token, { clientId: 'wrong', nonce: 'nonce-1', fetchImpl, now }),
    /invalid_id_token_claims/,
  );
  await assert.rejects(
    validateTelegramIdToken(token, { clientId: '12345', nonce: 'wrong', fetchImpl, now }),
    /invalid_id_token_nonce/,
  );
  const expired = signIdToken(privateKey, kid, { ...claims, exp: Math.floor(now / 1000) - 120 });
  await assert.rejects(
    validateTelegramIdToken(expired, { clientId: '12345', nonce: 'nonce-1', fetchImpl, now }),
    /expired_id_token/,
  );
});

test('OIDC callback creates one account, a session and rejects replay', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = 'callback-test-key';
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = kid;
  const config = loadConfig({
    databasePath: path.join(PROJECT_ROOT, '.data', `callback-${process.pid}-${Date.now()}.sqlite3`),
    port: 0,
    customerAuthMode: 'telegram',
    telegramOidcClientId: '12345',
    telegramOidcClientSecret: 'test-secret',
    publicBaseUrl: 'https://preview.example',
    secureCookies: true,
  });
  let app;
  const fetchImpl = async (url, options) => {
    if (url === 'https://oauth.telegram.org/token') {
      assert.match(String(options.headers.Authorization), /^Basic /);
      assert.ok(String(options.body).includes('code_verifier='));
      const transaction = app.database.prepare('SELECT nonce FROM customer_oidc_transactions ORDER BY rowid DESC LIMIT 1').get();
      const now = Math.floor(Date.now() / 1000);
      return {
        ok: true,
        async json() {
          return {
            id_token: signIdToken(privateKey, kid, {
              iss: 'https://oauth.telegram.org', aud: '12345', sub: 'same-telegram-parent',
              nonce: transaction.nonce, exp: now + 300, iat: now, name: 'OIDC Test Parent',
            }),
          };
        },
      };
    }
    if (url === 'https://oauth.telegram.org/.well-known/jwks.json') {
      return { ok: true, async json() { return { keys: [jwk] }; } };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  app = createHttpApp(config, { featureRoutes: createCustomerRoutes({ fetchImpl }) });
  const server = await app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function completeLogin() {
    const start = await fetch(`${baseUrl}/api/customer/auth/telegram/start?return=${encodeURIComponent('/account.html?lang=en')}`, { redirect: 'manual' });
    assert.equal(start.status, 302);
    const authorizationUrl = new URL(start.headers.get('location'));
    const browserCookie = start.headers.get('set-cookie').split(';')[0];
    const callback = await fetch(`${baseUrl}/api/customer/auth/telegram/callback?code=test-code&state=${encodeURIComponent(authorizationUrl.searchParams.get('state'))}`, {
      headers: { Cookie: browserCookie }, redirect: 'manual',
    });
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get('location'), '/account.html?lang=en&auth=success');
    const customerCookie = callback.headers.getSetCookie().find((value) => value.startsWith('kostanyan_customer_session='));
    assert.ok(customerCookie);
    return { browserCookie, customerCookie: customerCookie.split(';')[0], state: authorizationUrl.searchParams.get('state') };
  }

  const first = await completeLogin();
  const session = await fetch(`${baseUrl}/api/customer/session`, { headers: { Cookie: first.customerCookie } });
  assert.equal((await session.json()).authenticated, true);
  const replay = await fetch(`${baseUrl}/api/customer/auth/telegram/callback?code=test-code&state=${encodeURIComponent(first.state)}`, {
    headers: { Cookie: first.browserCookie }, redirect: 'manual',
  });
  assert.equal(replay.headers.get('location'), '/account.html?lang=ru&auth=cancelled');
  await completeLogin();
  assert.equal(app.database.prepare('SELECT COUNT(*) AS count FROM customer_accounts').get().count, 1);

  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  app.close();
});
