#!/usr/bin/env node
/**
 * 创建账号：node scripts/create-user.mjs <用户名> <密码> [显示姓名]
 * 也可不带参数运行，按提示输入。
 * 数据目录与运行中的应用一致：DATA_DIR，默认 ./data
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import Database from 'better-sqlite3';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return ['scrypt', SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString('base64'), hash.toString('base64')].join('$');
}

async function ask(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(prompt)).trim();
  } finally {
    rl.close();
  }
}

const [argUser, argPassword, ...nameParts] = process.argv.slice(2);
const username = (argUser || (await ask('用户名（3–32 位小写字母/数字/._-）：'))).toLowerCase();
const password = argPassword || (await ask('密码（至少 8 位）：'));
const name = (nameParts.join(' ') || (await ask('显示姓名（可留空）：'))).trim() || username;

if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
  console.error('用户名需为 3–32 位小写字母、数字、点、下划线或短横线');
  process.exit(1);
}
if (password.length < 8) {
  console.error('密码至少 8 位');
  process.exit(1);
}

const dir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(dir, { recursive: true });
const db = new Database(path.join(dir, 'workbench.db'));
db.pragma('journal_mode = WAL');
db.exec(`
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
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT ''
);
`);

const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
if (exists) {
  console.error(`账号 ${username} 已存在。如需重置密码，请先用 SQL 删除该账号后重建。`);
  process.exit(1);
}

db.prepare('INSERT INTO users (id, username, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(
  randomUUID(),
  username,
  name,
  hashPassword(password),
  new Date().toISOString()
);

db.close();
console.log(`已创建账号 ${username}（${name}），数据目录：${dir}`);
