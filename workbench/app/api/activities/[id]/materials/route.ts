import { NextResponse } from 'next/server';
import { getActivity } from '@/lib/activities';
import { getSessionUser } from '@/lib/current-user';
import { createFileMaterial, createTextMaterial, listMaterials } from '@/lib/materials';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { id } = await params;
  if (!getActivity(id)) return NextResponse.json({ error: '活动不存在' }, { status: 404 });
  return NextResponse.json({ materials: listMaterials(id, { id: user.uid, name: user.name }) });
}

export async function POST(request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { id } = await params;
  if (!getActivity(id)) return NextResponse.json({ error: '活动不存在' }, { status: 404 });
  const actor = { id: user.uid, name: user.name };

  const contentType = request.headers.get('content-type') || '';
  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof File)) {
        return NextResponse.json({ error: '请选择要上传的文件。' }, { status: 400 });
      }
      const result = await createFileMaterial(actor, id, file, {
        category: String(form.get('category') || ''),
        visibility: String(form.get('visibility') || ''),
        note: String(form.get('note') || ''),
        consent: String(form.get('consent') || ''),
        consentNote: String(form.get('consentNote') || '')
      });
      if ('error' in result) return NextResponse.json(result, { status: 400 });
      return NextResponse.json(result, { status: 201 });
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const result = createTextMaterial(actor, id, body ?? {});
    if ('error' in result) return NextResponse.json(result, { status: 400 });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.warn('[materials] 新增失败', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: '资料保存失败，请重试。' }, { status: 500 });
  }
}
