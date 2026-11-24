import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/current-user';
import { updatePublishMetrics } from '@/lib/outputs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** 发布效果回填：阅读、点赞、报名转化等数据可后续补充 */
export async function PATCH(request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: '请求内容无效' }, { status: 400 });

  const record = updatePublishMetrics({ id: user.uid, name: user.name }, id, body);
  if (!record) return NextResponse.json({ error: '发布记录不存在' }, { status: 404 });
  return NextResponse.json({ record });
}
