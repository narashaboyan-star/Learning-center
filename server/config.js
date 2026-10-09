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

  return {
    environment,
    projectRoot: PROJECT_ROOT,
    databasePath,
    port: Number(overrides.port || process.env.PORT || 4173),
    secureCookies: overrides.secureCookies ?? false,
    sessionHours: Number(overrides.sessionHours || 12),
  };
}

module.exports = { PROJECT_ROOT, loadConfig };
