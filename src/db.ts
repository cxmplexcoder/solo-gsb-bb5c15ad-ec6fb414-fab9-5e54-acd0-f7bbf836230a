import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from './config';

const dir = path.dirname(config.dbPath);
fs.mkdirSync(dir, { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS documents (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS versions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id    INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version_no     INTEGER NOT NULL,
  label          TEXT,
  old_version_id INTEGER REFERENCES versions(id) ON DELETE SET NULL,
  old_text       TEXT NOT NULL,
  new_text       TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS annotations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id    INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version_id     INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  fragment_key   TEXT NOT NULL,
  anchor_text    TEXT NOT NULL DEFAULT '',
  context_before TEXT NOT NULL DEFAULT '',
  context_after  TEXT NOT NULL DEFAULT '',
  author         TEXT NOT NULL,
  content        TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','resolved','rejected')),
  needs_review   INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS migrations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  annotation_id   INTEGER NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
  from_version_id INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  to_version_id   INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  score           REAL NOT NULL,
  matched         INTEGER NOT NULL,
  suggested_key   TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_versions_doc ON versions(document_id);
CREATE INDEX IF NOT EXISTS idx_ann_doc       ON annotations(document_id);
CREATE INDEX IF NOT EXISTS idx_ann_version   ON annotations(version_id);
CREATE INDEX IF NOT EXISTS idx_migrations    ON migrations(to_version_id);
`);
