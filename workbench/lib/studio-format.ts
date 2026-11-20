import type { FactWarning } from '@/lib/types';

/** 统一显示为 `MM-DD HH:mm`，无法解析时返回空串 */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 事实回查命中的 token，去重后按长度倒序，避免短词先匹配 */
export function warningTokensOf(warnings: FactWarning[]): string[] {
  return Array.from(new Set(warnings.map((item) => item.token).filter(Boolean))).sort(
    (a, b) => b.length - a.length
  );
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
