import { NextResponse } from 'next/server';
import { createActivity, listActivities, listMyTasks, listSummaries } from '@/lib/activities';
import { getSessionUser } from '@/lib/current-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  try {
    const actor = { id: user.uid, name: user.name };
    return NextResponse.json({
      items: listActivities(),
      summaries: listSummaries(actor),
      myTasks: listMyTasks(actor)
    });
  } catch (error) {
    console.warn('[activities] 列表读取失败', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: '活动库暂时不可用' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as
    | {
        data?: unknown;
        results?: unknown;
        audience?: unknown;
        materials?: unknown;
        startStage?: unknown;
        ownerName?: unknown;
      }
    | null;

  try {
    const activity = createActivity(
      { id: user.uid, name: user.name },
      body ?? {},
      {
        materials: Array.isArray(body?.materials)
          ? body.materials.filter((item): item is string => typeof item === 'string')
          : undefined,
        startStage: typeof body?.startStage === 'string' ? body.startStage : undefined,
        ownerName: typeof body?.ownerName === 'string' ? body.ownerName : undefined
      }
    );
    return NextResponse.json({ activity }, { status: 201 });
  } catch (error) {
    console.warn('[activities] 创建失败', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: '保存失败，请重试' }, { status: 500 });
  }
}
