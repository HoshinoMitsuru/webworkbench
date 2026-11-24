import fs from 'node:fs';
import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/current-user';
import { getPosterFile } from '@/lib/posters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { id } = await params;
  const found = getPosterFile(id);
  if (!found) return NextResponse.json({ error: '文件不存在' }, { status: 404 });

  const file = fs.readFileSync(found.filePath);
  const body = new Uint8Array(file.length);
  body.set(file);

  return new NextResponse(new Blob([body], { type: 'image/png' }), {
    headers: {
      'Content-Type': 'image/png',
      'Content-Disposition': `inline; filename="poster-v${found.record.version}.png"; filename*=UTF-8''${encodeURIComponent(
        found.record.filename
      )}`,
      'Cache-Control': 'private, max-age=3600'
    }
  });
}
