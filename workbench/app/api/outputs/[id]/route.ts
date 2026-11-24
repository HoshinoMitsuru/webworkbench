import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/current-user';
import { getOutput, updateOutputDraft } from '@/lib/outputs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { id } = await params;
  if (!getOutput(id)) return NextResponse.json({ error: '内容不存在' }, { status: 404 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const result = updateOutputDraft({ id: user.uid, name: user.name }, id, body ?? {});
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 });
  return NextResponse.json({ output: result.output });
}
