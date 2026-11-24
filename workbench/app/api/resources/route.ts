import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/current-user';
import { getResourceStats } from '@/lib/resources';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  return NextResponse.json({ resources: getResourceStats() });
}
