import { NextResponse } from 'next/server';
import fs from 'node:fs';
import { getSessionUser } from '@/lib/current-user';
import { getActivity } from '@/lib/activities';
import { listTasks } from '@/lib/tasks';
import { listOutputs, listPublishes } from '@/lib/outputs';
import { getPosterFile, listPosters, markPostersUsed } from '@/lib/posters';
import { STAGE_MAP } from '@/lib/workflow';
import { createZip } from '@/lib/zip';
import { audit } from '@/lib/db';
import type { OutputRecord } from '@/lib/workspace-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

function formatDateTime(value?: string | null): string {
  if (!value) return '';
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

function safeName(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|\r\n]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 40) || fallback;
}

function csvCell(value: string): string {
  const text = value.replace(/"/g, '""');
  return /[",\n]/.test(text) ? `"${text}"` : text;
}

/** 每个任务取采用版本；没有采用版本时取最新通过版本 */
function pickDeliverables(outputs: OutputRecord[]): OutputRecord[] {
  const approved = outputs.filter((output) => output.status === 'approved' && output.body.trim());
  const byTask = new Map<string, OutputRecord>();
  for (const output of approved) {
    const current = byTask.get(output.taskId);
    if (!current) {
      byTask.set(output.taskId, output);
      continue;
    }
    if (output.adopted && !current.adopted) {
      byTask.set(output.taskId, output);
      continue;
    }
    if (output.adopted === current.adopted && output.version > current.version) {
      byTask.set(output.taskId, output);
    }
  }
  return Array.from(byTask.values());
}

export async function GET(_request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { id } = await params;
  const activity = getActivity(id);
  if (!activity) return NextResponse.json({ error: '活动不存在' }, { status: 404 });

  const tasks = listTasks(id);
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const publishes = listPublishes(id);
  const finalPosters = listPosters(id).filter((poster) => poster.state === 'final');
  const chosen = pickDeliverables(listOutputs(id));

  if (chosen.length === 0 && finalPosters.length === 0) {
    return NextResponse.json({ error: '暂无已通过审核的成品或定稿海报，完成审核后再打包下载。' }, { status: 404 });
  }

  const ordered = chosen.sort((a, b) => {
    const orderA = taskMap.get(a.taskId)?.orderIndex ?? Number.MAX_SAFE_INTEGER;
    const orderB = taskMap.get(b.taskId)?.orderIndex ?? Number.MAX_SAFE_INTEGER;
    return orderA - orderB || a.version - b.version;
  });

  const actor = { id: user.uid, name: user.name };
  const exportedAt = formatDateTime(new Date().toISOString());
  const activityTitle = activity.title || '未命名活动';

  const headers = [
    '序号',
    '任务',
    '阶段',
    '内容标题',
    '版本',
    '审核人',
    '审核时间',
    '定稿海报',
    '发布记录'
  ];
  const rows = ordered.map((output, index) => {
    const task = taskMap.get(output.taskId);
    const record = publishes
      .filter((item) => item.outputId === output.id)
      .map((item) => `${item.platform}${item.url ? ` ${item.url}` : ''}${item.aiDeclared ? '（已声明AI）' : '（未声明AI）'}`)
      .join('；');
    const poster = finalPosters.find((item) => item.outputId === output.id);
    return [
      String(index + 1),
      task?.title ?? '',
      task ? STAGE_MAP[task.stage]?.label || task.stage : '',
      output.title || task?.title || '',
      `v${output.version}`,
      output.approvedByName || '',
      formatDateTime(output.approvedAt),
      poster ? `v${poster.version}` : '',
      record
    ]
      .map((cell) => csvCell(String(cell)))
      .join(',');
  });
  const csv = `\ufeff${headers.map(csvCell).join(',')}\n${rows.join('\n')}\n`;

  const readme = [
    'C公益 AI 内容工作台 · 成品包',
    '',
    `活动：${activityTitle}`,
    `导出时间：${exportedAt}`,
    `导出人：${user.name}`,
    `文字成品：${ordered.length} 个（每个任务取采用版本；无采用版本时取最新通过版本）`,
    `定稿海报：${finalPosters.length} 个（位于“海报”目录）`,
    '',
    '使用说明',
    '1. 本包文字成品均已通过机构审核，可直接用于排版与发布；定稿海报为工作台画布生成的最终版本。',
    '2. 发布时请在平台完成“AI 生成内容”声明；平台无对应选项时，请在文案或备注中说明 AI 辅助生成。',
    '3. 审核通过仅免显式标识，文件隐式元数据（生成来源、时间、内容编号）始终保留。',
    '4. 废案海报源文件不会打包；如需清理，请在工作台确认后删除，系统不会自动删除。',
    '5. 发布完成后，请回到工作台“记录发布”，并勾选“已在平台完成 AI 声明”。',
    ''
  ].join('\n');

  const posterEntries: Array<{ name: string; data: Uint8Array }> = [];
  for (const poster of finalPosters) {
    const found = getPosterFile(poster.id);
    if (!found) continue;
    const task = taskMap.get(poster.taskId);
    const title = safeName(task?.title || '海报', '海报');
    posterEntries.push({
      name: `海报/${String(posterEntries.length + 1).padStart(2, '0')}-${title}-v${poster.version}.png`,
      data: new Uint8Array(fs.readFileSync(found.filePath))
    });
  }

  const entries = [
    { name: 'README.txt', data: readme },
    { name: '成品清单.csv', data: csv },
    ...ordered.map((output, index) => {
      const task = taskMap.get(output.taskId);
      const title = output.title || task?.title || '未命名成品';
      const filename = `${String(index + 1).padStart(2, '0')}-${safeName(title, '成品')}.txt`;
      return {
        name: `内容/${filename}`,
        data: `${output.title || title}\n\n${output.body}\n`
      };
    }),
    ...posterEntries
  ];

  const zip = createZip(entries);
  const zipBuffer = new ArrayBuffer(zip.length);
  new Uint8Array(zipBuffer).set(zip);
  markPostersUsed(finalPosters.map((poster) => poster.id));
  audit(actor, 'activity.export', id, `files=${ordered.length} posters=${posterEntries.length}`);

  const stamp = new Date()
    .toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
    .replace(/\//g, '');
  const zipName = `${safeName(activityTitle, '活动')}-成品包-${stamp}.zip`;

  return new NextResponse(new Blob([zipBuffer], { type: 'application/zip' }), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="cgy-deliverables.zip"; filename*=UTF-8''${encodeURIComponent(zipName)}`,
      'Cache-Control': 'no-store'
    }
  });
}
