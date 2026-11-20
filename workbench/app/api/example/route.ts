import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/current-user';
import { loadExampleActivity } from '@/lib/example';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const activity = loadExampleActivity();
  if (!activity) {
    return NextResponse.json({ error: '当前环境未提供示例资料' }, { status: 404 });
  }

  return NextResponse.json({ activity });
}
