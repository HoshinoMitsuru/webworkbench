import type { ActivityInput, FactWarning } from './types';

const DATE_PATTERN = /(?:\d{4}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*日|\d{4}\s*年\s*\d{1,2}\s*月|\d{1,2}:\d{2}/g;
const QUANTITY_PATTERN = /\d+(?:\.\d+)?\s*(?:人|名|位|场|天|小时|分钟|周岁|岁|元|万元|%|个|次|所|支|期|届|公里|km)/gi;

function normalize(token: string): string {
  return token.replace(/\s+/g, '');
}

export function sourceCorpus(activity: ActivityInput): string {
  return normalize(
    [
      activity.name,
      activity.date,
      activity.location,
      activity.audience,
      activity.signup,
      activity.highlights,
      activity.organizer,
      activity.notes
    ].join(' ')
  );
}

/**
 * 事实锚定：把成稿里出现的日期、时间、数量类 token 回查输入资料。
 * 资料中找不到的 token 会被列为待核对项，前端在结果区高亮提示。
 */
export function checkFacts(output: string, activity: ActivityInput): FactWarning[] {
  const corpus = sourceCorpus(activity);
  const seen = new Set<string>();
  const warnings: FactWarning[] = [];

  const scan = (pattern: RegExp, reason: string) => {
    const matches = output.match(pattern) ?? [];
    for (const raw of matches) {
      const token = normalize(raw);
      if (!token || seen.has(token)) continue;
      seen.add(token);
      if (corpus.includes(token)) continue;
      // “5 公里” 与 “5km” 视为同一事实
      const digits = token.match(/\d+(?:\.\d+)?/)?.[0];
      if (digits && corpus.includes(digits)) continue;
      warnings.push({ token: raw.trim(), reason });
    }
  };

  scan(DATE_PATTERN, '日期/时间未在资料中找到');
  scan(QUANTITY_PATTERN, '数量未在资料中找到');
  return warnings.slice(0, 12);
}
