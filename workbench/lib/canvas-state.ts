import { getActivity, type ActivityRecord } from '@/lib/activities';
import { getDb, nowIso } from '@/lib/db';
import { listOutputs } from '@/lib/outputs';
import { listTasks } from '@/lib/tasks';
import { ACTIVITY_STATUS_LABEL, CONTENT_STATUS_LABEL } from '@/lib/workflow';
import type { OutputRecord, TaskRecord } from '@/lib/workspace-types';

/**
 * 「只读画布视图」的服务端状态。
 *
 * 画布只有固定五类节点：排期 / 主题 / 方案 / 公众号 / 小红书。
 * 节点内容全部由活动、任务与成品现场推导，画布只持久化节点坐标、缩放与分组，
 * 不保存任何正文，也不提供编辑能力。
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

export interface CanvasNodeDetail {
  label: string;
  value: string;
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
  x: number;
  y: number;
  details: CanvasNodeDetail[];
}

export interface CanvasGroupState {
  id: string;
  name: string;
  nodeIds: CanvasNodeId[];
  collapsed: boolean;
}

export interface CanvasPayload {
  nodes: CanvasNodeView[];
  zoom: number;
  groups: CanvasGroupState[];
  updatedAt: string | null;
  /** 没有任何已保存状态、节点内容来自现场推导 */
  derived: boolean;
}

type Positions = Record<CanvasNodeId, { x: number; y: number }>;

interface StoredCanvas {
  nodes?: Record<string, { x?: unknown; y?: unknown }>;
  zoom?: unknown;
  groups?: unknown;
}

export const COORD_MIN = -10000;
export const COORD_MAX = 10000;
export const ZOOM_MIN = 0.3;
export const ZOOM_MAX = 2;
export const DEFAULT_ZOOM = 0.8;

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

/** 从活动资料里找「人数」口径：现有 ActivityInput 没有独立人数字段，只在对象/备注文本中随文出现。 */
function extractCount(activity: ActivityRecord): string {
  const text = `${activity.data.audience} ${activity.data.notes}`;
  const matched = text.match(/(?:共|约|计划)\s*(\d{1,5})\s*(?:人|名)/) || text.match(/(\d{1,5})\s*(?:人|名)/);
  return matched ? `${matched[1]} 人（资料口径）` : '资料未记录';
}

function excerpt(text: string, max = 150): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/** 同一任务可能有多个版本：优先已采用，其次最近更新，最后版本号。 */
function pickLatest(list: OutputRecord[]): OutputRecord | undefined {
  return [...list].sort((a, b) => {
    if (a.adopted !== b.adopted) return a.adopted ? -1 : 1;
    if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
    return b.version - a.version;
  })[0];
}

/**
 * 平台成品映射依据：
 * - task-gen 落库时 output.kind = task.outputKind；workflow.ts 中公众号任务 outputKind 为 article，小红书任务为 note。
 * - 历史或自定义任务缺 outputKind 时，退回到 task.kind：article_recruit / article_review → 公众号，note_recruit → 小红书。
 */
function platformOutput(
  platform: 'wechat' | 'xhs',
  outputs: OutputRecord[],
  taskKindById: Map<string, string>
): OutputRecord | undefined {
  const directKind = platform === 'wechat' ? 'article' : 'note';
  const direct = outputs.filter((item) => item.kind === directKind);
  if (direct.length) return pickLatest(direct);

  const fallbackKinds = platform === 'wechat' ? ['article_recruit', 'article_review'] : ['note_recruit'];
  const fallback = outputs.filter((item) => {
    const taskKind = taskKindById.get(item.taskId);
    return taskKind ? fallbackKinds.includes(taskKind) : false;
  });
  return pickLatest(fallback);
}

function contentNode(
  id: 'plan' | 'wechat' | 'xhs',
  output: OutputRecord | undefined,
  position: { x: number; y: number }
): CanvasNodeView {
  const label = CANVAS_NODE_LABELS[id];
  if (!output) {
    const emptyText =
      id === 'plan' ? '尚未生成方案' : id === 'wechat' ? '尚未生成公众号稿' : '尚未生成小红书稿';
    const hint =
      id === 'plan'
        ? '这场活动还没有方案稿。可在工作台生成方案后回到画布查看，画布本身不会触发生成。'
        : '工作台里还没有对应平台的稿件。生成并保存后会同步显示在这里，画布本身不会触发生成。';
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
      x: position.x,
      y: position.y,
      details: []
    };
  }

  const body = output.body.trim();
  return {
    id,
    label,
    title: output.title || emptyLabel(id),
    summary: excerpt(body || '暂无正文，可回到工作台查看。'),
    body: body || '暂无正文。',
    version: output.version,
    status: output.status,
    statusLabel: CONTENT_STATUS_LABEL[output.status] || output.status,
    empty: false,
    x: position.x,
    y: position.y,
    details: [
      { label: '类型', value: output.kind || '未标注' },
      { label: '最近更新', value: output.updatedAt },
      { label: '创建人', value: output.createdByName || '未记录' }
    ]
  };
}

function emptyLabel(id: 'plan' | 'wechat' | 'xhs'): string {
  return id === 'plan' ? '方案' : id === 'wechat' ? '公众号稿' : '小红书稿';
}

function buildNodes(activity: ActivityRecord, positions: Positions): CanvasNodeView[] {
  const outputs = listOutputs(activity.id);
  const tasks = listTasks(activity.id);
  const taskKindById = new Map<string, string>(tasks.map((task: TaskRecord) => [task.id, task.kind]));

  const data = activity.data;
  const schedule: CanvasNodeView = {
    id: 'schedule',
    label: CANVAS_NODE_LABELS.schedule,
    title: data.name || activity.title || '未命名活动',
    summary: [data.date, data.location].filter(Boolean).join(' · ') || '活动时间与地点尚未填写',
    body: [data.date && `时间：${data.date}`, data.location && `地点：${data.location}`, data.audience && `对象：${data.audience}`, data.notes && `备注：${data.notes}`]
      .filter(Boolean)
      .join('\n'),
    version: activity.version,
    status: activity.status,
    statusLabel: ACTIVITY_STATUS_LABEL[activity.status] || activity.status,
    empty: false,
    x: positions.schedule.x,
    y: positions.schedule.y,
    details: [
      { label: '时间', value: data.date || '待补充' },
      { label: '地点', value: data.location || '待补充' },
      { label: '对象', value: data.audience || '待补充' },
      { label: '人数', value: extractCount(activity) }
    ]
  };

  // ActivityInput 目前没有 topic 字段；若历史数据里存在 topic.title 则优先使用，否则回退活动标题。
  const rawData = data as unknown as Record<string, unknown>;
  const topic = rawData.topic as { title?: unknown } | undefined;
  const topicTitle = typeof topic?.title === 'string' ? topic.title.trim() : '';
  const theme: CanvasNodeView = {
    id: 'theme',
    label: CANVAS_NODE_LABELS.theme,
    title: topicTitle || activity.title || '尚未设定主题',
    summary: data.highlights
      ? excerpt(data.highlights)
      : topicTitle
        ? '主题已单独设定，详细说明待补充。'
        : '当前直接沿用活动标题作为主题，尚未单独设定主题。',
    body: data.highlights || '尚未补充主题说明。',
    version: activity.version,
    status: topicTitle ? 'confirmed' : 'derived',
    statusLabel: topicTitle ? '已设定' : '沿用标题',
    empty: false,
    x: positions.theme.x,
    y: positions.theme.y,
    details: [
      { label: '活动名称', value: data.name || activity.title },
      { label: '所属项目', value: data.project || '未填写' },
      { label: '主题来源', value: topicTitle ? '活动资料 · 主题字段' : '活动标题' }
    ]
  };

  const planOutput = pickLatest(
    outputs.filter(
      (item) => item.kind === 'planning' || taskKindById.get(item.taskId) === 'planning'
    )
  );

  return [
    schedule,
    theme,
    contentNode('plan', planOutput, positions.plan),
    contentNode('wechat', platformOutput('wechat', outputs, taskKindById), positions.wechat),
    contentNode('xhs', platformOutput('xhs', outputs, taskKindById), positions.xhs)
  ];
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

export function getCanvasState(activityId: string): CanvasPayload | null {
  const activity = getActivity(activityId);
  if (!activity) return null;

  const stored = readStored(activityId);
  const positions = positionsFrom(stored?.payload ?? null);

  return {
    nodes: buildNodes(activity, positions),
    zoom: zoomFrom(stored?.payload ?? null),
    groups: stored ? normalizeGroups(stored.payload.groups) : [],
    updatedAt: stored?.updatedAt ?? null,
    derived: !stored
  };
}

export type SaveCanvasResult = { ok: true; canvas: CanvasPayload } | { ok: false; error: string };

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

export function saveCanvasState(activityId: string, patch: unknown): SaveCanvasResult {
  const activity = getActivity(activityId);
  if (!activity) return { ok: false, error: '活动不存在' };

  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, error: '请求内容格式不正确' };
  }
  const input = patch as Record<string, unknown>;

  const stored = readStored(activityId);
  const positions = positionsFrom(stored?.payload ?? null);
  let zoom = zoomFrom(stored?.payload ?? null);
  let groups = stored ? normalizeGroups(stored.payload.groups) : [];

  if ('zoom' in input) {
    if (!isFiniteNumber(input.zoom)) return { ok: false, error: '缩放比例必须是数字' };
    zoom = clampZoom(input.zoom);
  }

  if ('groups' in input) {
    if (!Array.isArray(input.groups)) return { ok: false, error: '分组数据格式不正确' };
    groups = normalizeGroups(input.groups);
  }

  if ('nodes' in input) {
    const value = input.nodes;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: '节点坐标格式不正确' };
    }
    for (const [id, point] of Object.entries(value as Record<string, unknown>)) {
      const result = validatePosition(id, point);
      if (typeof result === 'string') return { ok: false, error: result };
      positions[id as CanvasNodeId] = result;
    }
  }

  const payload: StoredCanvas = { nodes: positions, zoom, groups };
  getDb()
    .prepare(
      `INSERT INTO canvas_state (activity_id, payload, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(activity_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`
    )
    .run(activityId, JSON.stringify(payload), nowIso());

  return { ok: true, canvas: getCanvasState(activityId) as CanvasPayload };
}
