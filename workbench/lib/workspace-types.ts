import type { ActivityInput, AudienceBlock, GenerateResponse } from '@/lib/types';

export interface TaskRecord {
  id: string;
  activityId: string;
  stage: string;
  kind: string;
  title: string;
  assignee: string;
  /** 模板责任角色（项目人员 / 新媒体 / 视觉），用于未认领时展示 */
  role: string;
  status: string;
  mode: string;
  outputKind: string;
  dueDate: string;
  posX: number;
  posY: number;
  orderIndex: number;
  inputRefs: string[];
  waitReason: string;
  naReason: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface MaterialRecord {
  id: string;
  activityId: string;
  name: string;
  kind: string;
  category: string;
  mime: string;
  size: number;
  textContent: string;
  note: string;
  fingerprint: string;
  visibility: 'shared' | 'private';
  uploadedById: string;
  uploadedByName: string;
  lastUsedAt: string | null;
  deleteState: 'none' | 'requested' | 'approved';
  deleteRequestedByName: string;
  deleteRequestedAt: string | null;
  deleteReason: string;
  parseStatus: string;
  /** 图片授权类型：guardian（监护人书面授权）/ no_minors（确认无未成年人）/ none（未授权） */
  consent: string;
  /** 授权登记人 */
  consentBy: string;
  /** 授权登记时间 */
  consentAt: string | null;
  /** 授权补充说明 */
  consentNote: string;
  isImage: boolean;
  createdAt: string;
  updatedAt: string;
  /** 连续 7 天未被调用 */
  stale: boolean;
}

export interface OutputRecord {
  id: string;
  activityId: string;
  taskId: string;
  kind: string;
  title: string;
  body: string;
  tags: string[];
  status: string;
  adopted: boolean;
  version: number;
  aiMark: boolean;
  warnings: Array<{ token: string; reason: string }>;
  createdById: string;
  createdByName: string;
  approvedByName: string;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewRecord {
  id: string;
  outputId: string;
  activityId: string;
  action: string;
  comment: string;
  snapshotTitle: string;
  snapshotBody: string;
  /** 审核人是否已勾选“知悉内容含 AI” */
  aiAck: boolean;
  userId: string;
  userName: string;
  createdAt: string;
}

export interface PublishRecord {
  id: string;
  activityId: string;
  outputId: string;
  platform: string;
  url: string;
  note: string;
  /** 发布时是否已在平台完成 AI 生成内容声明 */
  aiDeclared: boolean;
  userName: string;
  createdAt: string;
}

export interface AiRunRecord {
  id: string;
  activityId: string;
  taskId: string;
  kind: string;
  status: string;
  mode: string;
  model: string;
  operatorName: string;
  ms: number;
  chars: number;
  /** 估算 token 数 */
  tokens: number;
  /** 估算费用（元） */
  cost: number;
  error: string;
  createdAt: string;
}

export interface ActivityDetail {
  id: string;
  title: string;
  data: ActivityInput;
  results: GenerateResponse | null;
  audience: AudienceBlock | null;
  version: number;
  status: string;
  ownerName: string;
  stage: string;
  workflow: string;
  archivedAt: string | null;
  createdById: string;
  createdByName: string;
  updatedById: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
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
  dueDate: string;
  updatedAt: string;
}

export interface PosterAssetRecord {
  id: string;
  activityId: string;
  taskId: string;
  outputId: string | null;
  version: number;
  filename: string;
  size: number;
  state: 'draft' | 'final';
  lastUsedAt: string;
  createdAt: string;
  /** 废案超过 24 小时，建议确认是否清理 */
  cleanupDue: boolean;
  /** 定稿超过 7 天未使用，建议确认是否仍保留 */
  stale: boolean;
}

export interface OrphanUploadItem {
  id: string;
  kind: 'material' | 'poster';
  files: number;
  bytes: number;
}

export interface ResourceStats {
  dataDir: string;
  disk: { total: number; free: number; used: number };
  memory: { rss: number; heapUsed: number; total: number; free: number };
  storageUsed: number;
  materialCount: number;
  staleCount: number;
  deletionPending: number;
  orphanCount: number;
  orphanBytes: number;
  orphanItems: OrphanUploadItem[];
  pendingDeletions: Array<{
    id: string;
    activityId: string;
    name: string;
    uploadedByName: string;
    requestedByName: string;
    requestedAt: string | null;
    reason: string;
  }>;
  thresholds: { storageWarnBytes: number; memoryWarnPercent: number };
  staleMaterials: Array<{
    id: string;
    activityId: string;
    activityTitle: string;
    name: string;
    uploadedByName: string;
    lastUsedAt: string | null;
    createdAt: string;
  }>;
  aiUsage: {
    monthRuns: number;
    monthSuccess: number;
    monthTokens: number;
    monthCost: number;
    monthlyBudget: number;
  };
  warnings: string[];
}

export interface WorkspacePayload {
  activity: ActivityDetail;
  tasks: TaskRecord[];
  materials: MaterialRecord[];
  outputs: OutputRecord[];
  reviews: ReviewRecord[];
  publishes: PublishRecord[];
  posters: PosterAssetRecord[];
  runs: AiRunRecord[];
}

export interface DuplicateHint {
  id: string;
  name: string;
  uploadedByName: string;
  createdAt: string;
  kind: 'exact' | 'similar';
  score: number;
  visibility: string;
}
