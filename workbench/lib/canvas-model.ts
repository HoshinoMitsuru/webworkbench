/**
 * 「共享创作画布」的状态机纯逻辑。
 *
 * 移植自 demo/ui-canvas-prototype/dist/model.js（UI 组交付的独立 HTML 原型中的纯领域逻辑）。
 * 约束：与原型保持行为一致——函数名、参数顺序、返回值语义、异常文案均原样保留，
 * 不做「顺手修复」，以便后续 React 画布视图直接复用同一套规则。
 *
 * 本文件自包含：不引用 @/ 别名、Node 内置模块，也不依赖 window / document / localStorage
 * 等浏览器 API（时间戳统一用全局 Date，避免依赖运行环境）。
 */

export type NodeType = 'schedule' | 'theme' | 'plan' | 'text' | 'image' | 'wechat' | 'xhs';
export type NodeKind = 'schedule' | 'theme' | 'plan' | 'text' | 'image' | 'post';
export type Platform = 'wechat' | 'xhs';

export interface ScheduleFacts {
  title: string;
  date: string;
  place: string;
  audience: string;
  count: string;
  signup: string;
  requirement: string;
  source: string;
}

export interface PlanContent {
  goal: string;
  audience: string;
  agenda: string;
  focus: string;
}

export interface ImageState {
  title: string;
  subtitle: string;
  date: string;
  place: string;
  background: string;
  ink: string;
  fontSize: number;
  layout: string;
  round: number;
  photo: string;
  source: string;
  usable: boolean;
}

export interface PlanInput {
  sourceId: string | null;
  version: number;
  content: PlanContent;
  topic: string;
  facts: ScheduleFacts;
}

export interface ActorStamp {
  actor: string;
  at: string;
  version: number;
}

export interface AdoptedPlan extends ActorStamp {
  content: PlanContent;
}

export interface CanvasNode {
  id: string;
  kind: NodeKind;
  name: string;
  x: number;
  y: number;
  revision: number;
  history: HistoryEntry[];
  refs: SourceRef[];
  ignoredRefs: Record<string, number | 'missing'>;
  finalized: Finalized | null;
  platform?: Platform;
  data?: ScheduleFacts;
  title?: string;
  body?: string;
  image?: ImageState;
  content?: PlanContent;
  input?: PlanInput;
  topic?: string;
  direction?: string;
  source?: string;
  confirmed?: ActorStamp | null;
  adopted?: AdoptedPlan | null;
  example?: boolean;
  poster?: boolean;
  format?: Platform;
  [key: string]: unknown;
}

/**
 * 历史快照：运行时由 snap() 深拷贝节点并删除 history / finalized 两个字段，
 * 避免自引用膨胀；为保持结构可继续按节点读取，类型上沿用 CanvasNode。
 */
export type NodeSnapshot = CanvasNode;

export interface SourceRef {
  id: string;
  name: string;
  kind: NodeKind;
  version: number;
  snapshot: NodeSnapshot;
  missing?: boolean;
}

export interface HistoryEntry {
  label: string;
  actor: string;
  at: string;
  snapshot: NodeSnapshot;
}

export interface Finalized {
  actor: string;
  at: string;
  version: number;
  snapshot: NodeSnapshot;
}

export interface CanvasGroup {
  id: string;
  name: string;
  nodeIds: string[];
  collapsed: boolean;
}

export interface CanvasComment {
  id: string;
  nodeId: string;
  field: string;
  text: string;
  actor: string;
  at: string;
  version: number;
  mentions: string[];
}

export interface CanvasEvent {
  text: string;
  actor: string;
  at: string;
}

export interface UndoSnapshot {
  label: string;
  nodes: CanvasNode[];
  groups: CanvasGroup[];
  comments: CanvasComment[];
  selected: string;
  selection: string[];
  schedule: ScheduleFacts;
}

export interface CanvasState {
  schema: number;
  revision: number;
  actor: string;
  project: string;
  schedule: ScheduleFacts;
  assets: Record<string, string>;
  nodes: CanvasNode[];
  groups: CanvasGroup[];
  undo: UndoSnapshot[];
  comments: CanvasComment[];
  events: CanvasEvent[];
  selected: string;
  selection: string[];
  view?: { x: number; y: number; zoom: number };
  [key: string]: unknown;
}

export const members: string[] = ['小林', '小王', '阿悦'];

export const types: Record<NodeType, string> = {
  schedule: '排期',
  theme: '活动主题',
  plan: '活动方案',
  text: '文字资料',
  image: '图片素材',
  wechat: '公众号推文',
  xhs: '小红书推文',
};

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export const now = (): string =>
  new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

export function uid(p: string): string {
  return p + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

export function get(s: CanvasState, id: string | null): CanvasNode | undefined {
  return s.nodes.find((n) => n.id === id);
}

export function type(n: CanvasNode): NodeType {
  return n.kind === 'post' ? (n.platform as Platform) : n.kind;
}

export const facts = (): ScheduleFacts => ({
  title: '12月职业探索活动',
  date: '2026年12月12日 14:00—16:30',
  place: '青年活动中心 · 创作空间',
  audience: '对产品设计感兴趣的青年',
  count: '30',
  signup: 'https://example.org/signup',
  requirement: '职业介绍与动手体验，制作公众号和小红书招募推文。',
  source: '团队12月活动排期 · 演示资料',
});

export function log(s: CanvasState, text: string): void {
  s.events.unshift({ text, actor: s.actor, at: now() });
}

export function snap(n: CanvasNode): NodeSnapshot {
  const a = clone(n);
  delete (a as Partial<CanvasNode>).history;
  delete (a as Partial<CanvasNode>).finalized;
  return a;
}

export function checkpoint(s: CanvasState, n: CanvasNode, label: string): void {
  n.history ||= [];
  n.history.unshift({ label, actor: s.actor, at: now(), snapshot: snap(n) });
}

export function storeAsset(s: CanvasState, data: string): string {
  s.assets ||= {};
  const old = Object.keys(s.assets).find((id) => s.assets[id] === data);
  if (old) return old;
  const id = uid('asset');
  s.assets[id] = data;
  return id;
}

export function collectAssets(s: CanvasState): void {
  const used = new Set<string>();
  function walk(o: unknown): void {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (k === 'photo' && typeof v === 'string') used.add(v);
      else walk(v);
    }
  }
  walk(s.nodes);
  walk(s.undo);
  for (const id of Object.keys(s.assets || {})) if (!used.has(id)) delete s.assets[id];
}

export function migrateAssets(s: CanvasState): void {
  s.assets ||= {};
  function walk(o: unknown): void {
    if (!o || typeof o !== 'object') return;
    const rec = o as Record<string, unknown>;
    for (const k of Object.keys(rec)) {
      if (k === 'assets') continue;
      if (k === 'photo' && typeof rec[k] === 'string' && (rec[k] as string).startsWith('data:image/')) {
        rec[k] = storeAsset(s, rec[k] as string);
      } else walk(rec[k]);
    }
  }
  walk(s);
}

export function remember(s: CanvasState, label: string): void {
  s.undo ||= [];
  s.undo.push({
    label,
    nodes: clone(s.nodes),
    groups: clone(s.groups),
    comments: clone(s.comments),
    selected: s.selected,
    selection: clone(s.selection),
    schedule: clone(s.schedule),
  });
  if (s.undo.length > 10) s.undo.shift();
}

export function undo(s: CanvasState): string {
  const u = s.undo.pop();
  if (!u) throw Error('没有可撤销的操作');
  Object.assign(s, {
    nodes: u.nodes,
    groups: u.groups,
    comments: u.comments,
    selected: u.selected,
    selection: u.selection,
    schedule: u.schedule,
  });
  log(s, '撤销：' + u.label);
  return u.label;
}

export function sourceRef(n: CanvasNode): SourceRef {
  return { id: n.id, name: n.name, kind: n.kind, version: n.revision, snapshot: snap(n) };
}

export function planDraft(
  s: CanvasState,
  t?: { title?: string; direction?: string } | null,
): PlanContent {
  return {
    goal: `围绕“${t?.title || s.project}”，${t?.direction || '从身边的问题开始，练习观察、构思与表达。'}`,
    audience: s.schedule.audience,
    agenda: '14:00—14:15 签到与破冰\n14:15—14:45 职业介绍与案例\n14:45—15:50 创意与草图体验\n15:50—16:30 小组交流',
    focus: '强调职业探索与动手实践，清楚说明时间、地点和报名方式。',
  };
}

export function planInput(s: CanvasState, id: string | null = 'plan'): PlanInput {
  const p = get(s, id);
  return p?.kind === 'plan'
    ? {
        sourceId: p.id,
        version: p.revision,
        content: clone(p.content as PlanContent),
        topic: p.topic || s.project,
        facts: clone(s.schedule),
      }
    : { sourceId: null, version: 0, content: planDraft(s), topic: s.project, facts: clone(s.schedule) };
}

export function imageFor(
  s: CanvasState,
  input: PlanInput,
  platform: Platform,
  round = 1,
): ImageState {
  return {
    title: platform === 'xhs' ? '把好奇变成一个设计' : '来体验产品设计师的一天',
    subtitle: input.content.focus,
    date: (input.facts || s.schedule).date,
    place: (input.facts || s.schedule).place,
    background: round % 2 ? '#F4F4F0' : '#EBEBE6',
    ink: '#16181B',
    fontSize: 42,
    layout: round % 2 ? 'left' : 'center',
    round,
    photo: '',
    source: '本地模板排版 · 模拟生成，非现场照片',
    usable: true,
  };
}

export function textFor(
  s: CanvasState,
  input: PlanInput,
  platform: Platform,
  part: 'title' | 'body',
): string {
  const f = input.facts || s.schedule;
  if (part === 'title')
    return (input.topic || s.project) + (platform === 'xhs' ? '｜从一个问题开始' : '｜活动招募');
  return `${platform === 'xhs' ? '从身边的问题出发，一起体验设计。' : '从一个具体问题开始，走近产品设计师的日常。\n\n一、为什么参与'}\n\n${input.content.goal}\n\n${platform === 'xhs' ? '一起做什么：' : '二、活动安排'}\n${input.content.agenda}\n\n${platform === 'xhs' ? '活动信息' : '三、活动信息'}\n面向：${input.content.audience}\n时间：${f.date}\n地点：${f.place}\n计划招募${f.count}人（非实际到场人数）\n报名：${f.signup}\n\n${platform === 'xhs' ? '#职业探索 #产品设计' : '传播重点：' + input.content.focus}\n费用及参与条件：待团队核对。`;
}

export function makeNode(
  s: CanvasState,
  t: NodeType,
  pos: { x?: number; y?: number } = { x: 100, y: 100 },
): CanvasNode {
  if (!types[t]) throw Error('不支持该节点类型');
  const n: CanvasNode = {
    id: uid(t),
    kind: t === 'wechat' || t === 'xhs' ? 'post' : t,
    name: types[t],
    x: Math.max(0, Number(pos.x) || 0),
    y: Math.max(0, Number(pos.y) || 0),
    revision: 1,
    history: [],
    refs: [],
    ignoredRefs: {},
    finalized: null,
  };
  if (n.kind === 'schedule') {
    n.data = clone(s.schedule);
    n.data.title ||= '12月职业探索活动';
  }
  if (t === 'theme')
    Object.assign(n, {
      title: s.project,
      direction: '从身边的问题开始，练习观察、构思与表达。',
      confirmed: null,
    });
  if (t === 'plan') Object.assign(n, { content: planDraft(s), topic: s.project, adopted: null });
  if (t === 'text')
    Object.assign(n, {
      title: '活动资料',
      body: '在这里补充活动事实、文案要求或参考信息。',
      source: '团队补充 · 待核对',
    });
  if (t === 'image')
    Object.assign(n, {
      title: '项目图片',
      image: imageFor(s, planInput(s), 'xhs'),
      body: '填写画面说明；不自动识别图片。',
    });
  if (n.kind === 'post') {
    n.platform = t as Platform;
    n.input = planInput(s, null);
    n.title = textFor(s, n.input, t as Platform, 'title');
    n.body = textFor(s, n.input, t as Platform, 'body');
    n.image = imageFor(s, n.input, t as Platform);
  }
  return n;
}

export function reaches(s: CanvasState, from: string, to: string, seen = new Set<string>()): boolean {
  if (from === to) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return (get(s, from)?.refs || []).some((r) => !r.missing && reaches(s, r.id, to, seen));
}

export function setRefs(s: CanvasState, id: string, ids: string[]): CanvasNode {
  const n = get(s, id);
  if (!n) throw Error('节点不存在');
  const sources = [...new Set(ids)].map((key) => {
    const v = get(s, key);
    if (!v) throw Error('该来源已不存在，请重新选择');
    if (reaches(s, key, id)) throw Error('此引用会形成循环，请选择其他资料');
    return v;
  });
  checkpoint(s, n, '变更引用前');
  n.refs = sources.map(sourceRef);
  n.ignoredRefs = {};
  if (n.kind === 'post') {
    const plan = sources.find((v) => v.kind === 'plan');
    if (plan) n.input = planInput(s, plan.id);
    const image = sources.find((v) => v.kind === 'image');
    if (image)
      Object.assign(n.image!, {
        photo: image.image!.photo,
        source: image.image!.source,
        usable: image.image!.usable,
      });
  }
  n.revision++;
  n.finalized = null;
  return n;
}

export function createNode(
  s: CanvasState,
  t: NodeType,
  pos?: { x?: number; y?: number },
  sourceIds: string[] = [],
): CanvasNode {
  const n = makeNode(s, t, pos);
  if (s.schema === 3 && s.nodes.length) {
    for (let i = 0; i <= s.nodes.length; i++) {
      const hit = s.nodes.find(
        (v) =>
          n.x < v.x + (v.kind === 'post' ? 420 : 370) + 30 &&
          n.x + 420 > v.x - 30 &&
          n.y < v.y + 650 &&
          n.y + 650 > v.y,
      );
      if (!hit) break;
      n.x = hit.x + (hit.kind === 'post' ? 420 : 370) + 60;
    }
  }
  s.nodes.push(n);
  try {
    if (sourceIds.length) setRefs(s, n.id, sourceIds);
  } catch (e) {
    s.nodes.pop();
    throw e;
  }
  if (n.kind === 'post' && sourceIds.length) {
    n.title = textFor(s, n.input!, n.platform!, 'title');
    n.body = textFor(s, n.input!, n.platform!, 'body');
  }
  log(s, '新增' + n.name);
  return n;
}

export function seed(): CanvasState {
  const s: CanvasState = {
    schema: 3,
    revision: 0,
    actor: '我',
    project: '职业探索日 · 产品设计师体验',
    schedule: facts(),
    assets: {},
    nodes: [],
    groups: [],
    undo: [],
    comments: [],
    events: [],
    selected: 'schedule',
    selection: ['schedule'],
    view: { x: 30, y: 24, zoom: 0.75 },
  };
  const positions: [number, number][] = [
    [40, 40],
    [350, 40],
    [730, 40],
    [1170, 40],
    [1640, 40],
  ];
  (['schedule', 'theme', 'plan', 'wechat', 'xhs'] as const).forEach((t, i) => {
    const n = createNode(s, t, { x: positions[i][0], y: positions[i][1] });
    n.id = t;
    n.x = positions[i][0];
    n.y = positions[i][1];
    s.nodes[s.nodes.length - 1] = n;
  });
  get(s, 'theme')!.refs = [sourceRef(get(s, 'schedule')!)];
  get(s, 'plan')!.refs = [sourceRef(get(s, 'theme')!)];
  for (const id of ['wechat', 'xhs'] as const) {
    const n = get(s, id)!;
    n.refs = [sourceRef(get(s, 'plan')!)];
    n.input = planInput(s);
    n.example = true;
  }
  s.events = [];
  return s;
}

export function prepareCanvas(s: CanvasState): CanvasState {
  if (s.schema === 3) return s;
  if (s.schema !== 2) throw Error('不支持的数据版本');
  s.groups ||= [];
  s.undo ||= [];
  s.selection = s.selected ? [s.selected] : [];
  s.assets ||= {};
  s.actor ||= '我';
  for (const n of s.nodes) {
    n.name ||= types[type(n)] || n.title || '内容';
    n.history ||= [];
    n.refs ||= [];
    n.ignoredRefs ||= {};
    if (n.kind === 'schedule') {
      n.data = clone(s.schedule);
      n.data.title ||= '12月职业探索活动';
    }
    if (n.kind === 'plan' && !n.content) n.content = planDraft(s, get(s, 'theme'));
  }
  for (const n of s.nodes) {
    if (n.refs.length) continue;
    const source =
      n.kind === 'post'
        ? get(s, n.input?.sourceId || 'plan')
        : n.kind === 'plan'
          ? get(s, 'theme')
          : n.kind === 'theme'
            ? get(s, 'schedule')
            : null;
    if (source) {
      const r = sourceRef(source);
      if (n.kind === 'post' && n.input) {
        r.version = n.input.version;
        r.snapshot.content = clone(n.input.content);
        r.snapshot.topic = n.input.topic;
      }
      n.refs = [r];
      if (n.kind === 'post') n.input!.sourceId = source.id;
    }
  }
  s.schema = 3;
  migrateAssets(s);
  return s;
}

export function update(s: CanvasState, id: string, field: string, value: unknown): CanvasNode {
  const n = get(s, id);
  if (!n) throw Error('节点不存在');
  if (field.startsWith('content.')) {
    (n.content as unknown as Record<string, unknown>)[field.slice(8)] = value;
  } else if (field.startsWith('image.')) {
    (n.image as unknown as Record<string, unknown>)[field.slice(6)] = value;
  } else if (n.kind === 'schedule' && field !== 'name') {
    (n.data as unknown as Record<string, unknown>)[field] = value;
  } else {
    n[field] = value;
  }
  if (n.id === 'schedule') s.schedule = clone(n.data!);
  n.revision++;
  n.finalized = null;
  if (n.kind === 'theme') n.confirmed = null;
  if (n.kind === 'post') n.example = false;
  return n;
}

export function withPhoto(s: CanvasState, id: string, data: string, source: string): CanvasState {
  const next = clone(s);
  update(next, id, 'image.photo', storeAsset(next, data));
  update(next, id, 'image.source', source);
  update(next, id, 'image.usable', false);
  collectAssets(next);
  return next;
}

export function confirmTheme(s: CanvasState, id = 'theme'): void {
  const n = get(s, id)!;
  if (!n.title!.trim()) throw Error('请填写主题');
  n.confirmed = { actor: s.actor, at: now(), version: n.revision };
  checkpoint(s, n, '确认主题');
}

export function adoptPlan(s: CanvasState, id = 'plan'): void {
  const n = get(s, id)!;
  if (Object.values(n.content!).some((v) => !v.trim())) throw Error('请补全方案字段');
  n.adopted = {
    actor: s.actor,
    at: now(),
    version: n.revision,
    content: clone(n.content!),
  };
  checkpoint(s, n, '采用方案');
}

export function generatePlan(s: CanvasState, themeId = 'theme'): CanvasNode {
  const t = get(s, themeId)!;
  const n = createNode(s, 'plan', { x: t.x + 400, y: t.y }, [themeId]);
  n.content = planDraft(s, t);
  n.topic = t.title;
  return n;
}

export function generatePosts(
  s: CanvasState,
  platforms: Platform[],
  planId = 'plan',
): CanvasNode[] {
  if (!platforms.length) throw Error('请至少选择一个平台');
  const p = get(s, planId);
  if (p?.kind !== 'plan') throw Error('请选择活动方案');
  return platforms.map((t, i) =>
    createNode(
      s,
      t,
      {
        x: p.x + 440 + i * 470,
        y: p.y + 40 + s.nodes.filter((n) => n.kind === 'post' && n.refs.some((r) => r.id === planId)).length * 80,
      },
      [planId],
    ),
  );
}

export function changedRefs(s: CanvasState, n: CanvasNode): SourceRef[] {
  return (n.refs || []).filter((r) => {
    const target = get(s, r.id);
    return (
      ((r.missing || !target) && n.ignoredRefs?.[r.id] !== 'missing') ||
      (!!target && target.revision !== r.version && n.ignoredRefs?.[r.id] !== target.revision)
    );
  });
}

export function stale(s: CanvasState, n: CanvasNode): boolean {
  return changedRefs(s, n).length > 0;
}

export function keepRefs(s: CanvasState, id: string): void {
  const n = get(s, id)!;
  for (const r of n.refs) n.ignoredRefs[r.id] = get(s, r.id)?.revision || 'missing';
}

export function syncRef(s: CanvasState, id: string, sourceId: string): void {
  const n = get(s, id)!;
  const src = get(s, sourceId);
  const r = n.refs.find((r) => r.id === sourceId);
  if (!src || !r) throw Error('来源已删除，请重新选择');
  checkpoint(s, n, '同步来源前（保留手改稿）');
  Object.assign(r, sourceRef(src));
  if (n.kind === 'post') {
    if (src.kind === 'plan') {
      n.input = planInput(s, src.id);
      n.title = textFor(s, n.input, n.platform!, 'title');
      n.body = textFor(s, n.input, n.platform!, 'body');
    }
    if (src.kind === 'image')
      Object.assign(n.image!, {
        photo: src.image!.photo,
        source: src.image!.source,
        usable: src.image!.usable,
      });
  }
  delete n.ignoredRefs[src.id];
  n.revision++;
  n.finalized = null;
}

export function refreshPost(s: CanvasState, id: string): void {
  for (const r of [...get(s, id)!.refs]) if (get(s, r.id)) syncRef(s, id, r.id);
}

export function regenerate(s: CanvasState, id: string, part: 'title' | 'body' | 'image'): CanvasNode {
  const n = get(s, id);
  if (n?.kind !== 'post' || !['title', 'body', 'image'].includes(part))
    throw Error('请选择稿件与生成项');
  checkpoint(s, n, '重新生成' + part + '前');
  if (part === 'image') {
    const old = n.image!;
    n.image = imageFor(s, n.input!, n.platform!, (old.round || 1) + 1);
    Object.assign(n.image, { photo: old.photo, source: old.source, usable: old.usable });
  } else {
    (n as unknown as Record<string, unknown>)[part] = textFor(s, n.input!, n.platform!, part);
  }
  n.revision++;
  n.finalized = null;
  return n;
}

export function finalize(s: CanvasState, id: string): void {
  const n = get(s, id);
  if (!n?.title?.trim() || !n.body?.trim()) throw Error('请补全标题和正文');
  if (!n.image!.title.trim() || !n.image!.source.trim() || !n.image!.usable)
    throw Error('请核对配图来源与使用状态');
  if (stale(s, n)) throw Error('来源已更新或删除，请先处理引用提示');
  n.finalized = { actor: s.actor, at: now(), version: n.revision, snapshot: snap(n) };
  checkpoint(s, n, '确认定稿');
}

export function duplicate(s: CanvasState, id: string): CanvasNode {
  const original = get(s, id)!;
  const n = clone(original);
  n.id = uid(type(n));
  n.name += ' · 副本';
  n.x += 50;
  n.y += 80;
  n.revision = 1;
  n.history = [];
  n.finalized = null;
  n.confirmed = null;
  n.adopted = null;
  s.nodes.push(n);
  return n;
}

export function impact(s: CanvasState, id: string): CanvasNode[] {
  return s.nodes.filter((n) => n.refs.some((r) => r.id === id));
}

export function deleteNode(s: CanvasState, id: string): void {
  if (!get(s, id)) throw Error('节点已不存在');
  s.nodes = s.nodes.filter((n) => n.id !== id);
  for (const n of s.nodes) for (const r of n.refs) if (r.id === id) r.missing = true;
  s.groups.forEach((g) => (g.nodeIds = g.nodeIds.filter((key) => key !== id)));
  s.groups = s.groups.filter((g) => g.nodeIds.length);
  s.selection = s.selection.filter((key) => key !== id);
  s.selected = s.selection[0] || s.nodes[0]?.id || '';
  log(s, '删除节点，已采用内容保留');
}

export function createGroup(s: CanvasState, ids: string[], name: string): CanvasGroup {
  if (!name.trim()) throw Error('请填写分组名称');
  const nodeIds = [...new Set(ids)].filter((id) => get(s, id));
  if (nodeIds.length < 1) throw Error('请至少选择一个节点');
  for (const g of s.groups) g.nodeIds = g.nodeIds.filter((id) => !nodeIds.includes(id));
  s.groups = s.groups.filter((g) => g.nodeIds.length);
  const g: CanvasGroup = { id: uid('group'), name: name.trim(), nodeIds, collapsed: false };
  s.groups.push(g);
  return g;
}

export function moveGroup(s: CanvasState, id: string, dx: number, dy: number): void {
  const g = s.groups.find((g) => g.id === id);
  if (!g) return;
  const nodes = g.nodeIds.map((id) => get(s, id)).filter((n): n is CanvasNode => Boolean(n));
  dx = Math.max(dx, -Math.min(...nodes.map((n) => n.x)));
  dy = Math.max(dy, -Math.min(...nodes.map((n) => n.y)));
  nodes.forEach((n) => {
    n.x += dx;
    n.y += dy;
  });
}

export function ensureVisible(s: CanvasState, id: string): void {
  for (const g of s.groups) if (g.nodeIds.includes(id)) g.collapsed = false;
}

export function materialFromPost(s: CanvasState, id: string): CanvasNode {
  const post = get(s, id)!;
  const n = createNode(s, 'image', { x: post.x + 450, y: post.y });
  n.name = post.name + ' · 配图素材';
  n.title = post.image!.title;
  n.image = clone(post.image!);
  n.poster = true;
  n.format = post.platform;
  return n;
}

export function comment(s: CanvasState, id: string, field: string, text: string): CanvasComment {
  if (!text.trim()) throw Error('请填写评论');
  const n = get(s, id);
  if (!n) throw Error('节点不存在');
  const c: CanvasComment = {
    id: uid('comment'),
    nodeId: id,
    field,
    text: text.trim(),
    actor: s.actor,
    at: now(),
    version: n.revision,
    mentions: members.filter((m) => text.includes('@' + m)),
  };
  s.comments.push(c);
  return c;
}
