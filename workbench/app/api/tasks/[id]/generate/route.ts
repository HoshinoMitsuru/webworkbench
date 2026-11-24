import { NextResponse } from 'next/server';
import { getActivity } from '@/lib/activities';
import { getSessionUser } from '@/lib/current-user';
import { blocksGeneration, listMaterials } from '@/lib/materials';
import { runTaskGeneration } from '@/lib/task-gen';
import { getTask } from '@/lib/tasks';

export const runtime = 'nodejs';
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  if (process.env.PAUSED === '1') {
    return NextResponse.json({ error: '工作台已由管理员暂停使用，请联系内容组。' }, { status: 503 });
  }

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { id } = await params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: '任务不存在' }, { status: 404 });

  const activity = getActivity(task.activityId);
  if (!activity) return NextResponse.json({ error: '活动不存在或已被删除' }, { status: 404 });

  const materials = listMaterials(activity.id, { id: user.uid, name: user.name });
  const selected = task.inputRefs.length > 0
    ? materials.filter((material) => task.inputRefs.includes(material.id))
    : materials;

  // 历史未授权图片不进入生成，避免在授权缺失时把儿童肖像送入模型
  const usable = selected.filter((material) => !blocksGeneration(material));
  const skipped = selected.length - usable.length;

  try {
    const result = await runTaskGeneration({
      actor: { id: user.uid, name: user.name },
      activity,
      task,
      materials: usable
    });
    if (skipped > 0) {
      result.notices.push(`已跳过 ${skipped} 张未授权图片，请先在资料库补齐监护人授权或确认画面不含未成年人。`);
    }
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '生成失败，请重试';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
