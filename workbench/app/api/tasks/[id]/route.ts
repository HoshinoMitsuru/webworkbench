import { NextResponse } from 'next/server';
import { deleteTask, getTask, updateTask } from '@/lib/tasks';
import { getSessionUser } from '@/lib/current-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const task = updateTask({ id: user.uid, name: user.name }, id, body ?? {});
  if (!task) return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  return NextResponse.json({ task });
}

export async function DELETE(_request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { id } = await params;
  if (!getTask(id)) return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  deleteTask({ id: user.uid, name: user.name }, id);
  return NextResponse.json({ ok: true });
}
