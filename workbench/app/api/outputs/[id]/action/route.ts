import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/current-user';
import {
  adoptOutput,
  approveOutput,
  getOutput,
  returnOutput,
  reviseOutput,
  submitOutput
} from '@/lib/outputs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { id } = await params;
  const output = getOutput(id);
  if (!output) return NextResponse.json({ error: '内容不存在' }, { status: 404 });

  const actor = { id: user.uid, name: user.name };
  const body = (await request.json().catch(() => null)) as
    | { action?: unknown; comment?: unknown; aiAck?: unknown }
    | null;
  const comment = typeof body?.comment === 'string' ? body.comment : '';
  const aiAck = body?.aiAck === true;

  switch (body?.action) {
    case 'adopt': {
      const next = adoptOutput(actor, id);
      return next ? NextResponse.json({ output: next }) : NextResponse.json({ error: '采用失败' }, { status: 400 });
    }
    case 'submit': {
      const result = submitOutput(actor, id, comment);
      if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 });
      return NextResponse.json({ output: result.output });
    }
    case 'approve': {
      const result = approveOutput(actor, id, comment, aiAck);
      if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 });
      return NextResponse.json({ output: result.output });
    }
    case 'return': {
      const result = returnOutput(actor, id, comment);
      if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 });
      return NextResponse.json({ output: result.output });
    }
    case 'revise': {
      const result = reviseOutput(actor, id);
      if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 });
      return NextResponse.json({ output: result.output });
    }
    default:
      return NextResponse.json({ error: '未知操作' }, { status: 400 });
  }
}
