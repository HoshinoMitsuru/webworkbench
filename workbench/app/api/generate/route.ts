import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, sessionFingerprint } from '@/lib/auth';
import { chatJson, isLiveModel } from '@/lib/ark';
import { buildGeneratePrompt } from '@/lib/prompts';
import { demoGenerate } from '@/lib/demo';
import { sanitizeActivity, summarize } from '@/lib/sanitize';
import { checkFacts } from '@/lib/facts';
import { asSocialBlock, asTextBlock, normalizeActivityInput } from '@/lib/normalize';
import { isPaused, trackUsage } from '@/lib/usage';
import type { GenerateResponse } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: Request) {
  if (isPaused()) {
    return NextResponse.json({ error: '工作台已由管理员暂停使用，请联系内容组。' }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as { activity?: unknown } | null;
  const activity = normalizeActivityInput(body?.activity);

  if (!activity.name && !activity.notes && !activity.highlights) {
    return NextResponse.json({ error: '请先填写活动名称，或粘贴可用的活动资料。' }, { status: 400 });
  }

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const fingerprint = await sessionFingerprint(token);
  const { chars } = summarize(activity);
  const usage = trackUsage(fingerprint, chars);
  if (usage.slowDown) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }

  const { activity: sanitized, maskedCount } = sanitizeActivity(activity);
  const noticeParts: string[] = [];
  if (usage.notice) noticeParts.push(usage.notice);
  if (maskedCount > 0) {
    noticeParts.push(`已自动脱敏 ${maskedCount} 处个人信息，成稿中的〔姓名〕等占位符请人工填回。`);
  }

  const startedAt = Date.now();
  let response: GenerateResponse;

  if (!isLiveModel()) {
    response = demoGenerate(sanitized);
  } else {
    try {
      const raw = await chatJson<{ article?: unknown; note?: unknown; social?: unknown }>(
        buildGeneratePrompt(sanitized)
      );
      const article = asTextBlock(raw.article);
      const note = asTextBlock(raw.note);
      const social = asSocialBlock(raw.social);
      if (!article || !note || !social) {
        throw new Error('模型返回结构不完整，请重试');
      }
      response = { mode: 'live', article, note, social, warnings: [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : '生成失败，请重试';
      console.warn(
        JSON.stringify({
          at: new Date().toISOString(),
          action: 'generate',
          user: fingerprint,
          ok: false,
          ms: Date.now() - startedAt,
          chars,
          error: message.slice(0, 120)
        })
      );
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  const combined = [
    response.article.title,
    response.article.body,
    response.note.title,
    response.note.body,
    response.note.tags.join(' '),
    response.social.moments,
    response.social.group
  ].join('\n');

  response.warnings = checkFacts(combined, activity);
  if (noticeParts.length > 0) response.notice = noticeParts.join(' ');

  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      action: 'generate',
      user: fingerprint,
      mode: response.mode,
      ok: true,
      ms: Date.now() - startedAt,
      chars
    })
  );

  return NextResponse.json(response);
}
