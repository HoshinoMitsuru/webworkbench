import { NextResponse } from 'next/server';
import { copyActivity } from '@/lib/activities';
import { getSessionUser } from '@/lib/current-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { id } = await params;
  const activity = copyActivity({ id: user.uid, name: user.name }, id);
  if (!activity) return NextResponse.json({ error: '活动不存在或已被删除' }, { status: 404 });
  return NextResponse.json({ activity }, { status: 201 });
}
