const crypto = require('node:crypto');
const { parseCookies } = require('./auth');

const CUSTOMER_COOKIE_NAME = 'kostanyan_customer_session';
const OIDC_BROWSER_COOKIE_NAME = 'kostanyan_oidc_browser';
const TELEGRAM_ISSUER = 'https://oauth.telegram.org';

function hashToken(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function cookie(name, value, { maxAge, secure = false, sameSite = 'Lax' } = {}) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function clearCookie(name, secure = false) {
  return cookie(name, '', { maxAge: 0, secure });
}

function createCustomerSession(database, customerId, hours = 168) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  database.prepare('INSERT INTO customer_sessions (token_hash, customer_id, expires_at) VALUES (?, ?, ?)')
    .run(hashToken(token), customerId, expiresAt);
  return { token, expiresAt };
}

function customerFromRequest(database, request) {
  const token = parseCookies(request.headers.cookie || '')[CUSTOMER_COOKIE_NAME];
  if (!token) return null;
  return database.prepare(`
    SELECT customer_accounts.id, customer_accounts.provider, customer_accounts.provider_subject,
           customer_accounts.provider_display_name, customer_profiles.parent_name, customer_profiles.phone
    FROM customer_sessions
    JOIN customer_accounts ON customer_accounts.id = customer_sessions.customer_id
    LEFT JOIN customer_profiles ON customer_profiles.customer_id = customer_accounts.id
    WHERE customer_sessions.token_hash = ? AND customer_sessions.expires_at > ?
  `).get(hashToken(token), new Date().toISOString()) || null;
}

function revokeCustomerSession(database, request) {
  const token = parseCookies(request.headers.cookie || '')[CUSTOMER_COOKIE_NAME];
  if (token) database.prepare('DELETE FROM customer_sessions WHERE token_hash = ?').run(hashToken(token));
}

function upsertCustomer(database, provider, subject, claims = {}) {
  const displayName = String(claims.name || claims.first_name || '').trim().slice(0, 120);
  const username = String(claims.preferred_username || claims.username || '').trim().slice(0, 120) || null;
  database.prepare(`
    INSERT INTO customer_accounts (provider, provider_subject, provider_username, provider_display_name)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(provider, provider_subject) DO UPDATE SET
      provider_username = excluded.provider_username,
      provider_display_name = excluded.provider_display_name,
      updated_at = CURRENT_TIMESTAMP
  `).run(provider, String(subject), username, displayName);
  const account = database.prepare(`
    SELECT id, provider, provider_subject, provider_display_name
    FROM customer_accounts WHERE provider = ? AND provider_subject = ?
  `).get(provider, String(subject));
  database.prepare(`
    INSERT INTO customer_profiles (customer_id, parent_name, phone) VALUES (?, ?, '')
    ON CONFLICT(customer_id) DO NOTHING
  `).run(account.id, displayName);
  return account;
}

function safeReturnPath(value) {
  const fallback = '/account.html?lang=ru';
  if (!value) return fallback;
  try {
    const parsed = new URL(String(value), 'https://local.invalid');
    if (parsed.origin !== 'https://local.invalid' || parsed.pathname !== '/account.html') return fallback;
    const language = parsed.searchParams.get('lang');
    return `/account.html?lang=${['ru', 'hy', 'en'].includes(language) ? language : 'ru'}`;
  } catch {
    return fallback;
  }
}

function oidcConfiguration(config) {
  if (config.customerAuthMode !== 'telegram') throw new Error('telegram_login_disabled');
  if (!config.telegramOidcClientId || !config.telegramOidcClientSecret || !config.publicBaseUrl) {
    throw new Error('telegram_oidc_configuration_missing');
  }
  const baseUrl = new URL(config.publicBaseUrl);
  if (baseUrl.protocol !== 'https:') throw new Error('telegram_oidc_https_required');
  return {
    clientId: config.telegramOidcClientId,
    clientSecret: config.telegramOidcClientSecret,
    callbackUrl: new URL('/api/customer/auth/telegram/callback', baseUrl).toString(),
  };
}

function beginOidc(database, config, returnPath) {
  const oidc = oidcConfiguration(config);
  const state = randomToken();
  const browserToken = randomToken();
  const verifier = randomToken(48);
  const nonce = randomToken(24);
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  database.prepare(`
    INSERT INTO customer_oidc_transactions
      (state_hash, browser_hash, code_verifier, nonce, return_path, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(hashToken(state), hashToken(browserToken), verifier, nonce, safeReturnPath(returnPath), expiresAt);
  const authorizationUrl = new URL(`${TELEGRAM_ISSUER}/auth`);
  authorizationUrl.searchParams.set('client_id', oidc.clientId);
  authorizationUrl.searchParams.set('redirect_uri', oidc.callbackUrl);
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('scope', 'openid profile');
  authorizationUrl.searchParams.set('state', state);
  authorizationUrl.searchParams.set('nonce', nonce);
  authorizationUrl.searchParams.set('code_challenge', challenge);
  authorizationUrl.searchParams.set('code_challenge_method', 'S256');
  return { authorizationUrl: authorizationUrl.toString(), browserToken };
}

function consumeOidcTransaction(database, state, browserToken) {
  if (!state || !browserToken) return null;
  const row = database.prepare(`
    SELECT * FROM customer_oidc_transactions
    WHERE state_hash = ? AND browser_hash = ? AND consumed_at IS NULL AND expires_at > ?
  `).get(hashToken(state), hashToken(browserToken), new Date().toISOString());
  if (!row) return null;
  database.prepare('UPDATE customer_oidc_transactions SET consumed_at = CURRENT_TIMESTAMP WHERE state_hash = ?')
    .run(row.state_hash);
  return row;
}

function decodeJwtPart(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

async function validateTelegramIdToken(idToken, { clientId, nonce, fetchImpl = globalThis.fetch, now = Date.now() }) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('invalid_id_token');
  const header = decodeJwtPart(parts[0]);
  const claims = decodeJwtPart(parts[1]);
  if (header.alg !== 'RS256' || !header.kid) throw new Error('invalid_id_token_algorithm');
  const response = await fetchImpl(`${TELEGRAM_ISSUER}/.well-known/jwks.json`);
  if (!response.ok) throw new Error('telegram_jwks_unavailable');
  const jwks = await response.json();
  const jwk = jwks.keys?.find((key) => key.kid === header.kid && key.kty === 'RSA');
  if (!jwk) throw new Error('telegram_signing_key_missing');
  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const validSignature = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    publicKey,
    Buffer.from(parts[2], 'base64url'),
  );
  if (!validSignature) throw new Error('invalid_id_token_signature');
  const nowSeconds = Math.floor(now / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud.map(String) : [String(claims.aud || '')];
  if (claims.iss !== TELEGRAM_ISSUER || !audiences.includes(String(clientId))) throw new Error('invalid_id_token_claims');
  if (audiences.length > 1 && String(claims.azp || '') !== String(clientId)) throw new Error('invalid_id_token_claims');
  if (!Number.isFinite(claims.exp) || claims.exp <= nowSeconds - 60) throw new Error('expired_id_token');
  if (claims.nbf && claims.nbf > nowSeconds + 60) throw new Error('future_id_token');
  if (claims.nonce !== nonce || !claims.sub) throw new Error('invalid_id_token_nonce');
  return claims;
}

async function exchangeTelegramCode(config, transaction, code, fetchImpl = globalThis.fetch) {
  const oidc = oidcConfiguration(config);
  const response = await fetchImpl(`${TELEGRAM_ISSUER}/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${oidc.clientId}:${oidc.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: oidc.callbackUrl,
      client_id: oidc.clientId,
      code_verifier: transaction.code_verifier,
    }),
  });
  if (!response.ok) throw new Error('telegram_code_exchange_failed');
  const tokens = await response.json();
  return validateTelegramIdToken(tokens.id_token, {
    clientId: oidc.clientId,
    nonce: transaction.nonce,
    fetchImpl,
  });
}

module.exports = {
  CUSTOMER_COOKIE_NAME,
  OIDC_BROWSER_COOKIE_NAME,
  beginOidc,
  clearCookie,
  consumeOidcTransaction,
  cookie,
  createCustomerSession,
  customerFromRequest,
  exchangeTelegramCode,
  revokeCustomerSession,
  safeReturnPath,
  upsertCustomer,
  validateTelegramIdToken,
};
