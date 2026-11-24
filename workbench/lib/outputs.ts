import { audit, getDb, nowIso } from '@/lib/db';
import type { AiRunRecord, OutputRecord, PublishRecord, ReviewRecord } from '@/lib/workspace-types';

interface OutputRow {
  id: string;
  activity_id: string;
  task_id: string;
  kind: string;
  title: string;
  body: string;
  tags: string;
  status: string;
  adopted: number;
  version: number;
  ai_mark: number;
  warnings: string;
  created_by_id: string;
  created_by_name: string;
  approved_by_name: string;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ReviewRow {
  id: string;
  output_id: string;
  activity_id: string;
  action: string;
  comment: string;
  snapshot_title: string;
  snapshot_body: string;
  ai_ack: number;
  user_id: string;
  user_name: string;
  created_at: string;
}

interface PublishRow {
  id: string;
  activity_id: string;
  output_id: string;
  platform: string;
  url: string;
  note: string;
  ai_declared: number;
  user_id: string;
  user_name: string;
  created_at: string;
}

interface RunRow {
  id: string;
  activity_id: string;
  task_id: string;
  kind: string;
  status: string;
  mode: string;
  model: string;
  operator_name: string;
  ms: number;
  chars: number;
  tokens: number;
  cost: number;
  error: string;
  created_at: string;
}

export interface Actor {
  id: string;
  name: string;
}

function parseTags(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function parseWarnings(value: string): Array<{ token: string; reason: string }> {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.token === 'string')
      .map((item) => ({ token: String(item.token).slice(0, 60), reason: String(item.reason || '').slice(0, 120) }));
  } catch {
    return [];
  }
}

function toOutput(row: OutputRow): OutputRecord {
  return {
    id: row.id,
    activityId: row.activity_id,
    taskId: row.task_id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    tags: parseTags(row.tags),
    status: row.status,
    adopted: Boolean(row.adopted),
    version: row.version,
    aiMark: Boolean(row.ai_mark),
    warnings: parseWarnings(row.warnings),
    createdById: row.created_by_id,
    createdByName: row.created_by_name,
    approvedByName: row.approved_by_name,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toReview(row: ReviewRow): ReviewRecord {
  return {
    id: row.id,
    outputId: row.output_id,
    activityId: row.activity_id,
    action: row.action,
    comment: row.comment,
    snapshotTitle: row.snapshot_title,
    snapshotBody: row.snapshot_body,
    aiAck: Boolean(row.ai_ack),
    userId: row.user_id,
    userName: row.user_name,
    createdAt: row.created_at
  };
}

function toPublish(row: PublishRow): PublishRecord {
  return {
    id: row.id,
    activityId: row.activity_id,
    outputId: row.output_id,
    platform: row.platform,
    url: row.url,
    note: row.note,
    aiDeclared: Boolean(row.ai_declared),
    userName: row.user_name,
    createdAt: row.created_at
  };
}

function toRun(row: RunRow): AiRunRecord {
  return {
    id: row.id,
    activityId: row.activity_id,
    taskId: row.task_id,
    kind: row.kind,
    status: row.status,
    mode: row.mode,
    model: row.model,
    operatorName: row.operator_name,
    ms: row.ms,
    chars: row.chars,
    tokens: row.tokens,
    cost: row.cost,
    error: row.error,
    createdAt: row.created_at
  };
}

export function listOutputs(activityId: string): OutputRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM outputs WHERE activity_id = ? ORDER BY task_id, version DESC')
    .all(activityId) as OutputRow[];
  return rows.map(toOutput);
}

export function getOutput(id: string): OutputRecord | null {
  const row = getDb().prepare('SELECT * FROM outputs WHERE id = ?').get(id) as OutputRow | undefined;
  return row ? toOutput(row) : null;
}

export function listReviews(activityId: string): ReviewRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM reviews WHERE activity_id = ? ORDER BY created_at DESC')
    .all(activityId) as ReviewRow[];
  return rows.map(toReview);
}

export function listPublishes(activityId: string): PublishRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM publish_records WHERE activity_id = ? ORDER BY created_at DESC')
    .all(activityId) as PublishRow[];
  return rows.map(toPublish);
}

export function listRuns(activityId: string, limit = 50): AiRunRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM ai_runs WHERE activity_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(activityId, limit) as RunRow[];
  return rows.map(toRun);
}

export interface CreateOutputInput {
  activityId: string;
  taskId: string;
  kind: string;
  title: string;
  body: string;
  tags?: string[];
  warnings?: Array<{ token: string; reason: string }>;
  aiMark?: boolean;
}

export function createOutput(actor: Actor, input: CreateOutputInput): OutputRecord {
  const db = getDb();
  const id = crypto.randomUUID();
  const at = nowIso();
  const versionRow = db
    .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM outputs WHERE task_id = ?')
    .get(input.taskId) as { version: number };
  const version = versionRow.version + 1;

  const transaction = db.transaction(() => {
    db.prepare('UPDATE outputs SET adopted = 0 WHERE task_id = ?').run(input.taskId);
    db.prepare(
      `INSERT INTO outputs
        (id, activity_id, task_id, kind, title, body, tags, status, adopted, version, ai_mark, warnings,
         created_by_id, created_by_name, approved_by_name, approved_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', 1, ?, ?, ?, ?, ?, '', NULL, ?, ?)`
    ).run(
      id,
      input.activityId,
      input.taskId,
      input.kind,
      input.title.slice(0, 160),
      input.body.slice(0, 40_000),
      JSON.stringify(input.tags ?? []),
      version,
      input.aiMark === false ? 0 : 1,
      JSON.stringify(input.warnings ?? []),
      actor.id,
      actor.name,
      at,
      at
    );
  });
  transaction();

  audit(actor, 'output.create', id, `task=${input.taskId} v${version}`);
  return getOutput(id)!;
}

export type OutputActionResult =
  | { ok: true; output: OutputRecord }
  | { ok: false; reason: string };

export function updateOutputDraft(
  actor: Actor,
  id: string,
  patch: { title?: unknown; body?: unknown; tags?: unknown }
): OutputActionResult {
  const current = getOutput(id);
  if (!current) return { ok: false, reason: '内容不存在' };
  if (current.status === 'pending') {
    return { ok: false, reason: '待审核版本不能直接修改，请先撤回或另建草稿。' };
  }
  if (current.status === 'approved') {
    return { ok: false, reason: '已确认版本不能原地修改，请另建草稿。' };
  }

  const title = typeof patch.title === 'string' ? patch.title.trim().slice(0, 160) : current.title;
  const body = typeof patch.body === 'string' ? patch.body.slice(0, 40_000) : current.body;
  const tags = Array.isArray(patch.tags)
    ? patch.tags.filter((item): item is string => typeof item === 'string').slice(0, 12)
    : current.tags;

  getDb()
    .prepare('UPDATE outputs SET title = ?, body = ?, tags = ?, updated_at = ? WHERE id = ?')
    .run(title, body, JSON.stringify(tags), nowIso(), id);

  audit(actor, 'output.save', id, title);
  return { ok: true, output: getOutput(id)! };
}

export function reviseOutput(actor: Actor, id: string): OutputActionResult {
  const current = getOutput(id);
  if (!current) return { ok: false, reason: '内容不存在' };
  const next = createOutput(actor, {
    activityId: current.activityId,
    taskId: current.taskId,
    kind: current.kind,
    title: current.title,
    body: current.body,
    tags: current.tags,
    warnings: current.warnings,
    aiMark: true
  });
  audit(actor, 'output.revise', id, `新草稿 v${next.version}`);
  return { ok: true, output: next };
}

export function adoptOutput(actor: Actor, id: string): OutputRecord | null {
  const current = getOutput(id);
  if (!current) return null;
  const db = getDb();
  db.transaction(() => {
    db.prepare('UPDATE outputs SET adopted = 0 WHERE task_id = ?').run(current.taskId);
    db.prepare('UPDATE outputs SET adopted = 1, updated_at = ? WHERE id = ?').run(nowIso(), id);
  })();
  audit(actor, 'output.adopt', id, `v${current.version}`);
  return getOutput(id);
}

export function submitOutput(actor: Actor, id: string, comment = ''): OutputActionResult {
  const current = getOutput(id);
  if (!current) return { ok: false, reason: '内容不存在' };
  if (!current.body.trim()) return { ok: false, reason: '内容为空，不能提交审核。' };
  if (current.status === 'pending') return { ok: false, reason: '该版本已在审核中。' };

  const at = nowIso();
  const db = getDb();
  db.transaction(() => {
    db.prepare("UPDATE outputs SET status = 'pending', updated_at = ? WHERE id = ?").run(at, id);
    db.prepare(
      `INSERT INTO reviews (id, output_id, activity_id, action, comment, snapshot_title, snapshot_body, user_id, user_name, created_at)
       VALUES (?, ?, ?, 'submit', ?, ?, ?, ?, ?, ?)`
    ).run(
      crypto.randomUUID(),
      id,
      current.activityId,
      comment.slice(0, 1000),
      current.title,
      current.body.slice(0, 40_000),
      actor.id,
      actor.name,
      at
    );
  })();

  audit(actor, 'output.submit', id, '');
  return { ok: true, output: getOutput(id)! };
}

export function approveOutput(actor: Actor, id: string, comment = '', aiAck = false): OutputActionResult {
  const current = getOutput(id);
  if (!current) return { ok: false, reason: '内容不存在' };
  if (current.status !== 'pending') return { ok: false, reason: '只有待审核版本可以通过。' };
  if (!aiAck) return { ok: false, reason: '请先提醒审核人：本内容含 AI 生成成分，需勾选“已核对并知悉”后再通过。' };

  const at = nowIso();
  const db = getDb();
  db.transaction(() => {
    db.prepare(
      "UPDATE outputs SET status = 'approved', ai_mark = 0, approved_by_name = ?, approved_at = ?, updated_at = ? WHERE id = ?"
    ).run(actor.name, at, at, id);
    db.prepare(
      `INSERT INTO reviews (id, output_id, activity_id, action, comment, snapshot_title, snapshot_body, ai_ack, user_id, user_name, created_at)
       VALUES (?, ?, ?, 'approve', ?, ?, ?, 1, ?, ?, ?)`
    ).run(
      crypto.randomUUID(),
      id,
      current.activityId,
      `审核通过：审核人已核对事实、数据与授权，并知悉本内容含 AI 生成成分。对外可不再显示显式 AI 标识，但文件隐式元数据保留，发布时需在平台完成 AI 声明。机构对事实与表达负责。${comment ? ` ${comment}` : ''}`.trim(),
      current.title,
      current.body.slice(0, 40_000),
      actor.id,
      actor.name,
      at
    );
  })();

  audit(actor, 'output.approve', id, 'aiAck=1');
  return { ok: true, output: getOutput(id)! };
}

export function returnOutput(actor: Actor, id: string, comment = ''): OutputActionResult {
  const current = getOutput(id);
  if (!current) return { ok: false, reason: '内容不存在' };
  if (current.status !== 'pending') return { ok: false, reason: '只有待审核版本可以退回。' };
  if (!comment.trim()) return { ok: false, reason: '退回时请写明修改意见。' };

  const at = nowIso();
  const db = getDb();
  db.transaction(() => {
    db.prepare("UPDATE outputs SET status = 'changes', updated_at = ? WHERE id = ?").run(at, id);
    db.prepare(
      `INSERT INTO reviews (id, output_id, activity_id, action, comment, snapshot_title, snapshot_body, user_id, user_name, created_at)
       VALUES (?, ?, ?, 'return', ?, '', '', ?, ?, ?)`
    ).run(crypto.randomUUID(), id, current.activityId, comment.slice(0, 1000), actor.id, actor.name, at);
  })();

  audit(actor, 'output.return', id, '');
  return { ok: true, output: getOutput(id)! };
}

export function recordPublish(
  actor: Actor,
  outputId: string,
  input: { platform?: unknown; url?: unknown; note?: unknown; aiDeclared?: unknown }
): PublishRecord | null {
  const output = getOutput(outputId);
  if (!output) return null;
  if (output.status !== 'approved') return null;

  const id = crypto.randomUUID();
  const at = nowIso();
  const aiDeclared = input.aiDeclared === true;
  getDb()
    .prepare(
      `INSERT INTO publish_records (id, activity_id, output_id, platform, url, note, ai_declared, user_id, user_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      output.activityId,
      outputId,
      typeof input.platform === 'string' ? input.platform.slice(0, 40) : '',
      typeof input.url === 'string' ? input.url.slice(0, 400) : '',
      typeof input.note === 'string' ? input.note.slice(0, 300) : '',
      aiDeclared ? 1 : 0,
      actor.id,
      actor.name,
      at
    );

  audit(actor, 'publish.record', id, `${output.title} aiDeclared=${aiDeclared ? 1 : 0}`);
  const row = getDb().prepare('SELECT * FROM publish_records WHERE id = ?').get(id) as PublishRow;
  return toPublish(row);
}

export function startRun(
  activityId: string,
  taskId: string,
  kind: string,
  mode: string,
  operatorName: string
): string {
  const id = crypto.randomUUID();
  getDb()
    .prepare(
      `INSERT INTO ai_runs (id, activity_id, task_id, kind, status, mode, model, operator_name, ms, chars, error, created_at)
       VALUES (?, ?, ?, ?, 'running', ?, ?, ?, 0, 0, '', ?)`
    )
    .run(
      id,
      activityId,
      taskId,
      kind,
      mode,
      process.env.ARK_MODEL || 'demo',
      operatorName,
      nowIso()
    );
  return id;
}

export function finishRun(
  id: string,
  update: {
    ok: boolean;
    status?: 'success' | 'failed' | 'cancelled';
    mode: string;
    ms: number;
    chars: number;
    tokens?: number;
    cost?: number;
    error?: string;
  }
): void {
  const status = update.status ?? (update.ok ? 'success' : 'failed');
  getDb()
    .prepare(
      'UPDATE ai_runs SET status = ?, mode = ?, ms = ?, chars = ?, tokens = ?, cost = ?, error = ? WHERE id = ?'
    )
    .run(
      status,
      update.mode,
      update.ms,
      update.chars,
      Math.max(0, Math.round(update.tokens ?? 0)),
      Math.max(0, update.cost ?? 0),
      (update.error || '').slice(0, 200),
      id
    );
}

/** 估算 token 与费用：中文约 1.5 字/token，费用单价由环境变量配置，未配置时按 0 计。 */
export function estimateUsage(chars: number, mode: string): { tokens: number; cost: number } {
  const tokens = Math.round(chars / 1.5);
  const rate = Number(process.env.AI_COST_PER_1K_TOKENS || 0);
  const cost = mode === 'live' && Number.isFinite(rate) ? (tokens / 1000) * rate : 0;
  return { tokens, cost: Math.round(cost * 10000) / 10000 };
}

export function getTaskRun(taskId: string): AiRunRecord | null {
  const row = getDb()
    .prepare('SELECT * FROM ai_runs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(taskId) as RunRow | undefined;
  return row ? toRun(row) : null;
}

export function cancelRun(id: string): AiRunRecord | null {
  getDb()
    .prepare("UPDATE ai_runs SET status = 'cancelled', error = '用户取消生成' WHERE id = ? AND status = 'running'")
    .run(id);
  const row = getDb().prepare('SELECT * FROM ai_runs WHERE id = ?').get(id) as RunRow | undefined;
  return row ? toRun(row) : null;
}

export function isRunCancelled(id: string): boolean {
  const row = getDb().prepare('SELECT status FROM ai_runs WHERE id = ?').get(id) as
    | { status: string }
    | undefined;
  return row?.status === 'cancelled';
}

export function countPendingReview(activityId: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS count FROM outputs WHERE activity_id = ? AND status = 'pending'")
    .get(activityId) as { count: number };
  return row.count;
}
