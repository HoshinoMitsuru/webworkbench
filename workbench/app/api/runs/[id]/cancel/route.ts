import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/current-user';
import { audit } from '@/lib/db';
import { cancelRun } from '@/lib/outputs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** 请求取消一次进行中的生成；模型返回后会在落库前检查取消状态，不再生成新版本 */
export async function POST(_request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { id } = await params;
  const run = cancelRun(id);
  if (!run) return NextResponse.json({ error: '运行记录不存在' }, { status: 404 });

  audit({ id: user.uid, name: user.name }, 'ai.cancel', run.taskId, run.id);
  return NextResponse.json({ run });
}
