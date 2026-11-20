import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

declare global {
  // eslint-disable-next-line no-var
  var __cgyDb: Database.Database | undefined;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '{}',
  results TEXT,
  audience TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_by_id TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  updated_by_id TEXT NOT NULL,
  updated_by_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activities_updated ON activities(updated_at DESC);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT ''
);
`;

export function dataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), 'data');
}

export function getDb(): Database.Database {
  if (global.__cgyDb) return global.__cgyDb;

  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });

  const db = new Database(path.join(dir, 'workbench.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);

  global.__cgyDb = db;
  return db;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function audit(user: { id: string; name: string }, action: string, target = '', detail = ''): void {
  try {
    getDb()
      .prepare('INSERT INTO audit (at, user_id, user_name, action, target, detail) VALUES (?, ?, ?, ?, ?, ?)')
      .run(nowIso(), user.id, user.name, action, target.slice(0, 120), detail.slice(0, 300));
  } catch (error) {
    console.warn('[audit] 写入失败', error instanceof Error ? error.message : error);
  }
}
