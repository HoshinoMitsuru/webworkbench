import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, sessionFingerprint } from '@/lib/auth';
import { chatText, isLiveModel } from '@/lib/ark';
import { buildRewritePrompt } from '@/lib/prompts';
import { demoRewrite } from '@/lib/demo';
import { isPaused, trackUsage } from '@/lib/usage';

export const runtime = 'nodejs';
export const maxDuration = 120;

const ALLOWED_INSTRUCTIONS = ['重写这段内容，保持事实不变', '改得更口语、更像日常说话', '改得更正式、适合对外发布', '缩短到原文的一半左右'];

export async function POST(request: Request) {
  if (isPaused()) {
    return NextResponse.json({ error: '工作台已由管理员暂停使用，请联系内容组。' }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as
    | { text?: unknown; instruction?: unknown }
    | null;
  const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 8000) : '';
  const instruction = typeof body?.instruction === 'string' ? body.instruction.trim() : '';

  if (!text) {
    return NextResponse.json({ error: '这一块还没有内容。' }, { status: 400 });
  }
  if (!ALLOWED_INSTRUCTIONS.includes(instruction)) {
    return NextResponse.json({ error: '不支持的修改方式。' }, { status: 400 });
  }

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const fingerprint = await sessionFingerprint(token);
  const usage = trackUsage(fingerprint, text.length);
  if (usage.slowDown) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }

  let revised: string;
  let mode: 'live' | 'demo';

  if (!isLiveModel()) {
    mode = 'demo';
    revised = demoRewrite(text, instruction);
  } else {
    try {
      revised = await chatText(buildRewritePrompt(text, instruction));
      mode = 'live';
    } catch (error) {
      const message = error instanceof Error ? error.message : '修改失败，请重试';
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      action: 'rewrite',
      user: fingerprint,
      mode,
      ok: true,
      chars: text.length
    })
  );

  return NextResponse.json({ mode, text: revised.slice(0, 8000), notice: usage.notice });
}
