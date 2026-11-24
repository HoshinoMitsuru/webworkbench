import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/current-user';
import { getWorkspace } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { id } = await params;
  const workspace = getWorkspace(id, { id: user.uid, name: user.name });
  if (!workspace) return NextResponse.json({ error: '活动不存在或已被删除' }, { status: 404 });
  return NextResponse.json({ workspace });
}
