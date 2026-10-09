PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS owners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS owner_sessions (
  token_hash TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('service', 'lesson_type', 'mode')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS service_translations (
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  language TEXT NOT NULL CHECK (language IN ('ru', 'hy', 'en')),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (service_id, language)
);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  child_name TEXT NOT NULL,
  grade TEXT NOT NULL,
  help_needed TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL CHECK (language IN ('ru', 'hy', 'en')),
  telegram_notified_at TEXT,
  telegram_error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS application_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  item_kind TEXT NOT NULL CHECK (item_kind IN ('service', 'lesson_type', 'mode')),
  item_key TEXT NOT NULL,
  name_snapshot TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity = 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (application_id, item_kind)
);

CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_key TEXT NOT NULL UNIQUE,
  source_language TEXT NOT NULL CHECK (source_language IN ('ru', 'hy', 'en')),
  publication_state TEXT NOT NULL DEFAULT 'draft' CHECK (publication_state IN ('draft', 'published')),
  published_at TEXT,
  translation_warning TEXT,
  imported_file_path TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS article_translations (
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  language TEXT NOT NULL CHECK (language IN ('ru', 'hy', 'en')),
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL,
  seo_title TEXT NOT NULL DEFAULT '',
  seo_description TEXT NOT NULL DEFAULT '',
  translation_state TEXT NOT NULL DEFAULT 'source' CHECK (translation_state IN ('source', 'pending', 'translated', 'failed')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (article_id, language),
  UNIQUE (language, slug)
);

CREATE TABLE IF NOT EXISTS media_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER REFERENCES articles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
  storage_key TEXT NOT NULL UNIQUE,
  public_url TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  alt_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS owner_sessions_expiry_idx ON owner_sessions(expires_at);
CREATE INDEX IF NOT EXISTS password_reset_tokens_expiry_idx ON password_reset_tokens(expires_at);
CREATE INDEX IF NOT EXISTS applications_created_idx ON applications(created_at DESC);
CREATE INDEX IF NOT EXISTS articles_state_idx ON articles(publication_state, updated_at DESC);
