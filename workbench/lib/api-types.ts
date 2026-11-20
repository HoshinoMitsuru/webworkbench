import type { ActivityInput, AudienceBlock, GenerateResponse } from '@/lib/types';

/** 活动库列表项，对应 GET /api/activities 的 items */
export interface ActivityMeta {
  id: string;
  title: string;
  version: number;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
  hasResults: boolean;
}

/** 活动库单条记录，对应 GET /api/activities/:id 的 activity */
export interface ActivityRecord extends ActivityMeta {
  data: ActivityInput;
  results: GenerateResponse | null;
  audience: AudienceBlock | null;
}

/** 一次保存所提交的完整快照 */
export interface DraftSnapshot {
  activity: ActivityInput;
  results: GenerateResponse | null;
  audience: AudienceBlock | null;
}

/** 页面顶部当前活动的最小元信息 */
export interface ActivityEditMeta {
  createdByName: string;
  updatedByName: string;
  updatedAt: string;
}

export type StudioTab = 'copy' | 'poster' | 'script';
export type GenerateStatus = 'idle' | 'loading' | 'done' | 'error';
export type SaveState = 'idle' | 'saving' | 'saved' | 'error';
export type RewriteTarget = import('@/lib/types').BlockKey | 'audience';
