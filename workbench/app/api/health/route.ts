import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const row = getDb().prepare('SELECT COUNT(*) AS count FROM activities').get() as { count: number };
    return NextResponse.json({ ok: true, db: 'ok', activities: row.count, time: new Date().toISOString() });
  } catch (error) {
    console.warn('[health] 数据库不可用', error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, db: 'error' }, { status: 503 });
  }
}
