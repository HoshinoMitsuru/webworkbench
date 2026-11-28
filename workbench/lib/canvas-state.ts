import { getActivity, type ActivityRecord } from '@/lib/activities';
import { isLiveModel } from '@/lib/ark';
import { audit, getDb, nowIso } from '@/lib/db';
import { blocksGeneration, listMaterials } from '@/lib/materials';
import { approveOutput, createOutput, listOutputs, submitOutput } from '@/lib/outputs';
import { createTask, listTasks } from '@/lib/tasks';
import { runTaskGeneration, type GenerationReference } from '@/lib/task-gen';
import { ACTIVITY_STATUS_LABEL, BASE_TEMPLATES, CONTENT_STATUS_LABEL, MATERIAL_PRESETS } from '@/lib/workflow';
import type { OutputRecord, TaskRecord } from '@/lib/workspace-types';

/**
 * 「共享创作画布」的服务端状态。
 *
 * 画布只有固定五类节点：排期 / 主题 / 方案 / 公众号 / 小红书。
 * - 坐标、缩放、分组与主题卡内容存放在 canvas_state.payload；
 * - 方案与平台稿一律写入 outputs 并生成新版本，画布不做原地覆盖；
 * - 审核与定稿复用 outputs/reviews 现有机制。
 */

export const CANVAS_NODE_IDS = ['schedule', 'theme', 'plan', 'wechat', 'xhs'] as const;

export type CanvasNodeId = (typeof CANVAS_NODE_IDS)[number];

export const CANVAS_NODE_LABELS: Record<CanvasNodeId, string> = {
  schedule: '排期',
  theme: '主题',
  plan: '方案',
  wechat: '公众号',
  xhs: '小红书'
};

export interface CanvasActor {
  id: string;
  name: string;
}

export interface CanvasNodeDetail {
  label: string;
  value: string;
}

export interface CanvasVersionView {
  id: string;
  version: number;
  title: string;
  body: string;
  status: string;
  statusLabel: string;
  updatedAt: string;
  approvedByName: string;
  approvedAt: string | null;
}

export interface CanvasNodeView {
  id: CanvasNodeId;
  label: string;
  title: string;
  summary: string;
  body: string;
  version: number;
  status: string;
  statusLabel: string;
  empty: boolean;
  /** 该版本为 AI 生成草稿（外部审核前需明确标注） */
  aiMark: boolean;
  x: number;
  y: number;
  details: CanvasNodeDetail[];
  editable: boolean;
  /** 同一节点的上一版只读内容，用于对比 */
  previous: CanvasVersionView | null;
  finalized: boolean;
  finalizedBy: string;
  finalizedAt: string | null;
}

export interface CanvasTopicState {
  title: string;
  direction: string;
  confirmedByName: string;
  confirmedAt: string | null;
  confirmed: boolean;
  /** true 表示题目曾通过画布保存过；false 表示当前只是活动标题推导 */
  stored: boolean;
}

export interface CanvasGroupState {
  id: string;
  name: string;
  nodeIds: CanvasNodeId[];
  collapsed: boolean;
}

export interface CanvasPayload {
  nodes: CanvasNodeView[];
  topic: CanvasTopicState;
  zoom: number;
  groups: CanvasGroupState[];
  updatedAt: string | null;
  /** 没有任何已保存状态、节点内容来自现场推导 */
  derived: boolean;
}

type Positions = Record<CanvasNodeId, { x: number; y: number }>;

interface StoredTopic {
  title?: unknown;
  direction?: unknown;
  confirmedByName?: unknown;
  confirmedAt?: unknown;
}

interface StoredCanvas {
  nodes?: Record<string, { x?: unknown; y?: unknown }>;
  zoom?: unknown;
  groups?: unknown;
  topic?: unknown;
}

interface NormalizedTopic {
  title: string;
  direction: string;
  confirmedByName: string;
  confirmedAt: string | null;
}

export type CanvasWriteResult =
  | { ok: true; canvas: CanvasPayload }
  | { ok: false; error: string; status: 400 | 404 | 409 };

export const COORD_MIN = -10000;
export const COORD_MAX = 10000;
export const ZOOM_MIN = 0.3;
export const ZOOM_MAX = 2;
export const DEFAULT_ZOOM = 0.8;
export const TITLE_MAX = 120;
export const DIRECTION_MAX = 2000;
export const OUTPUT_BODY_MAX = 40_000;

const DEFAULT_POSITIONS: Positions = {
  schedule: { x: 40, y: 60 },
  theme: { x: 380, y: 60 },
  plan: { x: 760, y: 60 },
  wechat: { x: 1200, y: 60 },
  xhs: { x: 1660, y: 60 }
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clampCoord(value: number): number {
  return Math.min(COORD_MAX, Math.max(COORD_MIN, value));
}

function clampZoom(value: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

function excerpt(text: string, max = 150): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/** 同一任务可能有多个版本：优先已采用，其次最近更新，最后版本号。 */
function sortedOutputs(list: OutputRecord[]): OutputRecord[] {
  return [...list].sort((a, b) => {
    if (a.adopted !== b.adopted) return a.adopted ? -1 : 1;
    if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
    return b.version - a.version;
  });
}

function pickLatest(list: OutputRecord[]): OutputRecord | undefined {
  return sortedOutputs(list)[0];
}

function previousOf(list: OutputRecord[], current: OutputRecord | undefined): OutputRecord | undefined {
  if (!current) return undefined;
  return sortedOutputs(list).find((item) => item.id !== current.id);
}

/**
 * 平台成品映射依据：
 * - task-gen 落库时 output.kind = task.outputKind；workflow.ts 中公众号任务 outputKind 为 article，小红书任务为 note。
 * - 历史或自定义任务缺 outputKind 时，退回到 task.kind：article_recruit / article_review → 公众号，note_recruit → 小红书。
 */
function platformOutputs(
  platform: 'wechat' | 'xhs',
  outputs: OutputRecord[],
  taskKindById: Map<string, string>
): OutputRecord[] {
  const directKind = platform === 'wechat' ? 'article' : 'note';
  const direct = outputs.filter((item) => item.kind === directKind);
  if (direct.length) return direct;

  const fallbackKinds = platform === 'wechat' ? ['article_recruit', 'article_review'] : ['note_recruit'];
  return outputs.filter((item) => {
    const taskKind = taskKindById.get(item.taskId);
    return taskKind ? fallbackKinds.includes(taskKind) : false;
  });
}

function planOutputs(outputs: OutputRecord[], taskKindById: Map<string, string>): OutputRecord[] {
  return outputs.filter((item) => item.kind === 'planning' || taskKindById.get(item.taskId) === 'planning');
}

function taskIdForPlatform(tasks: TaskRecord[], platform: 'wechat' | 'xhs'): string {
  const outputKind = platform === 'wechat' ? 'article' : 'note';
  const direct = tasks.find((task) => task.outputKind === outputKind);
  if (direct) return direct.id;
  const fallbackKinds = platform === 'wechat' ? ['article_recruit', 'article_review'] : ['note_recruit'];
  return tasks.find((task) => fallbackKinds.includes(task.kind))?.id ?? '';
}

function toVersionView(output: OutputRecord): CanvasVersionView {
  return {
    id: output.id,
    version: output.version,
    title: output.title,
    body: output.body,
    status: output.status,
    statusLabel: CONTENT_STATUS_LABEL[output.status] || output.status,
    updatedAt: output.updatedAt,
    approvedByName: output.approvedByName,
    approvedAt: output.approvedAt
  };
}

function contentNode(
  id: 'plan' | 'wechat' | 'xhs',
  output: OutputRecord | undefined,
  previous: OutputRecord | undefined,
  position: { x: number; y: number }
): CanvasNodeView {
  const label = CANVAS_NODE_LABELS[id];
  if (!output) {
    const emptyText =
      id === 'plan' ? '尚未生成方案' : id === 'wechat' ? '尚未生成公众号稿' : '尚未生成小红书稿';
    const hint =
      id === 'plan'
        ? '这场活动还没有方案稿。可点「AI 生成草稿」基于活动资料与已确认主题生成第 1 版，也可直接撰写并保存。'
        : '工作台里还没有对应平台的稿件。确认主题后可点「AI 生成草稿」生成第 1 版，也可直接撰写并保存。';
    return {
      id,
      label,
      title: emptyText,
      summary: hint,
      body: hint,
      version: 0,
      status: 'missing',
      statusLabel: '未生成',
      empty: true,
      aiMark: false,
      x: position.x,
      y: position.y,
      details: [],
      editable: true,
      previous: null,
      finalized: false,
      finalizedBy: '',
      finalizedAt: null
    };
  }

  const body = output.body.trim();
  const finalized = output.status === 'approved' && Boolean(output.approvedByName);
  const details: CanvasNodeDetail[] = [
    { label: '类型', value: output.kind || '未标注' },
    { label: '最近更新', value: output.updatedAt },
    { label: '创建人', value: output.createdByName || '未记录' }
  ];
  if (finalized) {
    details.push({ label: '定稿人', value: output.approvedByName });
    details.push({ label: '定稿时间', value: output.approvedAt || '未记录' });
  }

  return {
    id,
    label,
    title: output.title || emptyLabel(id),
    summary: excerpt(body || '暂无正文，可打开编辑侧栏补充。'),
    body: body || '暂无正文。',
    version: output.version,
    status: output.status,
    statusLabel: finalized ? '已定稿' : CONTENT_STATUS_LABEL[output.status] || output.status,
    empty: false,
    aiMark: output.aiMark && !finalized,
    x: position.x,
    y: position.y,
    details,
    editable: true,
    previous: previous ? toVersionView(previous) : null,
    finalized,
    finalizedBy: finalized ? output.approvedByName : '',
    finalizedAt: finalized ? output.approvedAt : null
  };
}

function emptyLabel(id: 'plan' | 'wechat' | 'xhs'): string {
  return id === 'plan' ? '方案' : id === 'wechat' ? '公众号稿' : '小红书稿';
}

function normalizeStoredTopic(payload: StoredCanvas | null): NormalizedTopic | null {
  const raw = payload?.topic;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as StoredTopic;
  const title = typeof value.title === 'string' ? value.title.trim().slice(0, TITLE_MAX) : '';
  const direction = typeof value.direction === 'string' ? value.direction.slice(0, DIRECTION_MAX) : '';
  const confirmedByName =
    typeof value.confirmedByName === 'string' ? value.confirmedByName.trim().slice(0, 40) : '';
  const confirmedAt =
    typeof value.confirmedAt === 'string' && value.confirmedAt.trim() ? value.confirmedAt.trim() : null;
  if (!title && !direction && !confirmedByName) return null;
  return { title, direction, confirmedByName, confirmedAt };
}

function derivedTopic(activity: ActivityRecord): { title: string; direction: string } {
  // ActivityInput 目前没有 topic 字段；若历史数据里存在 topic 则优先展示，否则回退活动标题。
  const raw = activity.data as unknown as Record<string, unknown>;
  const legacy = raw.topic as { title?: unknown; direction?: unknown } | undefined;
  const legacyTitle = typeof legacy?.title === 'string' ? legacy.title.trim() : '';
  const legacyDirection = typeof legacy?.direction === 'string' ? legacy.direction.trim() : '';
  return {
    title: legacyTitle || activity.title || '',
    direction: legacyDirection
  };
}

function topicState(activity: ActivityRecord, stored: NormalizedTopic | null): CanvasTopicState {
  const derived = derivedTopic(activity);
  return {
    title: stored?.title || derived.title || '尚未设定主题',
    direction: stored?.direction || derived.direction || '',
    confirmedByName: stored?.confirmedByName ?? '',
    confirmedAt: stored?.confirmedAt ?? null,
    confirmed: Boolean(stored?.confirmedByName && stored?.confirmedAt),
    stored: Boolean(stored)
  };
}

function themeNode(activity: ActivityRecord, topic: CanvasTopicState, position: { x: number; y: number }): CanvasNodeView {
  const summarySource = topic.direction || activity.data.highlights || '';
  const summary = summarySource
    ? excerpt(summarySource)
    : topic.stored
      ? '主题已单独设定，方向说明待补充。'
      : '当前直接沿用活动标题作为主题，尚未单独设定主题。';
  const details: CanvasNodeDetail[] = [
    { label: '活动名称', value: activity.data.name || activity.title },
    { label: '所属项目', value: activity.data.project || '未填写' },
    { label: '主题来源', value: topic.stored ? '画布主题卡' : '活动标题' }
  ];
  if (topic.confirmed) {
    details.push({ label: '确认人', value: topic.confirmedByName });
    details.push({ label: '确认时间', value: topic.confirmedAt || '未记录' });
  }

  return {
    id: 'theme',
    label: CANVAS_NODE_LABELS.theme,
    title: topic.title,
    summary,
    body: topic.direction || activity.data.highlights || '尚未补充主题说明。',
    version: activity.version,
    status: topic.confirmed ? 'confirmed' : topic.stored ? 'draft' : 'derived',
    statusLabel: topic.confirmed ? '已确认' : topic.stored ? '已设定' : '沿用标题',
    empty: false,
    aiMark: false,
    x: position.x,
    y: position.y,
    details,
    editable: true,
    previous: null,
    finalized: false,
    finalizedBy: '',
    finalizedAt: null
  };
}

function buildNodes(activity: ActivityRecord, positions: Positions, storedTopic: NormalizedTopic | null): CanvasNodeView[] {
  const outputs = listOutputs(activity.id);
  const tasks = listTasks(activity.id);
  const taskKindById = new Map<string, string>(tasks.map((task: TaskRecord) => [task.id, task.kind]));

  const data = activity.data;
  const schedule: CanvasNodeView = {
    id: 'schedule',
    label: CANVAS_NODE_LABELS.schedule,
    title: data.name || activity.title || '未命名活动',
    summary: [data.date, data.location].filter(Boolean).join(' · ') || '活动时间与地点尚未填写',
    body: [
      data.date && `时间：${data.date}`,
      data.location && `地点：${data.location}`,
      data.audience && `对象：${data.audience}`,
      data.notes && `备注：${data.notes}`
    ]
      .filter(Boolean)
      .join('\n'),
    version: activity.version,
    status: activity.status,
    statusLabel: ACTIVITY_STATUS_LABEL[activity.status] || activity.status,
    empty: false,
    aiMark: false,
    x: positions.schedule.x,
    y: positions.schedule.y,
    details: [
      { label: '时间', value: data.date || '待补充' },
      { label: '地点', value: data.location || '待补充' },
      { label: '对象', value: data.audience || '待补充' },
      { label: '人数', value: extractCount(activity) }
    ],
    editable: false,
    previous: null,
    finalized: false,
    finalizedBy: '',
    finalizedAt: null
  };

  const topic = topicState(activity, storedTopic);
  const plans = planOutputs(outputs, taskKindById);
  const planCurrent = pickLatest(plans);
  const wechatOutputs = platformOutputs('wechat', outputs, taskKindById);
  const wechatCurrent = pickLatest(wechatOutputs);
  const xhsOutputs = platformOutputs('xhs', outputs, taskKindById);
  const xhsCurrent = pickLatest(xhsOutputs);

  return [
    schedule,
    themeNode(activity, topic, positions.theme),
    contentNode('plan', planCurrent, previousOf(plans, planCurrent), positions.plan),
    contentNode('wechat', wechatCurrent, previousOf(wechatOutputs, wechatCurrent), positions.wechat),
    contentNode('xhs', xhsCurrent, previousOf(xhsOutputs, xhsCurrent), positions.xhs)
  ];
}

/** 从活动资料里找「人数」口径：现有 ActivityInput 没有独立人数字段，只在对象/备注文本中随文出现。 */
function extractCount(activity: ActivityRecord): string {
  const text = `${activity.data.audience} ${activity.data.notes}`;
  const matched = text.match(/(?:共|约|计划)\s*(\d{1,5})\s*(?:人|名)/) || text.match(/(\d{1,5})\s*(?:人|名)/);
  return matched ? `${matched[1]} 人（资料口径）` : '资料未记录';
}

function readStored(activityId: string): { payload: StoredCanvas; updatedAt: string } | null {
  const row = getDb()
    .prepare('SELECT payload, updated_at FROM canvas_state WHERE activity_id = ?')
    .get(activityId) as { payload: string; updated_at: string } | undefined;
  if (!row) return null;
  let parsed: StoredCanvas = {};
  try {
    const value = JSON.parse(row.payload) as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) parsed = value as StoredCanvas;
  } catch {
    parsed = {};
  }
  return { payload: parsed, updatedAt: row.updated_at };
}

function positionsFrom(payload: StoredCanvas | null): Positions {
  const positions: Positions = {
    schedule: { ...DEFAULT_POSITIONS.schedule },
    theme: { ...DEFAULT_POSITIONS.theme },
    plan: { ...DEFAULT_POSITIONS.plan },
    wechat: { ...DEFAULT_POSITIONS.wechat },
    xhs: { ...DEFAULT_POSITIONS.xhs }
  };
  if (!payload || !payload.nodes) return positions;
  for (const id of CANVAS_NODE_IDS) {
    const value = payload.nodes[id];
    if (!value || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) continue;
    positions[id] = { x: clampCoord(value.x), y: clampCoord(value.y) };
  }
  return positions;
}

function zoomFrom(payload: StoredCanvas | null): number {
  return payload && isFiniteNumber(payload.zoom) ? clampZoom(payload.zoom) : DEFAULT_ZOOM;
}

function normalizeGroups(raw: unknown): CanvasGroupState[] {
  if (!Array.isArray(raw)) return [];
  const groups: CanvasGroupState[] = [];
  for (const entry of raw.slice(0, 20)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const value = entry as Record<string, unknown>;
    const id = typeof value.id === 'string' ? value.id.trim().slice(0, 60) : '';
    if (!id) continue;
    const name = typeof value.name === 'string' ? value.name.trim().slice(0, 60) : '';
    const nodeIds = Array.isArray(value.nodeIds)
      ? [...new Set(value.nodeIds.filter((item): item is CanvasNodeId => CANVAS_NODE_IDS.includes(item as CanvasNodeId)))]
      : [];
    groups.push({ id, name: name || id, nodeIds, collapsed: value.collapsed === true });
  }
  return groups;
}

interface StoredContext {
  positions: Positions;
  zoom: number;
  groups: CanvasGroupState[];
  topic: NormalizedTopic | null;
}

function storedContext(activityId: string): StoredContext {
  const stored = readStored(activityId);
  return {
    positions: positionsFrom(stored?.payload ?? null),
    zoom: zoomFrom(stored?.payload ?? null),
    groups: stored ? normalizeGroups(stored.payload.groups) : [],
    topic: normalizeStoredTopic(stored?.payload ?? null)
  };
}

function writeStored(activityId: string, context: StoredContext, topic?: NormalizedTopic | null): void {
  const payload: StoredCanvas = {
    nodes: context.positions,
    zoom: context.zoom,
    groups: context.groups,
    topic: topic ?? context.topic ?? undefined
  };
  getDb()
    .prepare(
      `INSERT INTO canvas_state (activity_id, payload, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(activity_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`
    )
    .run(activityId, JSON.stringify(payload), nowIso());
}

export function getCanvasState(activityId: string): CanvasPayload | null {
  const activity = getActivity(activityId);
  if (!activity) return null;

  const stored = readStored(activityId);
  const positions = positionsFrom(stored?.payload ?? null);
  const storedTopic = normalizeStoredTopic(stored?.payload ?? null);

  return {
    nodes: buildNodes(activity, positions, storedTopic),
    topic: topicState(activity, storedTopic),
    zoom: zoomFrom(stored?.payload ?? null),
    groups: stored ? normalizeGroups(stored.payload.groups) : [],
    updatedAt: stored?.updatedAt ?? null,
    derived: !stored
  };
}

function canvasOf(activityId: string): CanvasWriteResult {
  return { ok: true, canvas: getCanvasState(activityId) as CanvasPayload };
}

function bad(error: string, status: 400 | 404 | 409 = 400): CanvasWriteResult {
  return { ok: false, error, status };
}

function validatePosition(id: string, value: unknown): { x: number; y: number } | string {
  if (!CANVAS_NODE_IDS.includes(id as CanvasNodeId)) return `不支持的节点：${id}`;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return `节点「${CANVAS_NODE_LABELS[id as CanvasNodeId]}」的坐标格式不正确`;
  }
  const point = value as { x?: unknown; y?: unknown };
  if (!isFiniteNumber(point.x) || !isFiniteNumber(point.y)) {
    return `节点「${CANVAS_NODE_LABELS[id as CanvasNodeId]}」的坐标必须是有限数字`;
  }
  return { x: clampCoord(point.x), y: clampCoord(point.y) };
}

/** 固定节点的写操作若显式带 nodeId，必须属于五类且与操作对象一致 */
function validateNodeTarget(input: Record<string, unknown>, expected: CanvasNodeId): string | null {
  if (!('nodeId' in input)) return null;
  const value = input.nodeId;
  if (typeof value !== 'string' || !CANVAS_NODE_IDS.includes(value as CanvasNodeId)) {
    return `不支持的节点：${typeof value === 'string' && value ? value : '（空）'}`;
  }
  if (value !== expected) return `该操作只适用于「${CANVAS_NODE_LABELS[expected]}」节点`;
  return null;
}

export function saveCanvasState(activityId: string, patch: unknown): CanvasWriteResult {
  const activity = getActivity(activityId);
  if (!activity) return bad('活动不存在', 404);

  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return bad('请求内容格式不正确');
  }
  const input = patch as Record<string, unknown>;

  const context = storedContext(activityId);
  let zoom = context.zoom;
  let groups = context.groups;

  if ('zoom' in input) {
    if (!isFiniteNumber(input.zoom)) return bad('缩放比例必须是数字');
    zoom = clampZoom(input.zoom);
  }

  if ('groups' in input) {
    if (!Array.isArray(input.groups)) return bad('分组数据格式不正确');
    groups = normalizeGroups(input.groups);
  }

  if ('nodes' in input) {
    const value = input.nodes;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return bad('节点坐标格式不正确');
    }
    for (const [id, point] of Object.entries(value as Record<string, unknown>)) {
      const result = validatePosition(id, point);
      if (typeof result === 'string') return bad(result);
      context.positions[id as CanvasNodeId] = result;
    }
  }

  context.zoom = zoom;
  context.groups = groups;
  writeStored(activityId, context);
  return canvasOf(activityId);
}

export function saveCanvasTopic(actor: CanvasActor, activityId: string, input: unknown): CanvasWriteResult {
  const activity = getActivity(activityId);
  if (!activity) return bad('活动不存在', 404);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return bad('请求内容格式不正确');
  }

  const body = input as Record<string, unknown>;
  const nodeError = validateNodeTarget(body, 'theme');
  if (nodeError) return bad(nodeError);
  const action = typeof body.action === 'string' ? body.action : 'save';
  const context = storedContext(activityId);
  const stored = context.topic;
  const hasConfirmed = Boolean(stored?.confirmedByName && stored?.confirmedAt);
  const requestedTitle = typeof body.title === 'string' ? body.title.trim().slice(0, TITLE_MAX) : '';
  const requestedDirection =
    typeof body.direction === 'string' ? body.direction.slice(0, DIRECTION_MAX) : stored?.direction ?? '';

  if (action === 'confirm') {
    const title = requestedTitle || stored?.title || '';
    if (!title) return bad('请先填写主题标题再确认');
    if (hasConfirmed && (stored?.title !== title || stored?.direction !== requestedDirection)) {
      return bad('主题已确认，请先解除确认再修改。', 409);
    }
    const next: NormalizedTopic = {
      title,
      direction: requestedDirection,
      confirmedByName: actor.name,
      confirmedAt: nowIso()
    };
    writeStored(activityId, context, next);
    audit(actor, 'canvas.topic.confirm', activityId, title);
    return canvasOf(activityId);
  }

  if (action === 'unconfirm') {
    if (!hasConfirmed) return bad('当前主题尚未确认');
    const next: NormalizedTopic = {
      title: stored?.title ?? '',
      direction: stored?.direction ?? '',
      confirmedByName: '',
      confirmedAt: null
    };
    writeStored(activityId, context, next);
    audit(actor, 'canvas.topic.unconfirm', activityId, next.title);
    return canvasOf(activityId);
  }

  if (action !== 'save') return bad('未知操作');

  if (!requestedTitle) return bad('请填写主题标题');
  const changed = !stored || stored.title !== requestedTitle || stored.direction !== requestedDirection;
  if (hasConfirmed && changed && body.unconfirm !== true) {
    return bad('主题已确认，请先解除确认再修改。', 409);
  }

  const next: NormalizedTopic = {
    title: requestedTitle,
    direction: requestedDirection,
    confirmedByName: body.unconfirm === true ? '' : stored?.confirmedByName ?? '',
    confirmedAt: body.unconfirm === true ? null : stored?.confirmedAt ?? null
  };
  writeStored(activityId, context, next);
  audit(actor, 'canvas.topic.save', activityId, `${requestedTitle}${body.unconfirm === true ? ' · 已解除确认' : ''}`);
  return canvasOf(activityId);
}

export function saveCanvasPlan(actor: CanvasActor, activityId: string, input: unknown): CanvasWriteResult {
  const activity = getActivity(activityId);
  if (!activity) return bad('活动不存在', 404);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return bad('请求内容格式不正确');
  }

  const body = input as Record<string, unknown>;
  const nodeError = validateNodeTarget(body, 'plan');
  if (nodeError) return bad(nodeError);
  const planBody = typeof body.body === 'string' ? body.body : '';
  if (!planBody.trim()) return bad('请填写方案正文');
  if (planBody.length > OUTPUT_BODY_MAX) return bad('方案正文过长（上限 40000 字）');

  const topic = topicState(activity, storedContext(activityId).topic);
  const titleInput = typeof body.title === 'string' ? body.title.trim() : '';
  const title = (titleInput || (topic.stored ? topic.title : '') || activity.data.name || activity.title || '活动方案').slice(
    0,
    160
  );
  const planningTask = listTasks(activityId).find((task) => task.kind === 'planning' || task.outputKind === 'planning');

  createOutput(actor, {
    activityId,
    taskId: planningTask?.id ?? '',
    kind: 'planning',
    title,
    body: planBody.slice(0, OUTPUT_BODY_MAX),
    aiMark: true
  });
  return canvasOf(activityId);
}

export function saveCanvasPost(actor: CanvasActor, activityId: string, input: unknown): CanvasWriteResult {
  const activity = getActivity(activityId);
  if (!activity) return bad('活动不存在', 404);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return bad('请求内容格式不正确');
  }

  const body = input as Record<string, unknown>;
  const nodeId = typeof body.nodeId === 'string' ? body.nodeId : '';
  if (!CANVAS_NODE_IDS.includes(nodeId as CanvasNodeId)) return bad(`不支持的节点：${nodeId || '（空）'}`);
  if (nodeId !== 'wechat' && nodeId !== 'xhs') return bad('只有公众号和小红书节点支持保存稿件');

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const content = typeof body.body === 'string' ? body.body : '';
  if (!title) return bad('请填写标题');
  if (!content.trim()) return bad('请填写正文');
  if (title.length > 160) return bad('标题过长（上限 160 字）');
  if (content.length > OUTPUT_BODY_MAX) return bad('正文过长（上限 40000 字）');

  const platform = nodeId as 'wechat' | 'xhs';
  const outputs = listOutputs(activityId);
  const tasks = listTasks(activityId);
  const taskKindById = new Map<string, string>(tasks.map((task: TaskRecord) => [task.id, task.kind]));
  const current = pickLatest(platformOutputs(platform, outputs, taskKindById));
  const taskId = current?.taskId ?? taskIdForPlatform(tasks, platform);

  createOutput(actor, {
    activityId,
    taskId,
    kind: platform === 'wechat' ? 'article' : 'note',
    title,
    body: content.slice(0, OUTPUT_BODY_MAX),
    tags: current?.tags ?? [],
    aiMark: true
  });
  return canvasOf(activityId);
}

export function finalizeCanvasNode(actor: CanvasActor, activityId: string, input: unknown): CanvasWriteResult {
  const activity = getActivity(activityId);
  if (!activity) return bad('活动不存在', 404);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return bad('请求内容格式不正确');
  }

  const body = input as Record<string, unknown>;
  const nodeId = typeof body.nodeId === 'string' ? body.nodeId : '';
  if (!CANVAS_NODE_IDS.includes(nodeId as CanvasNodeId)) return bad(`不支持的节点：${nodeId || '（空）'}`);
  if (nodeId !== 'wechat' && nodeId !== 'xhs') return bad('只有公众号和小红书节点支持定稿');
  if (body.aiAck !== true) {
    return bad('请先确认已核对标题与正文，并知悉内容可能含 AI 生成成分。');
  }

  const platform = nodeId as 'wechat' | 'xhs';
  const outputs = listOutputs(activityId);
  const tasks = listTasks(activityId);
  const taskKindById = new Map<string, string>(tasks.map((task: TaskRecord) => [task.id, task.kind]));
  const current = pickLatest(platformOutputs(platform, outputs, taskKindById));
  if (!current) return bad('尚未生成稿件，无法定稿');
  if (current.status === 'approved') return bad('当前版本已定稿，如需修改请编辑生成新版本。', 409);
  if (!current.body.trim()) return bad('正文为空，不能定稿');

  let result;
  if (current.status === 'pending') {
    result = approveOutput(actor, current.id, '画布定稿', true);
  } else {
    const submitted = submitOutput(actor, current.id, '画布定稿');
    if (!submitted.ok) return bad(submitted.reason, 409);
    result = approveOutput(actor, current.id, '画布定稿', true);
  }
  if (!result.ok) return bad(result.reason, 409);

  audit(actor, 'canvas.finalize', current.id, `node=${nodeId} v${current.version}`);
  return canvasOf(activityId);
}

/* ---------- AI 生成 ---------- */

type GeneratableNodeId = 'plan' | 'wechat' | 'xhs';

/** 节点对应的既有 workflow 任务类型：方案→planning，公众号→article_recruit，小红书→note_recruit */
const NODE_TASK_KIND: Record<GeneratableNodeId, string> = {
  plan: 'planning',
  wechat: 'article_recruit',
  xhs: 'note_recruit'
};

export interface CanvasGenerateResult {
  ok: true;
  canvas: CanvasPayload;
  output: { id: string; version: number; title: string; taskId: string };
  notices: string[];
  mode: string;
}

export type CanvasGenerateOutcome =
  | CanvasGenerateResult
  | { ok: false; error: string; status: 400 | 404 | 409 };

function generateFail(error: string, status: 400 | 404 | 409 = 400): CanvasGenerateOutcome {
  return { ok: false, error, status };
}

/** 从 workflow.ts 的现有模板中找生成任务定义，避免另写一套任务字段 */
function templateOfKind(kind: string) {
  return [...BASE_TEMPLATES, ...MATERIAL_PRESETS.flatMap((preset) => preset.templates)].find(
    (template) => template.kind === kind
  );
}

/**
 * 解析节点对应的生成任务：
 * 1) 优先复用该节点最新版本所属任务，保证版本号连续；
 * 2) 其次复用活动流程里同类型的既有 AI 任务；
 * 3) 都没有时，按 workflow.ts 模板补建一条真实任务并写入 audit，绝不使用空串或虚构 task_id。
 */
function ensureGenerateTask(
  actor: CanvasActor,
  activityId: string,
  nodeId: GeneratableNodeId,
  tasks: TaskRecord[],
  latestTaskId: string
): TaskRecord | null {
  if (latestTaskId) {
    const current = tasks.find((task) => task.id === latestTaskId);
    if (current) return current;
  }

  const kind = NODE_TASK_KIND[nodeId];
  let matched: TaskRecord | undefined;
  if (nodeId === 'plan') {
    matched = tasks.find((task) => task.kind === 'planning' || task.outputKind === 'planning');
  } else if (nodeId === 'wechat') {
    matched =
      tasks.find((task) => task.kind === 'article_recruit') ??
      tasks.find((task) => task.outputKind === 'article');
  } else {
    matched =
      tasks.find((task) => task.kind === 'note_recruit') ??
      tasks.find((task) => task.outputKind === 'note');
  }
  if (matched) return matched;

  const template = templateOfKind(kind);
  if (!template) return null;
  const created = createTask(actor, activityId, {
    title: template.title,
    stage: template.stage,
    kind: template.kind,
    mode: template.mode,
    outputKind: template.outputKind,
    role: template.role
  });
  if (created) {
    audit(
      actor,
      'canvas.task.ensure',
      created.id,
      `node=${nodeId} kind=${kind} template=${template.key}（画布生成缺少对应任务，按 workflow 模板补建）`
    );
  }
  return created;
}

/**
 * 画布节点 AI 生成：复用 runTaskGeneration（同一 prompt 构建、语气库注入、outputs/ai_runs/audit 约定）。
 * 模型未配置时不走 demo 兜底，直接返回可读错误，避免产生半成品 output。
 */
export async function generateCanvasNode(
  actor: CanvasActor,
  activityId: string,
  input: unknown
): Promise<CanvasGenerateOutcome> {
  const activity = getActivity(activityId);
  if (!activity) return generateFail('活动不存在或已被删除', 404);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return generateFail('请求内容格式不正确');
  }

  const body = input as Record<string, unknown>;
  const nodeId = typeof body.nodeId === 'string' ? body.nodeId : '';
  if (!CANVAS_NODE_IDS.includes(nodeId as CanvasNodeId)) {
    return generateFail(`不支持的节点：${nodeId || '（空）'}`);
  }
  if (nodeId !== 'plan' && nodeId !== 'wechat' && nodeId !== 'xhs') {
    return generateFail('只有方案、公众号和小红书节点支持 AI 生成');
  }
  const target = nodeId as GeneratableNodeId;

  // 主题未确认时明确提示，不静默使用活动标题代替
  const storedTopic = storedContext(activityId).topic;
  const topicConfirmed = Boolean(storedTopic?.confirmedByName && storedTopic?.confirmedAt);
  if (!storedTopic || !topicConfirmed) {
    return generateFail(
      '主题尚未确认。请先在「主题」节点确认主题标题与方向后再生成，避免使用未确认的内容。',
      409
    );
  }

  if (!isLiveModel()) {
    return generateFail(
      '尚未配置 AI 模型（ARK_API_KEY / ARK_MODEL），无法生成草稿。请联系内容组配置后再试；本次未生成任何版本。',
      409
    );
  }

  const materials = listMaterials(activityId, { id: actor.id, name: actor.name });
  const usableMaterials = materials.filter((material) => !blocksGeneration(material));
  const skipped = materials.length - usableMaterials.length;

  const outputs = listOutputs(activityId);
  const tasks = listTasks(activityId);
  const taskKindById = new Map<string, string>(tasks.map((task: TaskRecord) => [task.id, task.kind]));
  const planCurrent = pickLatest(planOutputs(outputs, taskKindById));
  const latestNodeOutput =
    target === 'plan'
      ? planCurrent
      : pickLatest(platformOutputs(target, outputs, taskKindById));

  const task = ensureGenerateTask(actor, activityId, target, tasks, latestNodeOutput?.taskId ?? '');
  if (!task) return generateFail('未能找到或补建对应的生成任务，请回工作台检查活动流程后再试。', 409);
  if (task.mode !== 'ai') {
    return generateFail('该节点对应的任务不是 AI 生成类型，请在任务详情中人工处理。', 409);
  }

  const notices: string[] = [];
  if (skipped > 0) {
    notices.push(`已跳过 ${skipped} 张未授权图片，请先在资料库补齐监护人授权或确认画面不含未成年人。`);
  }

  const references: GenerationReference[] = [];
  if (planCurrent?.body.trim()) {
    references.push({
      label: target === 'plan' ? '现有方案版本' : '最新方案版本',
      text: planCurrent.body
    });
  } else if (target !== 'plan') {
    notices.push('当前还没有方案版本，本次仅基于活动资料与已确认主题生成，建议先补方案。');
  }

  try {
    const result = await runTaskGeneration({
      actor,
      activity,
      task,
      materials: usableMaterials,
      topic: { title: storedTopic.title, direction: storedTopic.direction },
      references
    });
    notices.push(...result.notices);
    audit(
      actor,
      'canvas.generate',
      result.output.id,
      `node=${target} task=${task.id} v${result.output.version} mode=${result.mode}`
    );
    return {
      ok: true,
      canvas: getCanvasState(activityId) as CanvasPayload,
      output: {
        id: result.output.id,
        version: result.output.version,
        title: result.output.title,
        taskId: result.output.taskId
      },
      notices,
      mode: result.mode
    };
  } catch (error) {
    const message = error instanceof Error ? error.message.trim() : '';
    // 网络层异常（如 fetch failed）不是中文，统一换成可读提示；已有中文错误原样透出
    const readable = message && /[\u4e00-\u9fa5]/.test(message)
      ? message
      : '模型调用失败，请稍后重试；本次未生成任何新版本。';
    return generateFail(readable, 409);
  }
}
