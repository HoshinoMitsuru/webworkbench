import {
  EMPTY_ACTIVITY,
  type ActivityInput,
  type AudienceBlock,
  type GenerateResponse,
  type SocialBlock,
  type TextBlock
} from '@/lib/types';

const LIMITS: Array<[keyof ActivityInput, number]> = [
  ['name', 200],
  ['date', 200],
  ['location', 300],
  ['audience', 300],
  ['signup', 400],
  ['highlights', 3000],
  ['organizer', 200],
  ['notes', 4000],
  ['sensitive', 500],
  ['tone', 50],
  ['project', 50]
];

export function normalizeActivityInput(raw: unknown): ActivityInput {
  const source = (raw ?? {}) as Record<string, unknown>;
  const activity = { ...EMPTY_ACTIVITY };
  for (const [key, limit] of LIMITS) {
    const value = source[key];
    if (typeof value === 'string') {
      (activity[key] as string) = value.trim().slice(0, limit);
    }
  }
  activity.postType = source.postType === 'review' ? 'review' : 'recruit';
  return activity;
}

export function asTextBlock(raw: unknown): TextBlock | null {
  const value = raw as Partial<TextBlock> | undefined;
  if (!value || typeof value.title !== 'string' || typeof value.body !== 'string') return null;
  return {
    title: value.title.trim().slice(0, 120),
    body: value.body.trim().slice(0, 8000),
    tags: Array.isArray(value.tags)
      ? value.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 10)
      : []
  };
}

export function asSocialBlock(raw: unknown): SocialBlock | null {
  const value = raw as Partial<SocialBlock> | undefined;
  if (!value || typeof value.moments !== 'string' || typeof value.group !== 'string') return null;
  return { moments: value.moments.trim().slice(0, 600), group: value.group.trim().slice(0, 600) };
}

export function normalizeResults(raw: unknown): GenerateResponse | null {
  if (!raw) return null;
  const value = raw as Partial<GenerateResponse>;
  const article = asTextBlock(value.article);
  const note = asTextBlock(value.note);
  const social = asSocialBlock(value.social);
  if (!article || !note || !social) return null;
  return {
    mode: value.mode === 'live' ? 'live' : 'demo',
    article,
    note,
    social,
    warnings: Array.isArray(value.warnings)
      ? value.warnings
          .filter((item) => item && typeof item.token === 'string')
          .slice(0, 40)
          .map((item) => ({
            token: item.token.slice(0, 60),
            reason: typeof item.reason === 'string' ? item.reason.slice(0, 120) : ''
          }))
      : []
  };
}

export function normalizeAudience(raw: unknown): AudienceBlock | null {
  const value = raw as Partial<AudienceBlock> | undefined;
  if (!value) return null;
  const student = typeof value.student === 'string' ? value.student.trim().slice(0, 8000) : '';
  const publicVersion = typeof value.public === 'string' ? value.public.trim().slice(0, 8000) : '';
  const press = typeof value.press === 'string' ? value.press.trim().slice(0, 8000) : '';
  if (!student && !publicVersion && !press) return null;
  return { student, public: publicVersion, press };
}
