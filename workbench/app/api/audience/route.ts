import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, sessionFingerprint } from '@/lib/auth';
import { chatJson, isLiveModel } from '@/lib/ark';
import { buildAudiencePrompt } from '@/lib/prompts';
import { demoAudience } from '@/lib/demo';
import { sanitizeActivity } from '@/lib/sanitize';
import { checkFacts } from '@/lib/facts';
import { isPaused, trackUsage } from '@/lib/usage';
import { EMPTY_ACTIVITY, type ActivityInput, type AudienceBlock } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: Request) {
  if (isPaused()) {
    return NextResponse.json({ error: '工作台已由管理员暂停使用，请联系内容组。' }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as { activity?: unknown } | null;
  const source = (body?.activity ?? {}) as Record<string, unknown>;
  const activity = { ...EMPTY_ACTIVITY } as ActivityInput;
  for (const key of Object.keys(EMPTY_ACTIVITY) as Array<keyof ActivityInput>) {
    const value = source[key];
    if (typeof value === 'string') (activity[key] as string) = value.trim().slice(0, 4000);
  }
  activity.postType = source.postType === 'review' ? 'review' : 'recruit';

  if (!activity.name && !activity.notes && !activity.highlights) {
    return NextResponse.json({ error: '请先填写活动资料，再生成受众改写。' }, { status: 400 });
  }

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const fingerprint = await sessionFingerprint(token);
  const usage = trackUsage(fingerprint, activity.notes.length + activity.highlights.length);
  if (usage.slowDown) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }

  const { activity: sanitized } = sanitizeActivity(activity);
  let audience: AudienceBlock;
  let mode: 'live' | 'demo';

  if (!isLiveModel()) {
    mode = 'demo';
    audience = demoAudience(sanitized);
  } else {
    try {
      const raw = await chatJson<{ student?: unknown; public?: unknown; press?: unknown }>(
        buildAudiencePrompt(sanitized)
      );
      if (
        typeof raw.student !== 'string' ||
        typeof raw.public !== 'string' ||
        typeof raw.press !== 'string'
      ) {
        throw new Error('模型返回结构不完整，请重试');
      }
      mode = 'live';
      audience = {
        student: raw.student.trim().slice(0, 4000),
        public: raw.public.trim().slice(0, 4000),
        press: raw.press.trim().slice(0, 6000)
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '生成失败，请重试';
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  const combined = `${audience.student}\n${audience.public}\n${audience.press}`;
  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      action: 'audience',
      user: fingerprint,
      mode,
      ok: true
    })
  );

  return NextResponse.json({
    mode,
    audience,
    warnings: checkFacts(combined, activity),
    notice: usage.notice
  });
}
