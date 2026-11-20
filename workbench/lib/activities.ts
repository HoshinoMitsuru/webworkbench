import { audit, getDb, nowIso } from '@/lib/db';
import { normalizeActivityInput, normalizeAudience, normalizeResults } from '@/lib/normalize';
import type { ActivityInput, AudienceBlock, GenerateResponse } from '@/lib/types';

export interface ActivityMeta {
  id: string;
  title: string;
  version: number;
  createdById: string;
  createdByName: string;
  updatedById: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
  hasResults: boolean;
}

export interface ActivityRecord extends ActivityMeta {
  data: ActivityInput;
  results: GenerateResponse | null;
  audience: AudienceBlock | null;
}

interface ActivityRow {
  id: string;
  title: string;
  data: string;
  results: string | null;
  audience: string | null;
  version: number;
  created_by_id: string;
  created_by_name: string;
  updated_by_id: string;
  updated_by_name: string;
  created_at: string;
  updated_at: string;
}

interface Actor {
  id: string;
  name: string;
}

function parseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toMeta(row: ActivityRow): ActivityMeta {
  return {
    id: row.id,
    title: row.title,
    version: row.version,
    createdById: row.created_by_id,
    createdByName: row.created_by_name,
    updatedById: row.updated_by_id,
    updatedByName: row.updated_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hasResults: Boolean(row.results)
  };
}

function toRecord(row: ActivityRow): ActivityRecord {
  return {
    ...toMeta(row),
    data: normalizeActivityInput(parseJson(row.data)),
    results: normalizeResults(parseJson(row.results)),
    audience: normalizeAudience(parseJson(row.audience))
  };
}

function titleOf(data: ActivityInput): string {
  return (data.name || '未命名活动').slice(0, 120);
}

export function listActivities(): ActivityMeta[] {
  const rows = getDb()
    .prepare(
      'SELECT id, title, data, results, audience, version, created_by_id, created_by_name, updated_by_id, updated_by_name, created_at, updated_at FROM activities ORDER BY updated_at DESC'
    )
    .all() as ActivityRow[];
  return rows.map(toMeta);
}

export function getActivity(id: string): ActivityRecord | null {
  const row = getDb()
    .prepare(
      'SELECT id, title, data, results, audience, version, created_by_id, created_by_name, updated_by_id, updated_by_name, created_at, updated_at FROM activities WHERE id = ?'
    )
    .get(id) as ActivityRow | undefined;
  return row ? toRecord(row) : null;
}

export function createActivity(
  actor: Actor,
  input: { data?: unknown; results?: unknown; audience?: unknown }
): ActivityRecord {
  const data = normalizeActivityInput(input.data);
  const results = normalizeResults(input.results);
  const audience = normalizeAudience(input.audience);
  const id = crypto.randomUUID();
  const at = nowIso();

  getDb()
    .prepare(
      `INSERT INTO activities
        (id, title, data, results, audience, version, created_by_id, created_by_name, updated_by_id, updated_by_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      titleOf(data),
      JSON.stringify(data),
      results ? JSON.stringify(results) : null,
      audience ? JSON.stringify(audience) : null,
      actor.id,
      actor.name,
      actor.id,
      actor.name,
      at,
      at
    );

  audit(actor, 'activity.create', id, titleOf(data));
  return getActivity(id)!;
}

export type UpdateResult =
  | { ok: true; activity: ActivityRecord }
  | { ok: false; reason: 'missing' | 'conflict'; current?: ActivityRecord };

export function updateActivity(
  actor: Actor,
  id: string,
  input: { version?: unknown; data?: unknown; results?: unknown; audience?: unknown }
): UpdateResult {
  const current = getActivity(id);
  if (!current) return { ok: false, reason: 'missing' };

  const version = typeof input.version === 'number' && Number.isFinite(input.version) ? input.version : 0;
  if (version !== current.version) return { ok: false, reason: 'conflict', current };

  const data = normalizeActivityInput(input.data);
  const results = normalizeResults(input.results);
  const audience = normalizeAudience(input.audience);

  getDb()
    .prepare(
      `UPDATE activities
       SET title = ?, data = ?, results = ?, audience = ?, version = version + 1,
           updated_by_id = ?, updated_by_name = ?, updated_at = ?
       WHERE id = ? AND version = ?`
    )
    .run(
      titleOf(data),
      JSON.stringify(data),
      results ? JSON.stringify(results) : null,
      audience ? JSON.stringify(audience) : null,
      actor.id,
      actor.name,
      nowIso(),
      id,
      version
    );

  audit(actor, 'activity.update', id, titleOf(data));
  return { ok: true, activity: getActivity(id)! };
}

export function deleteActivity(actor: Actor, id: string): boolean {
  const current = getActivity(id);
  if (!current) return false;
  getDb().prepare('DELETE FROM activities WHERE id = ?').run(id);
  audit(actor, 'activity.delete', id, current.title);
  return true;
}
