const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function loadConfig(overrides = {}) {
  const environment = overrides.environment || process.env.APP_ENV || 'test';
  if (environment === 'production') {
    throw new Error('The local foundation is test-only and refuses APP_ENV=production.');
  }

  const configuredPath = overrides.databasePath || process.env.TEST_DATABASE_PATH || '.data/kostanyan-test.sqlite3';
  const databasePath = path.resolve(PROJECT_ROOT, configuredPath);
  const allowedDataRoot = path.join(PROJECT_ROOT, '.data') + path.sep;
  if (!databasePath.startsWith(allowedDataRoot)) {
    throw new Error('TEST_DATABASE_PATH must stay inside the project .data directory.');
  }

  const customerAuthMode = overrides.customerAuthMode || process.env.CUSTOMER_AUTH_MODE || 'disabled';
  if (!['disabled', 'mock', 'telegram'].includes(customerAuthMode)) {
    throw new Error('CUSTOMER_AUTH_MODE must be disabled, mock or telegram.');
  }
  if (customerAuthMode === 'mock' && environment !== 'test') {
    throw new Error('Mock customer authentication is allowed only in APP_ENV=test.');
  }

  return {
    environment,
    projectRoot: PROJECT_ROOT,
    databasePath,
    port: Number(overrides.port || process.env.PORT || 4173),
    secureCookies: overrides.secureCookies ?? process.env.COOKIE_SECURE === 'true',
    sessionHours: Number(overrides.sessionHours || 12),
    customerSessionHours: Number(overrides.customerSessionHours || process.env.CUSTOMER_SESSION_HOURS || 168),
    customerAuthMode,
    telegramOidcClientId: overrides.telegramOidcClientId || process.env.TELEGRAM_OIDC_CLIENT_ID || '',
    telegramOidcClientSecret: overrides.telegramOidcClientSecret || process.env.TELEGRAM_OIDC_CLIENT_SECRET || '',
    publicBaseUrl: overrides.publicBaseUrl || process.env.PUBLIC_BASE_URL || '',
  };
}

module.exports = { PROJECT_ROOT, loadConfig };
