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

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'planning',
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  assignee TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo',
  mode TEXT NOT NULL DEFAULT 'ai',
  output_kind TEXT NOT NULL DEFAULT '',
  due_date TEXT NOT NULL DEFAULT '',
  pos_x REAL NOT NULL DEFAULT 0,
  pos_y REAL NOT NULL DEFAULT 0,
  order_index INTEGER NOT NULL DEFAULT 0,
  input_refs TEXT NOT NULL DEFAULT '[]',
  wait_reason TEXT NOT NULL DEFAULT '',
  na_reason TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_activity ON tasks(activity_id, stage, order_index);

CREATE TABLE IF NOT EXISTS materials (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'file',
  category TEXT NOT NULL DEFAULT 'doc',
  mime TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  storage_path TEXT NOT NULL DEFAULT '',
  text_content TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  fingerprint TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'shared',
  uploaded_by_id TEXT NOT NULL,
  uploaded_by_name TEXT NOT NULL,
  last_used_at TEXT,
  delete_state TEXT NOT NULL DEFAULT 'none',
  delete_requested_by_id TEXT NOT NULL DEFAULT '',
  delete_requested_by_name TEXT NOT NULL DEFAULT '',
  delete_requested_at TEXT,
  delete_reason TEXT NOT NULL DEFAULT '',
  parse_status TEXT NOT NULL DEFAULT 'ready',
  consent TEXT NOT NULL DEFAULT 'none',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_materials_activity ON materials(activity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS outputs (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'article',
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  adopted INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  ai_mark INTEGER NOT NULL DEFAULT 1,
  warnings TEXT NOT NULL DEFAULT '[]',
  created_by_id TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  approved_by_name TEXT NOT NULL DEFAULT '',
  approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_outputs_task ON outputs(task_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_outputs_activity ON outputs(activity_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  output_id TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  snapshot_title TEXT NOT NULL DEFAULT '',
  snapshot_body TEXT NOT NULL DEFAULT '',
  ai_ack INTEGER NOT NULL DEFAULT 0,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reviews_output ON reviews(output_id, created_at DESC);

CREATE TABLE IF NOT EXISTS publish_records (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  output_id TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  ai_declared INTEGER NOT NULL DEFAULT 0,
  reads INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  signups INTEGER NOT NULL DEFAULT 0,
  metrics_at TEXT,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_config_versions (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  prompt_hash TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_config_unique ON ai_config_versions(prompt_hash, model);

CREATE TABLE IF NOT EXISTS ai_runs (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'running',
  mode TEXT NOT NULL DEFAULT 'demo',
  model TEXT NOT NULL DEFAULT '',
  operator_name TEXT NOT NULL DEFAULT '',
  ms INTEGER NOT NULL DEFAULT 0,
  chars INTEGER NOT NULL DEFAULT 0,
  tokens INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_runs_activity ON ai_runs(activity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS poster_assets (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  output_id TEXT,
  version INTEGER NOT NULL,
  filename TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'draft',
  last_used_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_poster_assets_activity ON poster_assets(activity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_poster_assets_task ON poster_assets(task_id, version DESC);

CREATE TABLE IF NOT EXISTS canvas_state (
  activity_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS canvas_comment (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  field TEXT NOT NULL DEFAULT 'general',
  body TEXT NOT NULL DEFAULT '',
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  mentions TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_canvas_comment_activity ON canvas_comment(activity_id, created_at DESC);
`;

/** SQLite 不支持 ADD COLUMN IF NOT EXISTS，启动时按需补齐旧库字段 */
function ensureColumns(db: Database.Database): void {
  const columns: Array<[string, string, string]> = [
    ['activities', 'status', "TEXT NOT NULL DEFAULT 'planning'"],
    ['activities', 'owner_name', "TEXT NOT NULL DEFAULT ''"],
    ['activities', 'stage', "TEXT NOT NULL DEFAULT 'planning'"],
    ['activities', 'workflow', "TEXT NOT NULL DEFAULT 'recruit_review'"],
    ['activities', 'archived_at', 'TEXT'],
    ['tasks', 'note', "TEXT NOT NULL DEFAULT ''"],
    ['tasks', 'role', "TEXT NOT NULL DEFAULT ''"],
    ['ai_runs', 'tokens', 'INTEGER NOT NULL DEFAULT 0'],
    ['ai_runs', 'cost', 'REAL NOT NULL DEFAULT 0'],
    ['reviews', 'ai_ack', 'INTEGER NOT NULL DEFAULT 0'],
    ['publish_records', 'ai_declared', 'INTEGER NOT NULL DEFAULT 0'],
    ['publish_records', 'reads', 'INTEGER NOT NULL DEFAULT 0'],
    ['publish_records', 'likes', 'INTEGER NOT NULL DEFAULT 0'],
    ['publish_records', 'signups', 'INTEGER NOT NULL DEFAULT 0'],
    ['publish_records', 'metrics_at', 'TEXT'],
    ['materials', 'consent_by', "TEXT NOT NULL DEFAULT ''"],
    ['materials', 'consent_at', 'TEXT'],
    ['materials', 'consent_note', "TEXT NOT NULL DEFAULT ''"]
  ];
  for (const [table, column, definition] of columns) {
    const info = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!info.some((item) => item.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
}

export function dataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), 'data');
}

export function uploadsDir(): string {
  return path.join(dataDir(), 'uploads');
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
  ensureColumns(db);

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
