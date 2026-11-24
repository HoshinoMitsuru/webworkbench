import fs from 'node:fs';
import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/current-user';
import { getMaterialFile } from '@/lib/materials';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { id } = await params;
  const found = getMaterialFile(id, { id: user.uid, name: user.name });
  if (!found) return NextResponse.json({ error: '文件不存在，或你没有访问权限。' }, { status: 404 });

  const buffer = fs.readFileSync(found.filePath);
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': found.material.mime || 'application/octet-stream',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(found.material.name)}`,
      'Cache-Control': 'private, max-age=60'
    }
  });
}
