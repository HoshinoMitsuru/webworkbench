import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/current-user';
import { getMaterial, updateMaterial } from '@/lib/materials';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { id } = await params;
  const actor = { id: user.uid, name: user.name };
  if (!getMaterial(id, actor)) {
    return NextResponse.json({ error: '资料不存在，或你没有访问权限。' }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const material = updateMaterial(actor, id, body ?? {});
  if (!material) return NextResponse.json({ error: '资料更新失败' }, { status: 400 });
  return NextResponse.json({ material });
}
