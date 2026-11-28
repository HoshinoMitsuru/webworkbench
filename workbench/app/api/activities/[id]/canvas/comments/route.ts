import { NextResponse } from 'next/server';
import { createCanvasComment, listCanvasComments, listCanvasMembers } from '@/lib/canvas-comments';
import { getActivity } from '@/lib/activities';
import { getSessionUser } from '@/lib/current-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { id } = await params;
  if (!getActivity(id)) return NextResponse.json({ error: '活动不存在' }, { status: 404 });

  return NextResponse.json({
    comments: listCanvasComments(id),
    members: listCanvasMembers()
  });
}

export async function POST(request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as unknown;
  const result = createCanvasComment({ id: user.uid, name: user.name }, id, body);
  if (!result.ok) {
    const status = result.error === '活动不存在' ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ comment: result.comment }, { status: 201 });
}
