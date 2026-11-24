import { NextResponse } from 'next/server';
import { createTask } from '@/lib/tasks';
import { getSessionUser } from '@/lib/current-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const task = createTask({ id: user.uid, name: user.name }, id, body ?? {});
  if (!task) return NextResponse.json({ error: '任务创建失败，请检查活动是否存在和任务名称。' }, { status: 400 });
  return NextResponse.json({ task }, { status: 201 });
}
