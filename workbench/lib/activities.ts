import fs from 'node:fs';
import path from 'node:path';
import { audit, dataDir, getDb, nowIso } from '@/lib/db';
import { normalizeActivityInput, normalizeAudience, normalizeResults } from '@/lib/normalize';
import {
  DEFAULT_MATERIAL_KEYS,
  STAGES,
  stageIndex,
  templatesForMaterials,
  type TaskTemplate
} from '@/lib/workflow';
import type { ActivityInput, AudienceBlock, GenerateResponse } from '@/lib/types';

export interface ActivityMeta {
  id: string;
  title: string;
  version: number;
  status: string;
  ownerName: string;
  stage: string;
  workflow: string;
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
  archivedAt: string | null;
}

export interface ActivitySummary {
  id: string;
  title: string;
  status: string;
  ownerName: string;
  stage: string;
  updatedByName: string;
  updatedAt: string;
  createdAt: string;
  taskCount: number;
  doneCount: number;
  pendingReview: number;
  waiting: number;
  myOpen: number;
  materialCount: number;
}

export interface MyTaskItem {
  id: string;
  activityId: string;
  activityTitle: string;
  title: string;
  stage: string;
  status: string;
  kind: string;
  updatedAt: string;
}

interface ActivityRow {
  id: string;
  title: string;
  data: string;
  results: string | null;
  audience: string | null;
  version: number;
  status: string | null;
  owner_name: string | null;
  stage: string | null;
  workflow: string | null;
  archived_at: string | null;
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

const SELECT_COLUMNS =
  'id, title, data, results, audience, version, status, owner_name, stage, workflow, archived_at, created_by_id, created_by_name, updated_by_id, updated_by_name, created_at, updated_at';

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
    status: row.status || 'planning',
    ownerName: row.owner_name || row.created_by_name,
    stage: row.stage || 'planning',
    workflow: row.workflow || 'recruit_review',
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
    audience: normalizeAudience(parseJson(row.audience)),
    archivedAt: row.archived_at
  };
}

function titleOf(data: ActivityInput): string {
  return (data.name || '未命名活动').slice(0, 120);
}

function validStage(stage: unknown): string {
  return STAGES.some((item) => item.key === stage) ? String(stage) : 'planning';
}

function insertTemplateTasks(activityId: string, templates: TaskTemplate[], startStage: string): void {
  const db = getDb();
  const at = nowIso();
  const counters = new Map<string, number>();
  const startIndex = stageIndex(startStage);

  // 模板任务默认不指定负责人，改为保留责任角色，等待成员认领，避免“我的待办”被批量填满
  const insert = db.prepare(
    `INSERT INTO tasks
      (id, activity_id, stage, kind, title, assignee, role, status, mode, output_kind, due_date,
       pos_x, pos_y, order_index, input_refs, wait_reason, na_reason, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, '', ?, ?, ?, '[]', '', ?, ?, ?)`
  );

  templates.forEach((template, index) => {
    const withinStage = counters.get(template.stage) ?? 0;
    counters.set(template.stage, withinStage + 1);
    const skipped = stageIndex(template.stage) < startIndex;
    insert.run(
      crypto.randomUUID(),
      activityId,
      template.stage,
      template.kind,
      template.title,
      template.role,
      skipped ? 'na' : 'todo',
      template.mode,
      template.outputKind ?? '',
      stageIndex(template.stage) * 340 + 24,
      withinStage * 156 + 76,
      index,
      skipped ? '从当前阶段开始，未在本工作台记录' : '',
      at,
      at
    );
  });
}

export function listActivities(): ActivityMeta[] {
  const rows = getDb()
    .prepare(`SELECT ${SELECT_COLUMNS} FROM activities ORDER BY updated_at DESC`)
    .all() as ActivityRow[];
  return rows.map(toMeta);
}

export function listSummaries(user: Actor): ActivitySummary[] {
  const rows = getDb()
    .prepare(
      `SELECT a.id, a.title, a.status, a.owner_name, a.stage, a.updated_by_name, a.updated_at, a.created_at,
        (SELECT COUNT(*) FROM tasks t WHERE t.activity_id = a.id AND t.status != 'na') AS task_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.activity_id = a.id AND t.status = 'done') AS done_count,
        (SELECT COUNT(*) FROM outputs o WHERE o.activity_id = a.id AND o.status = 'pending') AS pending_review,
        (SELECT COUNT(*) FROM tasks t WHERE t.activity_id = a.id AND t.status IN ('waiting', 'blocked')) AS waiting,
        (SELECT COUNT(*) FROM tasks t WHERE t.activity_id = a.id AND t.assignee = ? AND t.status NOT IN ('done', 'na')) AS my_open,
        (SELECT COUNT(*) FROM materials m WHERE m.activity_id = a.id AND m.delete_state != 'approved'
          AND (m.visibility = 'shared' OR m.uploaded_by_id = ?)) AS material_count
       FROM activities a
       ORDER BY a.updated_at DESC`
    )
    .all(user.name, user.id) as Array<{
    id: string;
    title: string;
    status: string | null;
    owner_name: string | null;
    stage: string | null;
    updated_by_name: string;
    updated_at: string;
    created_at: string;
    task_count: number;
    done_count: number;
    pending_review: number;
    waiting: number;
    my_open: number;
    material_count: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status || 'planning',
    ownerName: row.owner_name || '',
    stage: row.stage || 'planning',
    updatedByName: row.updated_by_name,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
    taskCount: row.task_count,
    doneCount: row.done_count,
    pendingReview: row.pending_review,
    waiting: row.waiting,
    myOpen: row.my_open,
    materialCount: row.material_count
  }));
}

export function listMyTasks(user: Actor): MyTaskItem[] {
  const rows = getDb()
    .prepare(
      `SELECT t.id, t.activity_id, a.title AS activity_title, t.title, t.stage, t.status, t.kind, t.due_date, t.updated_at
       FROM tasks t JOIN activities a ON a.id = t.activity_id
       WHERE t.assignee = ? AND t.status NOT IN ('done', 'na')
       ORDER BY
         CASE WHEN t.due_date != '' AND t.due_date < date('now', 'localtime') THEN 0 ELSE 1 END,
         CASE WHEN t.due_date != '' THEN t.due_date ELSE '9999-12-31' END,
         t.updated_at DESC
       LIMIT 80`
    )
    .all(user.name) as Array<{
    id: string;
    activity_id: string;
    activity_title: string;
    title: string;
    stage: string;
    status: string;
    kind: string;
    due_date: string;
    updated_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    activityId: row.activity_id,
    activityTitle: row.activity_title,
    title: row.title,
    stage: row.stage,
    status: row.status,
    kind: row.kind,
    dueDate: row.due_date || '',
    updatedAt: row.updated_at
  }));
}

export function getActivity(id: string): ActivityRecord | null {
  const row = getDb().prepare(`SELECT ${SELECT_COLUMNS} FROM activities WHERE id = ?`).get(id) as
    | ActivityRow
    | undefined;
  return row ? toRecord(row) : null;
}

export interface CreateOptions {
  materials?: string[];
  startStage?: string;
  ownerName?: string;
}

export function createActivity(
  actor: Actor,
  input: { data?: unknown; results?: unknown; audience?: unknown },
  options: CreateOptions = {}
): ActivityRecord {
  const data = normalizeActivityInput(input.data);
  const results = normalizeResults(input.results);
  const audience = normalizeAudience(input.audience);
  const id = crypto.randomUUID();
  const at = nowIso();
  const startStage = validStage(options.startStage);
  const ownerName = (options.ownerName || '').trim().slice(0, 40) || actor.name;

  getDb()
    .prepare(
      `INSERT INTO activities
        (id, title, data, results, audience, version, status, owner_name, stage, workflow, archived_at,
         created_by_id, created_by_name, updated_by_id, updated_by_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 'planning', ?, ?, 'recruit_review', NULL, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      titleOf(data),
      JSON.stringify(data),
      results ? JSON.stringify(results) : null,
      audience ? JSON.stringify(audience) : null,
      ownerName,
      startStage,
      actor.id,
      actor.name,
      actor.id,
      actor.name,
      at,
      at
    );

  const materialKeys = Array.isArray(options.materials) ? options.materials : DEFAULT_MATERIAL_KEYS;
  insertTemplateTasks(id, templatesForMaterials(materialKeys), startStage);

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

export interface ActivityMetaPatch {
  status?: unknown;
  ownerName?: unknown;
  stage?: unknown;
  data?: unknown;
}

const ACTIVITY_STATUS = ['planning', 'recruiting', 'running', 'finished', 'archived', 'canceled'];

export function updateActivityMeta(actor: Actor, id: string, patch: ActivityMetaPatch): ActivityRecord | null {
  const current = getActivity(id);
  if (!current) return null;

  const nextStatus =
    typeof patch.status === 'string' && ACTIVITY_STATUS.includes(patch.status) ? patch.status : current.status;
  const nextOwner =
    typeof patch.ownerName === 'string' && patch.ownerName.trim()
      ? patch.ownerName.trim().slice(0, 40)
      : current.ownerName;
  const nextStage = typeof patch.stage === 'string' ? validStage(patch.stage) : current.stage;
  const archivedAt = nextStatus === 'archived' ? current.archivedAt || nowIso() : null;

  const data = patch.data ? normalizeActivityInput(patch.data) : current.data;

  getDb()
    .prepare(
      `UPDATE activities
       SET status = ?, owner_name = ?, stage = ?, archived_at = ?, data = ?, title = ?,
           updated_by_id = ?, updated_by_name = ?, updated_at = ?, version = version + 1
       WHERE id = ?`
    )
    .run(
      nextStatus,
      nextOwner,
      nextStage,
      archivedAt,
      JSON.stringify(data),
      titleOf(data),
      actor.id,
      actor.name,
      nowIso(),
      id
    );

  audit(actor, 'activity.meta', id, `${nextStatus}/${nextStage}`);
  return getActivity(id);
}

export function deleteActivity(actor: Actor, id: string): boolean {
  const current = getActivity(id);
  if (!current) return false;
  const db = getDb();
  const remove = db.transaction(() => {
    db.prepare('DELETE FROM reviews WHERE activity_id = ?').run(id);
    db.prepare('DELETE FROM publish_records WHERE activity_id = ?').run(id);
    db.prepare('DELETE FROM ai_runs WHERE activity_id = ?').run(id);
    db.prepare('DELETE FROM poster_assets WHERE activity_id = ?').run(id);
    db.prepare('DELETE FROM outputs WHERE activity_id = ?').run(id);
    db.prepare('DELETE FROM materials WHERE activity_id = ?').run(id);
    db.prepare('DELETE FROM tasks WHERE activity_id = ?').run(id);
    db.prepare('DELETE FROM activities WHERE id = ?').run(id);
  });
  remove();

  // 数据库删除成功后再清理磁盘文件；失败仅告警，不阻断，残留目录可在资源页人工确认清理
  let diskCleaned = true;
  for (const dir of [path.join(dataDir(), 'uploads', id), path.join(dataDir(), 'uploads', 'posters', id)]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      diskCleaned = false;
      console.warn('[activities] 清理活动目录失败', dir, error instanceof Error ? error.message : error);
    }
  }

  audit(actor, 'activity.delete', id, `${current.title}${diskCleaned ? ' · 已清理磁盘目录' : ' · 磁盘目录待人工清理'}`);
  return true;
}

/** 流程复制：保留结构与通用规则，清空日期、报名入口、个人数据、审核结果与发布记录 */
export function copyActivity(actor: Actor, id: string): ActivityRecord | null {
  const source = getActivity(id);
  if (!source) return null;

  const data: ActivityInput = {
    ...source.data,
    name: `${source.title}（副本）`.slice(0, 120),
    date: '',
    location: '',
    signup: '',
    notes: ''
  };

  const created = createActivity(
    actor,
    { data, results: null, audience: null },
    { materials: [], startStage: 'planning', ownerName: source.ownerName }
  );

  const db = getDb();
  db.prepare('DELETE FROM tasks WHERE activity_id = ?').run(created.id);
  const sourceTasks = db
    .prepare('SELECT * FROM tasks WHERE activity_id = ? ORDER BY order_index')
    .all(id) as Array<Record<string, unknown>>;

  const insert = db.prepare(
    `INSERT INTO tasks
      (id, activity_id, stage, kind, title, assignee, role, status, mode, output_kind, due_date,
       pos_x, pos_y, order_index, input_refs, wait_reason, na_reason, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '', ?, 'todo', ?, ?, '', ?, ?, ?, '[]', '', '', ?, ?)`
  );
  const at = nowIso();
  for (const task of sourceTasks) {
    insert.run(
      crypto.randomUUID(),
      created.id,
      task.stage,
      task.kind,
      task.title,
      task.role ?? '',
      task.mode,
      task.output_kind,
      task.pos_x,
      task.pos_y,
      task.order_index,
      at,
      at
    );
  }

  audit(actor, 'activity.copy', created.id, `来自 ${id}`);
  return getActivity(created.id);
}
