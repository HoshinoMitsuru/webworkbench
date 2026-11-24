export type StageKey = 'planning' | 'recruit' | 'signup' | 'live' | 'organize' | 'review' | 'archive';
export type TaskMode = 'ai' | 'visual' | 'manual';
export type TaskStatus = 'todo' | 'doing' | 'waiting' | 'blocked' | 'done' | 'na';
export type ContentStatus = 'draft' | 'pending' | 'changes' | 'approved';

export interface StageDef {
  key: StageKey;
  label: string;
  group: '活动前' | '报名与现场' | '活动后';
  hint: string;
}

export const STAGES: StageDef[] = [
  { key: 'planning', label: '策划', group: '活动前', hint: '已有方案补全、活动事实确认' },
  { key: 'recruit', label: '招募推广', group: '活动前', hint: '公众号、小红书、海报、话术与受众版本' },
  { key: 'signup', label: '报名筹备', group: '报名与现场', hint: '外部表单、报名汇总、嘉宾与场地确认' },
  { key: 'live', label: '活动进行', group: '报名与现场', hint: '现场执行与记录，由负责人确认结束' },
  { key: 'organize', label: '资料整理', group: '活动后', hint: '实际数据、精选照片说明与可使用引语' },
  { key: 'review', label: '回顾传播', group: '活动后', hint: '公众号回顾初稿，交接新媒体审核制作' },
  { key: 'archive', label: '复盘归档', group: '活动后', hint: '复盘、发布记录与归档' }
];

export const STAGE_MAP: Record<string, StageDef> = Object.fromEntries(STAGES.map((stage) => [stage.key, stage]));

export interface TaskTemplate {
  key: string;
  stage: StageKey;
  kind: string;
  title: string;
  mode: TaskMode;
  outputKind?: string;
  role: string;
  hint: string;
}

export const BASE_TEMPLATES: TaskTemplate[] = [
  {
    key: 'planning_confirm',
    stage: 'planning',
    kind: 'planning',
    title: '补全并确认活动方案',
    mode: 'ai',
    outputKind: 'planning',
    role: '项目人员',
    hint: '基于已有方案补结构、互动建议与缺项，不写成已定安排'
  },
  {
    key: 'signup_summary',
    stage: 'signup',
    kind: 'signup',
    title: '报名信息汇总',
    mode: 'manual',
    role: '项目人员',
    hint: '关联外部表单或名单，记录汇总时间、来源和口径'
  },
  {
    key: 'prep_confirm',
    stage: 'signup',
    kind: 'prep',
    title: '嘉宾、场地与执行确认',
    mode: 'manual',
    role: '项目人员',
    hint: '等待外部确认时记录负责方和等待原因'
  },
  {
    key: 'live_record',
    stage: 'live',
    kind: 'live',
    title: '现场执行与记录',
    mode: 'manual',
    role: '项目人员',
    hint: '实际发生内容由负责人确认，时间到达只提示'
  },
  {
    key: 'organize_actual',
    stage: 'organize',
    kind: 'organize',
    title: '整理实际资料与精选照片',
    mode: 'manual',
    role: '项目人员',
    hint: '实际人数、照片说明、可使用引语和缺项清单'
  },
  {
    key: 'retro',
    stage: 'archive',
    kind: 'retro',
    title: '复盘记录与归档',
    mode: 'manual',
    role: '新媒体',
    hint: '记录发布数据、成品链接与可复用模板'
  }
];

export interface MaterialPreset {
  key: string;
  label: string;
  description: string;
  templates: TaskTemplate[];
}

export const MATERIAL_PRESETS: MaterialPreset[] = [
  {
    key: 'gzh_recruit',
    label: '公众号招募',
    description: '标题、正文、待核清单',
    templates: [
      {
        key: 'gzh_recruit',
        stage: 'recruit',
        kind: 'article_recruit',
        title: '公众号招募稿',
        mode: 'ai',
        outputKind: 'article',
        role: '新媒体',
        hint: '确认方案、参与条件和报名入口'
      }
    ]
  },
  {
    key: 'xhs_recruit',
    label: '小红书招募',
    description: '标题、正文、封面文案、配图建议',
    templates: [
      {
        key: 'xhs_recruit',
        stage: 'recruit',
        kind: 'note_recruit',
        title: '小红书招募笔记',
        mode: 'ai',
        outputKind: 'note',
        role: '新媒体',
        hint: '同一事实，平台表达可变，关键信息不变'
      }
    ]
  },
  {
    key: 'poster',
    label: '招募海报',
    description: '3:4 海报，1080×1440 PNG',
    templates: [
      {
        key: 'poster',
        stage: 'recruit',
        kind: 'poster',
        title: '招募海报',
        mode: 'visual',
        outputKind: 'poster',
        role: '新媒体',
        hint: '关键文字、Logo 与二维码使用可控元素'
      }
    ]
  },
  {
    key: 'cover',
    label: '小红书封面',
    description: '3:4 封面，标题与信息密度单独控制',
    templates: [
      {
        key: 'cover',
        stage: 'recruit',
        kind: 'cover',
        title: '小红书封面',
        mode: 'visual',
        outputKind: 'poster',
        role: '新媒体',
        hint: '通过模板渲染，不依赖整图生成文字'
      }
    ]
  },
  {
    key: 'social',
    label: '社群及朋友圈话术',
    description: '两版短文案，各自 ≤120 字',
    templates: [
      {
        key: 'social',
        stage: 'recruit',
        kind: 'social',
        title: '社群及朋友圈话术',
        mode: 'ai',
        outputKind: 'social',
        role: '新媒体',
        hint: '可直接复制，事实与报名入口一致'
      }
    ]
  },
  {
    key: 'audience',
    label: '学生/公众/新闻稿三版',
    description: '同一确认事实的三版改写',
    templates: [
      {
        key: 'audience',
        stage: 'recruit',
        kind: 'audience',
        title: '学生 / 公众 / 新闻稿三版',
        mode: 'ai',
        outputKind: 'audience',
        role: '新媒体',
        hint: '差异在重点、语气与结构，关键信息一致'
      }
    ]
  },
  {
    key: 'gzh_review',
    label: '公众号回顾',
    description: '基于人工整理的实际资料生成初稿',
    templates: [
      {
        key: 'gzh_review',
        stage: 'review',
        kind: 'article_review',
        title: '公众号回顾稿',
        mode: 'ai',
        outputKind: 'article',
        role: '项目人员',
        hint: '只使用实际资料，计划人数不写成实际成果'
      }
    ]
  }
];

export const DEFAULT_MATERIAL_KEYS = ['gzh_recruit', 'xhs_recruit', 'poster', 'social', 'gzh_review'];

export function templatesForMaterials(materialKeys: string[]): TaskTemplate[] {
  const selected = new Set(materialKeys.filter((key) => key));
  const optional = MATERIAL_PRESETS.filter((preset) => selected.has(preset.key)).flatMap(
    (preset) => preset.templates
  );
  return [...BASE_TEMPLATES, ...optional];
}

export interface TaskKindMeta {
  label: string;
  scene: string;
  channel: string;
  audience: string;
  output: string;
}

export const TASK_KIND_META: Record<string, TaskKindMeta> = {
  planning: {
    label: '已有方案补全',
    scene: '策划辅助',
    channel: '内部',
    audience: '项目执行人员',
    output: '策划修订稿、互动建议、缺项清单'
  },
  article_recruit: {
    label: '公众号招募',
    scene: '招募传播',
    channel: '公众号',
    audience: '目标学生',
    output: '标题、正文、待核清单'
  },
  note_recruit: {
    label: '小红书招募',
    scene: '招募传播',
    channel: '小红书',
    audience: '潜在青年参与者',
    output: '标题、正文、封面文案、配图建议'
  },
  social: {
    label: '社群及朋友圈话术',
    scene: '招募传播',
    channel: '社群 / 朋友圈',
    audience: '群成员、朋友圈读者',
    output: '两版短文案、转发语'
  },
  audience: {
    label: '受众版本',
    scene: '招募传播',
    channel: '公众号 / 媒体',
    audience: '学生、公众、媒体',
    output: '学生版、公众版、新闻稿'
  },
  poster: {
    label: '招募海报',
    scene: '视觉制作',
    channel: '线下 / 社群',
    audience: '对应平台受众',
    output: '3:4 可编辑海报'
  },
  cover: {
    label: '小红书封面',
    scene: '视觉制作',
    channel: '小红书',
    audience: '潜在青年参与者',
    output: '3:4 可编辑封面'
  },
  article_review: {
    label: '公众号回顾',
    scene: '活动回顾',
    channel: '公众号',
    audience: '关注机构的读者',
    output: '标题、正文、图片位置与说明建议'
  },
  signup: {
    label: '报名信息汇总',
    scene: '信息收集',
    channel: '外部表单',
    audience: '参与者',
    output: '报名汇总快照'
  },
  prep: {
    label: '筹备确认',
    scene: '信息收集',
    channel: '人工 / 外部工具',
    audience: '嘉宾、场地、合作方',
    output: '确认结果与待办'
  },
  live: {
    label: '现场执行',
    scene: '活动现场',
    channel: '人工',
    audience: '参与者、志愿者',
    output: '现场记录与实际变化'
  },
  organize: {
    label: '资料整理',
    scene: '活动后资料',
    channel: '人工',
    audience: '项目人员',
    output: '实际数据、精选照片说明、可使用引语'
  },
  retro: {
    label: '复盘归档',
    scene: '复盘',
    channel: '内部',
    audience: '项目与新媒体',
    output: '复盘记录、归档资产'
  }
};

export const TASK_STATUS_LABEL: Record<string, string> = {
  todo: '未开始',
  doing: '处理中',
  waiting: '等待中',
  blocked: '受阻',
  done: '已完成',
  na: '不适用'
};

export const CONTENT_STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  pending: '待审核',
  changes: '需修改',
  approved: '已确认'
};

export const ACTIVITY_STATUS_LABEL: Record<string, string> = {
  planning: '策划中',
  recruiting: '招募筹备中',
  running: '进行中',
  finished: '已结束',
  archived: '已归档',
  canceled: '已取消'
};

export function stageIndex(stage: string): number {
  const index = STAGES.findIndex((item) => item.key === stage);
  return index < 0 ? 0 : index;
}
