import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/current-user';
import { cleanOrphanUploads } from '@/lib/resources';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 仅接受用户明确确认后的清理请求；服务端会重新扫描，只删除已不存在活动的目录 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || body.action !== 'clean') {
    return NextResponse.json({ error: '不支持的操作' }, { status: 400 });
  }
  const ids = Array.isArray(body.ids) ? body.ids.filter((item): item is string => typeof item === 'string') : [];
  if (ids.length === 0) return NextResponse.json({ error: '请选择要清理的孤儿目录' }, { status: 400 });

  const result = cleanOrphanUploads({ id: user.uid, name: user.name }, ids);
  return NextResponse.json(result);
}
