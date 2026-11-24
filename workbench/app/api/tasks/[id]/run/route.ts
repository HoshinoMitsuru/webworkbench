import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/current-user';
import { getTaskRun } from '@/lib/outputs';
import { getTask } from '@/lib/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** 返回任务最近一次 AI 运行记录，用于生成中展示状态与取消入口 */
export async function GET(_request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { id } = await params;
  if (!getTask(id)) return NextResponse.json({ error: '任务不存在' }, { status: 404 });

  return NextResponse.json({ run: getTaskRun(id) });
}
