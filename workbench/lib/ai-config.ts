import { createHash } from 'node:crypto';
import { getDb, nowIso } from '@/lib/db';
import { SYSTEM_PROMPT, TASK_SYSTEM_PROMPT } from '@/lib/prompts';
import { loadBrandVoice } from '@/lib/brand-voice';

export interface ConfigVersionRecord {
  id: string;
  version: string;
  model: string;
  promptHash: string;
  note: string;
  createdAt: string;
}

interface ConfigRow {
  id: string;
  version: string;
  model: string;
  prompt_hash: string;
  note: string;
  created_at: string;
}

function promptHash(): string {
  return createHash('sha256')
    .update(SYSTEM_PROMPT)
    .update('\n---\n')
    .update(TASK_SYSTEM_PROMPT)
    .update('\n---\n')
    .update(loadBrandVoice())
    .digest('hex');
}

/** 提示词指纹版本号；机构语气库变化也会产生新版本 */
export function currentPromptVersion(): string {
  return `p-${promptHash().slice(0, 10)}`;
}

/** 每次生成前登记当前提示词与模型组合，同一组合只保留一条 */
export function recordConfigVersion(model: string): void {
  try {
    const hash = promptHash();
    getDb()
      .prepare(
        `INSERT OR IGNORE INTO ai_config_versions (id, version, model, prompt_hash, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        crypto.randomUUID(),
        `p-${hash.slice(0, 10)}`,
        model.slice(0, 80),
        hash,
        `工作台系统提示 ${SYSTEM_PROMPT.length} 字 / 任务提示 ${TASK_SYSTEM_PROMPT.length} 字 / 语气库 ${loadBrandVoice().length} 字`,
        nowIso()
      );
  } catch (error) {
    console.warn('[ai-config] 记录版本失败', error instanceof Error ? error.message : error);
  }
}

export function listConfigVersions(limit = 20): ConfigVersionRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM ai_config_versions ORDER BY created_at DESC LIMIT ?')
    .all(limit) as ConfigRow[];
  return rows.map((row) => ({
    id: row.id,
    version: row.version,
    model: row.model,
    promptHash: row.prompt_hash,
    note: row.note,
    createdAt: row.created_at
  }));
}
