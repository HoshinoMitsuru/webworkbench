import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/current-user';
import { getTask } from '@/lib/tasks';
import { createPosterAsset } from '@/lib/posters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
const MAX_BYTES = 12 * 1024 * 1024;

export async function POST(request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { id } = await params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: '任务不存在' }, { status: 404 });

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!form || !(file instanceof File)) {
    return NextResponse.json({ error: '缺少 PNG 文件' }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: '文件为空或超过 12MB' }, { status: 413 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!PNG_SIGNATURE.every((value, index) => bytes[index] === value)) {
    return NextResponse.json({ error: '仅支持 PNG 图片' }, { status: 400 });
  }

  const stateValue = form.get('state');
  const state: 'draft' | 'final' = stateValue === 'final' ? 'final' : 'draft';
  const outputValue = form.get('outputId');
  const outputId = typeof outputValue === 'string' && outputValue ? outputValue : null;

  const asset = createPosterAsset(
    { id: user.uid, name: user.name },
    { activityId: task.activityId, taskId: task.id, outputId, state, bytes }
  );

  return NextResponse.json({ asset }, { status: 201 });
}
