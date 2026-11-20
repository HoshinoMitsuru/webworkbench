import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { getDb, nowIso } from '@/lib/db';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

export interface PublicUser {
  id: string;
  username: string;
  name: string;
}

interface UserRow {
  id: string;
  username: string;
  name: string;
  password_hash: string;
}

let seeded = false;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return ['scrypt', SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString('base64'), hash.toString('base64')].join('$');
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p)
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function countUsers(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
  return row.count;
}

export function createUser(input: { username: string; password: string; name?: string }): PublicUser {
  const username = input.username.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    throw new Error('用户名需为 3–32 位小写字母、数字、点、下划线或短横线');
  }
  if (input.password.length < 8) {
    throw new Error('密码至少 8 位');
  }
  const name = (input.name ?? '').trim() || username;
  const user: PublicUser = { id: randomUUID(), username, name };

  getDb()
    .prepare('INSERT INTO users (id, username, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(user.id, user.username, user.name, hashPassword(input.password), nowIso());

  return user;
}

export function verifyCredentials(username: string, password: string): PublicUser | null {
  const row = getDb()
    .prepare('SELECT id, username, name, password_hash FROM users WHERE username = ?')
    .get(username.trim().toLowerCase()) as UserRow | undefined;
  if (!row) return null;
  if (!verifyPassword(password, row.password_hash)) return null;

  getDb().prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), row.id);
  return { id: row.id, username: row.username, name: row.name };
}

export function findUserById(id: string): PublicUser | null {
  const row = getDb().prepare('SELECT id, username, name FROM users WHERE id = ?').get(id) as
    | PublicUser
    | undefined;
  return row ?? null;
}

/**
 * 首次启动时准备账号：
 * 1. 配置了 SEED_USERS（格式 username:password[:姓名]，逗号分隔）则按配置创建；
 * 2. 开发环境没有任何账号时创建 demo / cgy-demo-2026；
 * 3. 生产环境不自动创建，由管理员用 `npm run create-user` 创建。
 */
export function ensureSeedUsers(): void {
  if (seeded) return;
  try {
    if (countUsers() > 0) {
      seeded = true;
      return;
    }

    const raw = (process.env.SEED_USERS ?? '').trim();
    if (raw) {
      for (const entry of raw.split(',').map((item) => item.trim()).filter(Boolean)) {
        const [username, password, ...rest] = entry.split(':');
        if (!username || !password) continue;
        try {
          createUser({ username, password, name: rest.join(':') || username });
        } catch (error) {
          console.warn('[seed] 跳过账号', username, error instanceof Error ? error.message : error);
        }
      }
      seeded = true;
      return;
    }

    if (process.env.NODE_ENV !== 'production') {
      createUser({ username: 'demo', password: 'cgy-demo-2026', name: '演示账号' });
      console.log('[seed] 已创建开发环境演示账号 demo / cgy-demo-2026');
    }
    seeded = true;
  } catch (error) {
    // 数据库不可用时不在登录页崩溃，由登录接口返回可读错误
    console.warn('[seed] 初始化账号失败', error instanceof Error ? error.message : error);
  }
}

export function loginHint(): string {
  if (countUsers() === 0) return '尚未创建账号，请管理员在服务器上运行 npm run create-user 创建。';
  if (process.env.NODE_ENV !== 'production') return '开发环境默认账号：demo / cgy-demo-2026';
  return '账号由内容组管理员统一创建，忘记密码请联系管理员重置。';
}
