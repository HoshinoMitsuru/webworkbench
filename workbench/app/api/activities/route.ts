import { NextResponse } from 'next/server';
import { createActivity, listActivities } from '@/lib/activities';
import { getSessionUser } from '@/lib/current-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  try {
    return NextResponse.json({ items: listActivities() });
  } catch (error) {
    console.warn('[activities] 列表读取失败', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: '活动库暂时不可用' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as
    | { data?: unknown; results?: unknown; audience?: unknown }
    | null;

  try {
    const activity = createActivity({ id: user.uid, name: user.name }, body ?? {});
    return NextResponse.json({ activity }, { status: 201 });
  } catch (error) {
    console.warn('[activities] 创建失败', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: '保存失败，请重试' }, { status: 500 });
  }
}
