import fs from 'node:fs';
import path from 'node:path';
import { audit, dataDir, getDb, nowIso } from '@/lib/db';
import type { PosterAssetRecord } from '@/lib/workspace-types';

interface PosterRow {
  id: string;
  activity_id: string;
  task_id: string;
  output_id: string | null;
  version: number;
  filename: string;
  size: number;
  state: string;
  last_used_at: string;
  created_at: string;
}

/** 废案源文件保留 24 小时后提示清理 */
const DRAFT_CLEANUP_MS = 24 * 60 * 60 * 1000;
/** 定稿文件 7 天未被使用后提示确认是否保留 */
const FINAL_STALE_MS = 7 * 24 * 60 * 60 * 1000;

function posterDir(activityId: string): string {
  return path.join(dataDir(), 'uploads', 'posters', activityId);
}

function posterPath(row: PosterRow): string {
  return path.join(posterDir(row.activity_id), `${row.id}.png`);
}

function toRecord(row: PosterRow): PosterAssetRecord {
  const base = row.state === 'final' ? row.last_used_at || row.created_at : row.created_at;
  const age = Date.now() - new Date(base).getTime();
  return {
    id: row.id,
    activityId: row.activity_id,
    taskId: row.task_id,
    outputId: row.output_id,
    version: row.version,
    filename: row.filename,
    size: row.size,
    state: row.state === 'final' ? 'final' : 'draft',
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    cleanupDue: row.state !== 'final' && age >= DRAFT_CLEANUP_MS,
    stale: row.state === 'final' && age >= FINAL_STALE_MS
  };
}

function getRow(id: string): PosterRow | null {
  const row = getDb().prepare('SELECT * FROM poster_assets WHERE id = ?').get(id) as PosterRow | undefined;
  return row ?? null;
}

export function getPoster(id: string): PosterAssetRecord | null {
  const row = getRow(id);
  return row ? toRecord(row) : null;
}

export function listPosters(activityId: string): PosterAssetRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM poster_assets WHERE activity_id = ? ORDER BY task_id, version DESC')
    .all(activityId) as PosterRow[];
  return rows.map(toRecord);
}

export function getPosterFile(id: string): { record: PosterAssetRecord; filePath: string } | null {
  const row = getRow(id);
  if (!row) return null;
  const filePath = posterPath(row);
  if (!fs.existsSync(filePath)) return null;
  return { record: toRecord(row), filePath };
}

export interface CreatePosterInput {
  activityId: string;
  taskId: string;
  outputId?: string | null;
  state: 'draft' | 'final';
  bytes: Uint8Array;
}

export function createPosterAsset(
  actor: { id: string; name: string },
  input: CreatePosterInput
): PosterAssetRecord {
  const db = getDb();
  const id = crypto.randomUUID();
  const at = nowIso();
  const versionRow = db
    .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM poster_assets WHERE task_id = ?')
    .get(input.taskId) as { version: number };
  const version = versionRow.version + 1;

  fs.mkdirSync(posterDir(input.activityId), { recursive: true });
  fs.writeFileSync(path.join(posterDir(input.activityId), `${id}.png`), input.bytes);

  const transaction = db.transaction(() => {
    // 同一任务只保留一个定稿，旧定稿转为废案，等待 24 小时清理提示
    if (input.state === 'final') {
      db.prepare("UPDATE poster_assets SET state = 'draft' WHERE task_id = ? AND state = 'final'").run(input.taskId);
    }
    db.prepare(
      `INSERT INTO poster_assets
        (id, activity_id, task_id, output_id, version, filename, size, state, last_used_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.activityId,
      input.taskId,
      input.outputId ?? null,
      version,
      `poster-v${version}.png`,
      input.bytes.length,
      input.state,
      at,
      at
    );
  });
  transaction();

  audit(actor, 'poster.upload', id, `task=${input.taskId} v${version} state=${input.state}`);
  return getPoster(id)!;
}

/** 仅由用户明确确认后调用；不做任何自动删除 */
export function deletePosterAsset(actor: { id: string; name: string }, id: string): boolean {
  const row = getRow(id);
  if (!row) return false;

  getDb().prepare('DELETE FROM poster_assets WHERE id = ?').run(id);
  try {
    fs.unlinkSync(posterPath(row));
  } catch {
    // 文件已不存在时忽略
  }
  audit(actor, 'poster.delete', id, `task=${row.task_id} v${row.version}`);
  return true;
}

/** 打包导出定稿海报时刷新使用时间，避免被 7 天未使用规则误提示 */
export function markPostersUsed(ids: string[]): void {
  if (ids.length === 0) return;
  const at = nowIso();
  const statement = getDb().prepare('UPDATE poster_assets SET last_used_at = ? WHERE id = ?');
  const transaction = getDb().transaction(() => {
    for (const id of ids) statement.run(at, id);
  });
  transaction();
}
