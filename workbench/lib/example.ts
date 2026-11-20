import fs from 'node:fs';
import path from 'node:path';
import { normalizeActivityInput } from '@/lib/normalize';
import type { ActivityInput } from '@/lib/types';

/**
 * 示例资料独立存放在工程目录之外的 examples/，不在代码里写死。
 * 文件不存在时返回 null，界面会隐藏「载入示例资料」。
 */
function candidatePaths(): string[] {
  const configured = process.env.EXAMPLE_ACTIVITY_PATH?.trim();
  const paths = [
    configured,
    path.join(process.cwd(), 'examples', 'activity.sample.json'),
    path.join(process.cwd(), '..', 'examples', 'activity.sample.json')
  ];
  return paths.filter((item): item is string => Boolean(item));
}

let cached: { key: string; value: ActivityInput | null } | null = null;

export function loadExampleActivity(): ActivityInput | null {
  for (const file of candidatePaths()) {
    try {
      if (!fs.existsSync(file)) continue;
      const stat = fs.statSync(file);
      const key = `${file}:${stat.mtimeMs}`;
      if (cached?.key === key) return cached.value;

      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
      const activity = normalizeActivityInput(raw);
      const value = activity.name ? activity : null;
      cached = { key, value };
      return value;
    } catch (error) {
      console.warn('[example] 读取示例失败', file, error instanceof Error ? error.message : error);
    }
  }
  return null;
}

export function hasExampleActivity(): boolean {
  return loadExampleActivity() !== null;
}
