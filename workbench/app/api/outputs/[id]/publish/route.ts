import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/current-user';
import { recordPublish } from '@/lib/outputs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const record = recordPublish({ id: user.uid, name: user.name }, id, body ?? {});
  if (!record) {
    return NextResponse.json({ error: '只有审核通过的内容才能记录发布。' }, { status: 409 });
  }
  return NextResponse.json({ record }, { status: 201 });
}
