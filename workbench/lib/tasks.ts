import { audit, getDb, nowIso } from '@/lib/db';
import { getActivity } from '@/lib/activities';
import { STAGES, stageIndex } from '@/lib/workflow';
import type { TaskRecord } from '@/lib/workspace-types';

interface TaskRow {
  id: string;
  activity_id: string;
  stage: string;
  kind: string;
  title: string;
  assignee: string;
  role: string;
  status: string;
  mode: string;
  output_kind: string;
  due_date: string;
  pos_x: number;
  pos_y: number;
  order_index: number;
  input_refs: string;
  wait_reason: string;
  na_reason: string;
  note: string;
  created_at: string;
  updated_at: string;
}

function parseRefs(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function toTask(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    activityId: row.activity_id,
    stage: row.stage,
    kind: row.kind,
    title: row.title,
    assignee: row.assignee,
    role: row.role,
    status: row.status,
    mode: row.mode,
    outputKind: row.output_kind,
    dueDate: row.due_date,
    posX: row.pos_x,
    posY: row.pos_y,
    orderIndex: row.order_index,
    inputRefs: parseRefs(row.input_refs),
    waitReason: row.wait_reason,
    naReason: row.na_reason,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const TASK_STATUS = ['todo', 'doing', 'waiting', 'blocked', 'done', 'na'];

/** 手动添加 AI 任务时，按标题兜底匹配生成场景 */
function inferKind(title: string): string {
  if (/小红书|笔记/.test(title)) return 'note_recruit';
  if (/回顾|活动总结|复盘推文/.test(title)) return 'article_review';
  if (/话术|朋友圈|社群/.test(title)) return 'social';
  if (/招募|公众号|推文/.test(title)) return 'article_recruit';
  if (/方案|策划/.test(title)) return 'planning';
  return 'custom';
}

export function listTasks(activityId: string): TaskRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM tasks WHERE activity_id = ? ORDER BY order_index, pos_y')
    .all(activityId) as TaskRow[];
  return rows.map(toTask);
}

export function getTask(id: string): TaskRecord | null {
  const row = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
  return row ? toTask(row) : null;
}

export interface TaskCreateInput {
  title?: unknown;
  stage?: unknown;
  kind?: unknown;
  mode?: unknown;
  outputKind?: unknown;
  assignee?: unknown;
  role?: unknown;
  dueDate?: unknown;
}

export function createTask(
  actor: { id: string; name: string },
  activityId: string,
  input: TaskCreateInput
): TaskRecord | null {
  const activity = getActivity(activityId);
  if (!activity) return null;

  const title = typeof input.title === 'string' ? input.title.trim().slice(0, 80) : '';
  if (!title) return null;

  const stage = STAGES.some((item) => item.key === input.stage) ? String(input.stage) : 'recruit';
  const mode = ['ai', 'visual', 'manual'].includes(String(input.mode)) ? String(input.mode) : 'manual';
  const order = getDb()
    .prepare('SELECT COALESCE(MAX(order_index), 0) AS max FROM tasks WHERE activity_id = ?')
    .get(activityId) as { max: number };
  const withinStage = getDb()
    .prepare('SELECT COUNT(*) AS count FROM tasks WHERE activity_id = ? AND stage = ?')
    .get(activityId, stage) as { count: number };

  const id = crypto.randomUUID();
  const at = nowIso();
  const requestedKind = typeof input.kind === 'string' ? input.kind.slice(0, 30) : '';
  const kind = mode === 'ai' && (!requestedKind || requestedKind === 'custom') ? inferKind(title) : requestedKind || 'custom';
  getDb()
    .prepare(
      `INSERT INTO tasks
        (id, activity_id, stage, kind, title, assignee, role, status, mode, output_kind, due_date,
         pos_x, pos_y, order_index, input_refs, wait_reason, na_reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'todo', ?, ?, ?, ?, ?, ?, '[]', '', '', ?, ?)`
    )
    .run(
      id,
      activityId,
      stage,
      kind,
      title,
      typeof input.assignee === 'string' && input.assignee.trim() ? input.assignee.trim().slice(0, 40) : actor.name,
      typeof input.role === 'string' ? input.role.trim().slice(0, 20) : '',
      mode,
      typeof input.outputKind === 'string' ? input.outputKind.slice(0, 20) : '',
      typeof input.dueDate === 'string' ? input.dueDate.slice(0, 20) : '',
      stageIndex(stage) * 340 + 24,
      withinStage.count * 156 + 76,
      order.max + 1,
      at,
      at
    );

  audit(actor, 'task.create', id, title);
  return getTask(id);
}

export interface TaskPatch {
  title?: unknown;
  status?: unknown;
  assignee?: unknown;
  role?: unknown;
  dueDate?: unknown;
  posX?: unknown;
  posY?: unknown;
  stage?: unknown;
  inputRefs?: unknown;
  waitReason?: unknown;
  naReason?: unknown;
  note?: unknown;
}

export function updateTask(
  actor: { id: string; name: string },
  id: string,
  patch: TaskPatch
): TaskRecord | null {
  const current = getTask(id);
  if (!current) return null;

  const status =
    typeof patch.status === 'string' && TASK_STATUS.includes(patch.status) ? patch.status : current.status;
  const title =
    typeof patch.title === 'string' && patch.title.trim() ? patch.title.trim().slice(0, 80) : current.title;
  const stage = STAGES.some((item) => item.key === patch.stage) ? String(patch.stage) : current.stage;
  const assignee =
    typeof patch.assignee === 'string' ? patch.assignee.trim().slice(0, 40) : current.assignee;
  const role = typeof patch.role === 'string' ? patch.role.trim().slice(0, 20) : current.role;
  const dueDate = typeof patch.dueDate === 'string' ? patch.dueDate.slice(0, 20) : current.dueDate;
  const posX = typeof patch.posX === 'number' && Number.isFinite(patch.posX) ? patch.posX : current.posX;
  const posY = typeof patch.posY === 'number' && Number.isFinite(patch.posY) ? patch.posY : current.posY;
  const inputRefs = Array.isArray(patch.inputRefs)
    ? patch.inputRefs.filter((item): item is string => typeof item === 'string').slice(0, 60)
    : current.inputRefs;
  const waitReason =
    typeof patch.waitReason === 'string' ? patch.waitReason.slice(0, 200) : current.waitReason;
  const naReason = typeof patch.naReason === 'string' ? patch.naReason.slice(0, 200) : current.naReason;
  const note = typeof patch.note === 'string' ? patch.note.slice(0, 5000) : current.note;

  getDb()
    .prepare(
      `UPDATE tasks SET title = ?, status = ?, assignee = ?, role = ?, due_date = ?, pos_x = ?, pos_y = ?,
        stage = ?, input_refs = ?, wait_reason = ?, na_reason = ?, note = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      title,
      status,
      assignee,
      role,
      dueDate,
      posX,
      posY,
      stage,
      JSON.stringify(inputRefs),
      waitReason,
      naReason,
      note,
      nowIso(),
      id
    );

  audit(actor, 'task.update', id, `${status}/${stage}`);
  return getTask(id);
}

export function deleteTask(actor: { id: string; name: string }, id: string): boolean {
  const task = getTask(id);
  if (!task) return false;
  getDb().prepare('DELETE FROM tasks WHERE id = ?').run(id);
  audit(actor, 'task.delete', id, task.title);
  return true;
}
