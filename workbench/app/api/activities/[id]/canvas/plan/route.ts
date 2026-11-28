import { NextResponse } from 'next/server';
import { saveCanvasPlan } from '@/lib/canvas-state';
import { getSessionUser } from '@/lib/current-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as unknown;
  const result = saveCanvasPlan({ id: user.uid, name: user.name }, id, body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ canvas: result.canvas });
}
