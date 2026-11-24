import { NextResponse } from 'next/server';
import { deleteActivity, getActivity, updateActivity, updateActivityMeta } from '@/lib/activities';
import { getSessionUser } from '@/lib/current-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { id } = await params;
  const activity = getActivity(id);
  if (!activity) return NextResponse.json({ error: '活动不存在或已被删除' }, { status: 404 });
  return NextResponse.json({ activity });
}

export async function PUT(request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as
    | { version?: unknown; data?: unknown; results?: unknown; audience?: unknown }
    | null;

  const result = updateActivity({ id: user.uid, name: user.name }, id, body ?? {});
  if (result.ok) return NextResponse.json({ activity: result.activity });

  if (result.reason === 'conflict') {
    return NextResponse.json(
      {
        error: `这条活动已被 ${result.current?.updatedByName ?? '其他成员'} 更新，请先查看最新版本。`,
        conflict: true,
        activity: result.current
      },
      { status: 409 }
    );
  }

  return NextResponse.json({ error: '活动不存在或已被删除' }, { status: 404 });
}

export async function PATCH(request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as
    | { status?: unknown; ownerName?: unknown; stage?: unknown; data?: unknown }
    | null;

  const activity = updateActivityMeta({ id: user.uid, name: user.name }, id, body ?? {});
  if (!activity) return NextResponse.json({ error: '活动不存在或已被删除' }, { status: 404 });
  return NextResponse.json({ activity });
}

export async function DELETE(_request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { id } = await params;
  const removed = deleteActivity({ id: user.uid, name: user.name }, id);
  if (!removed) return NextResponse.json({ error: '活动不存在或已被删除' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
