import type { ActivityInput } from './types';

const PHONE = /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/g;
const ID_CARD = /(?<!\d)\d{17}[\dXx](?!\d)/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export interface SanitizeResult {
  activity: ActivityInput;
  maskedCount: number;
}

/**
 * 进模型前做最小必要脱敏：手机号、身份证号、邮箱一律替换；
 * 用户额外填写的姓名/学校等词按顺序替换为占位符，成稿后由人工填回。
 */
export function sanitizeActivity(input: ActivityInput): SanitizeResult {
  let maskedCount = 0;

  const replaceCommon = (value: string): string =>
    value
      .replace(PHONE, () => {
        maskedCount += 1;
        return '〔联系电话〕';
      })
      .replace(ID_CARD, () => {
        maskedCount += 1;
        return '〔证件号〕';
      })
      .replace(EMAIL, () => {
        maskedCount += 1;
        return '〔邮箱〕';
      });

  const terms = input.sensitive
    .split(/[,，、;；\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);

  const maskTerms = (value: string): string => {
    let result = value;
    for (const term of terms) {
      if (!result.includes(term)) continue;
      const pattern = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      result = result.replace(pattern, () => {
        maskedCount += 1;
        return '〔姓名〕';
      });
    }
    return result;
  };

  const clean = (value: string): string => maskTerms(replaceCommon(value));

  const activity: ActivityInput = {
    ...input,
    name: clean(input.name),
    date: clean(input.date),
    location: clean(input.location),
    audience: clean(input.audience),
    signup: clean(input.signup),
    highlights: clean(input.highlights),
    organizer: clean(input.organizer),
    notes: clean(input.notes),
    sensitive: ''
  };

  return { activity, maskedCount };
}

/** 日志里只留摘要，不落正文 */
export function summarize(input: ActivityInput): { chars: number; hasNotes: boolean } {
  const chars =
    input.name.length +
    input.date.length +
    input.location.length +
    input.audience.length +
    input.signup.length +
    input.highlights.length +
    input.notes.length;
  return { chars, hasNotes: input.notes.trim().length > 0 };
}
