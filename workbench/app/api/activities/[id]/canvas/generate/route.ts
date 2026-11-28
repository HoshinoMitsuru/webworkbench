import { NextResponse } from 'next/server';
import { generateCanvasNode } from '@/lib/canvas-state';
import { getSessionUser } from '@/lib/current-user';
import { isPaused } from '@/lib/usage';

export const runtime = 'nodejs';
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  if (isPaused()) {
    return NextResponse.json({ error: '工作台已由管理员暂停使用，请联系内容组。' }, { status: 409 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as unknown;
  const result = await generateCanvasNode({ id: user.uid, name: user.name }, id, body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({
    canvas: result.canvas,
    output: result.output,
    notices: result.notices,
    mode: result.mode
  });
}
