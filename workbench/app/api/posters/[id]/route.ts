import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/current-user';
import { deletePosterAsset } from '@/lib/posters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** 仅接受用户在前端明确确认后的删除请求，系统不会自动调用 */
export async function DELETE(_request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { id } = await params;
  const removed = deletePosterAsset({ id: user.uid, name: user.name }, id);
  if (!removed) return NextResponse.json({ error: '文件不存在或已删除' }, { status: 404 });

  return NextResponse.json({ ok: true });
}
