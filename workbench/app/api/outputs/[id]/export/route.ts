import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/current-user';
import { getOutput } from '@/lib/outputs';
import { getTask } from '@/lib/tasks';
import { getActivity } from '@/lib/activities';
import { createZip } from '@/lib/zip';
import { audit } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

function escapeXml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeName(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|\r\n]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 60) || fallback;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

function paragraphs(body: string): string[] {
  return body.replace(/\r\n/g, '\n').split('\n');
}

function docxParagraph(text: string, options: { bold?: boolean; size?: number; color?: string; align?: string } = {}): string {
  const runProps = [
    options.bold ? '<w:b/>' : '',
    options.size ? `<w:sz w:val="${options.size}"/><w:szCs w:val="${options.size}"/>` : '',
    options.color ? `<w:color w:val="${options.color}"/>` : ''
  ].join('');
  const runPr = runProps ? `<w:rPr><w:rFonts w:ascii="微软雅黑" w:eastAsia="微软雅黑" w:hAnsi="微软雅黑"/>${runProps}</w:rPr>` : '';
  const pPr = [
    options.align ? `<w:jc w:val="${options.align}"/>` : '',
    '<w:spacing w:after="120" w:line="360" w:lineRule="auto"/>'
  ].join('');
  return `<w:p><w:pPr>${pPr}</w:pPr><w:r>${runProps ? runPr : ''}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function buildDocx(input: {
  title: string;
  body: string;
  meta: string;
}): Uint8Array {
  const lines = paragraphs(input.body);
  const content = [
    docxParagraph(input.title, { bold: true, size: 32, align: 'center' }),
    docxParagraph(input.meta, { size: 18, color: '808080' }),
    ...lines.map((line) => docxParagraph(line)),
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1247" w:bottom="1440" w:left="1247" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr>'
  ].join('');

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${content}</w:body></w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${escapeXml(input.title)}</dc:title>
<dc:creator>C公益 AI 内容工作台</dc:creator>
<dc:description>${escapeXml(input.meta)}</dc:description>
<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
</cp:coreProperties>`;

  return createZip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rels },
    { name: 'docProps/core.xml', data: core },
    { name: 'word/document.xml', data: document }
  ]);
}

function buildPrintHtml(input: {
  title: string;
  body: string;
  meta: string;
  autoPrint: boolean;
}): string {
  const body = paragraphs(input.body)
    .map((line) => (line.trim() ? `<p>${escapeHtml(line)}</p>` : '<p class="blank">&nbsp;</p>'))
    .join('\n');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(input.title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #eef1f4; font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif; }
  .sheet { width: 210mm; min-height: 297mm; margin: 18px auto; padding: 22mm 20mm; background: #fff; box-shadow: 0 6px 24px rgba(0,0,0,.12); }
  h1 { margin: 0 0 6px; font-size: 22px; line-height: 1.4; text-align: center; color: #222; }
  .meta { margin: 0 0 18px; text-align: center; font-size: 12px; color: #8a8f98; }
  article p { margin: 0 0 12px; font-size: 16px; line-height: 1.85; color: #333; white-space: pre-wrap; }
  article p.blank { margin: 0; height: 12px; }
  .note { margin-top: 26px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #8a8f98; }
  @media print {
    body { background: #fff; }
    .sheet { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; }
    @page { size: A4; margin: 22mm 20mm; }
  }
</style>
</head>
<body>
<main class="sheet">
  <h1>${escapeHtml(input.title)}</h1>
  <p class="meta">${escapeHtml(input.meta)}</p>
  <article>
${body}
  </article>
  <div class="note">隐式 AI 元数据与内容编号随文件保留：${escapeHtml(input.meta)}</div>
</main>
${input.autoPrint ? '<script>window.addEventListener("load", function () { window.print(); });</script>' : ''}
</body>
</html>`;
}

export async function GET(request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { id } = await params;
  const output = getOutput(id);
  if (!output) return NextResponse.json({ error: '内容不存在' }, { status: 404 });

  const url = new URL(request.url);
  const format = (url.searchParams.get('format') || 'docx').toLowerCase();
  const draft = url.searchParams.get('draft') === '1';
  if (!draft && output.status !== 'approved') {
    return NextResponse.json({ error: '只有审核通过的版本才能正式导出；草稿请使用“导出草稿副本”。' }, { status: 409 });
  }

  const task = getTask(output.taskId);
  const activity = getActivity(output.activityId);
  const activityTitle = activity?.title || '未命名活动';
  const title = output.title || task?.title || '未命名内容';
  const meta = [
    `活动：${activityTitle}`,
    `任务：${task?.title || output.taskId}`,
    `版本：v${output.version}${draft ? '（草稿副本）' : ''}`,
    `内容编号：${output.id}`,
    `状态：${draft ? '草稿' : '已审核通过'}`,
    `导出时间：${formatDateTime(new Date().toISOString())}`
  ].join(' · ');

  if (format === 'html') {
    const autoPrint = url.searchParams.get('print') === '1';
    const html = buildPrintHtml({ title, body: output.body, meta, autoPrint });
    audit({ id: user.uid, name: user.name }, 'output.export.html', output.id, draft ? 'draft' : 'formal');
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    });
  }

  if (format !== 'docx') {
    return NextResponse.json({ error: '不支持的导出格式' }, { status: 400 });
  }

  const zip = buildDocx({ title, body: output.body, meta });
  const buffer = new ArrayBuffer(zip.length);
  new Uint8Array(buffer).set(zip);
  const filename = `${safeName(title, '内容')}-${draft ? '草稿' : '定稿'}.docx`;
  audit({ id: user.uid, name: user.name }, 'output.export.docx', output.id, draft ? 'draft' : 'formal');

  return new NextResponse(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="cgy-output.docx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store'
    }
  });
}
