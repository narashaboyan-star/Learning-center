PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS customer_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL CHECK (provider IN ('telegram', 'mock')),
  provider_subject TEXT NOT NULL,
  provider_username TEXT,
  provider_display_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider, provider_subject)
);

CREATE TABLE IF NOT EXISTS customer_profiles (
  customer_id INTEGER PRIMARY KEY REFERENCES customer_accounts(id) ON DELETE CASCADE,
  parent_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_sessions (
  token_hash TEXT PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_oidc_transactions (
  state_hash TEXT PRIMARY KEY,
  browser_hash TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  return_path TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE applications ADD COLUMN customer_id INTEGER REFERENCES customer_accounts(id) ON DELETE SET NULL;
ALTER TABLE applications ADD COLUMN status TEXT NOT NULL DEFAULT 'new'
  CHECK (status IN ('new', 'in_progress', 'completed', 'cancelled'));
ALTER TABLE applications ADD COLUMN price_amount_snapshot INTEGER CHECK (price_amount_snapshot IS NULL OR price_amount_snapshot >= 0);
ALTER TABLE applications ADD COLUMN price_currency_snapshot TEXT NOT NULL DEFAULT 'AMD';
ALTER TABLE applications ADD COLUMN price_period_snapshot TEXT NOT NULL DEFAULT 'consultation'
  CHECK (price_period_snapshot IN ('month', 'consultation'));
ALTER TABLE applications ADD COLUMN submission_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS applications_submission_key_idx
  ON applications(submission_key) WHERE submission_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS applications_customer_idx
  ON applications(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS customer_sessions_expiry_idx ON customer_sessions(expires_at);
CREATE INDEX IF NOT EXISTS customer_oidc_expiry_idx ON customer_oidc_transactions(expires_at);
