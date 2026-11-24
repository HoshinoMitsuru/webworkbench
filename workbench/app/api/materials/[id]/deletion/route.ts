import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/current-user';
import { getMaterial, requestMaterialDeletion, resolveMaterialDeletion } from '@/lib/materials';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { id } = await params;
  const actor = { id: user.uid, name: user.name };
  const material = getMaterial(id, actor);
  if (!material) return NextResponse.json({ error: '资料不存在，或你没有访问权限。' }, { status: 404 });

  const body = (await request.json().catch(() => null)) as
    | { action?: unknown; reason?: unknown }
    | null;
  const action = body?.action;

  if (action === 'request') {
    const next = requestMaterialDeletion(actor, id, typeof body?.reason === 'string' ? body.reason : '');
    return NextResponse.json({ material: next });
  }

  if (action === 'approve' || action === 'reject') {
    resolveMaterialDeletion(actor, id, action === 'approve');
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: '未知操作' }, { status: 400 });
}
