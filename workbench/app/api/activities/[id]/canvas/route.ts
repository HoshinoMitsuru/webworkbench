import { NextResponse } from 'next/server';
import { getCanvasState, saveCanvasState } from '@/lib/canvas-state';
import { getSessionUser } from '@/lib/current-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { id } = await params;
  const canvas = getCanvasState(id);
  if (!canvas) return NextResponse.json({ error: '活动不存在' }, { status: 404 });
  return NextResponse.json({ canvas });
}

export async function PATCH(request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as unknown;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: '请求内容格式不正确' }, { status: 400 });
  }

  const result = saveCanvasState(id, body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ canvas: result.canvas });
}
