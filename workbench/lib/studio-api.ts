import type { ActivityInput, AudienceBlock, FactWarning, GenerateResponse } from '@/lib/types';
import type { ActivityMeta, ActivityRecord, DraftSnapshot } from '@/lib/api-types';

/** 会话失效时抛出；调用方捕获后静默结束即可，页面已跳转到登录页 */
export class SessionExpiredError extends Error {
  constructor() {
    super('登录已过期');
    this.name = 'SessionExpiredError';
  }
}

function ensureAuthorized(response: Response): void {
  if (response.status === 401) {
    window.location.href = '/login';
    throw new SessionExpiredError();
  }
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json().catch(() => ({}))) as T;
}

export async function fetchActivities(): Promise<ActivityMeta[]> {
  const response = await fetch('/api/activities', { cache: 'no-store' });
  ensureAuthorized(response);
  const data = await readJson<{ items?: ActivityMeta[]; error?: string }>(response);
  if (!response.ok) throw new Error(data.error || '读取活动库失败');
  return Array.isArray(data.items) ? data.items : [];
}

export async function fetchActivity(id: string): Promise<ActivityRecord> {
  const response = await fetch(`/api/activities/${id}`, { cache: 'no-store' });
  ensureAuthorized(response);
  const data = await readJson<{ activity?: ActivityRecord; error?: string }>(response);
  if (!response.ok || !data.activity) throw new Error(data.error || '打开失败');
  return data.activity;
}

export type SaveOutcome =
  | { status: 'saved'; activity: ActivityRecord }
  | { status: 'conflict'; activity: ActivityRecord | null };

/** 新建或更新活动；版本不一致时返回 conflict，由页面提示用户选择处理方式 */
export async function saveActivity(input: {
  id: string | null;
  version: number;
  snapshot: DraftSnapshot;
}): Promise<SaveOutcome> {
  const { id, version, snapshot } = input;
  const response = await fetch(id ? `/api/activities/${id}` : '/api/activities', {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      id
        ? {
            version,
            data: snapshot.activity,
            results: snapshot.results,
            audience: snapshot.audience
          }
        : {
            data: snapshot.activity,
            results: snapshot.results,
            audience: snapshot.audience
          }
    )
  });
  ensureAuthorized(response);

  const data = await readJson<{ activity?: ActivityRecord; error?: string }>(response);
  if (response.status === 409) return { status: 'conflict', activity: data.activity ?? null };
  if (!response.ok || !data.activity) throw new Error(data.error || '保存失败，请重试');
  return { status: 'saved', activity: data.activity };
}

export async function deleteActivity(id: string): Promise<void> {
  const response = await fetch(`/api/activities/${id}`, { method: 'DELETE' });
  ensureAuthorized(response);
  const data = await readJson<{ error?: string }>(response);
  if (!response.ok) throw new Error(data.error || '删除失败');
}

export async function requestGeneration(
  activity: ActivityInput,
  signal: AbortSignal
): Promise<GenerateResponse> {
  const response = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activity }),
    signal
  });
  ensureAuthorized(response);
  const data = await readJson<GenerateResponse & { error?: string }>(response);
  if (!response.ok) throw new Error(data.error || '生成失败，请重试');
  return data;
}

export async function requestAudience(activity: ActivityInput): Promise<{
  audience: AudienceBlock;
  warnings?: FactWarning[];
  notice?: string;
}> {
  const response = await fetch('/api/audience', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activity })
  });
  ensureAuthorized(response);
  const data = await readJson<{
    audience?: AudienceBlock;
    warnings?: FactWarning[];
    notice?: string;
    error?: string;
  }>(response);
  if (!response.ok || !data.audience) throw new Error(data.error || '生成失败，请重试');
  return { audience: data.audience, warnings: data.warnings, notice: data.notice };
}

export async function requestRewrite(
  text: string,
  instruction: string
): Promise<{ text: string; notice?: string }> {
  const response = await fetch('/api/rewrite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, instruction })
  });
  ensureAuthorized(response);
  const data = await readJson<{ text?: string; notice?: string; error?: string }>(response);
  if (!response.ok || !data.text) throw new Error(data.error || '修改失败，请重试');
  return { text: data.text, notice: data.notice };
}

export async function fetchExample(): Promise<Partial<ActivityInput>> {
  const response = await fetch('/api/example', { cache: 'no-store' });
  ensureAuthorized(response);
  const data = await readJson<{ activity?: Partial<ActivityInput>; error?: string }>(response);
  if (!response.ok || !data.activity) throw new Error(data.error || '示例资料当前不可用');
  return data.activity;
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
}
