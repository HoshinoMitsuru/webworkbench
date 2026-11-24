import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { audit, dataDir, getDb, uploadsDir } from '@/lib/db';
import { listPendingDeletions, staleMaterialCount } from '@/lib/materials';
import type { OrphanUploadItem, ResourceStats } from '@/lib/workspace-types';

function diskUsage(): { total: number; free: number; used: number } {
  try {
    const stat = fs.statfsSync(dataDir());
    const total = Number(stat.blocks) * Number(stat.bsize);
    const free = Number(stat.bavail) * Number(stat.bsize);
    return { total, free, used: Math.max(total - free, 0) };
  } catch {
    return { total: 0, free: 0, used: 0 };
  }
}

function dirStats(dir: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = dirStats(full);
        files += nested.files;
        bytes += nested.bytes;
      } else if (entry.isFile()) {
        files += 1;
        try {
          bytes += fs.statSync(full).size;
        } catch {
          // 文件在统计过程中被移除时忽略
        }
      }
    }
  } catch {
    // 目录不可读时按空目录处理
  }
  return { files, bytes };
}

/** 扫描 uploads 与 uploads/posters 下不属于任何活动的目录，仅供人工确认清理 */
export function scanOrphanUploads(): OrphanUploadItem[] {
  const ids = new Set(
    (getDb().prepare('SELECT id FROM activities').all() as Array<{ id: string }>).map((row) => row.id)
  );
  const items: OrphanUploadItem[] = [];

  const uploads = uploadsDir();
  if (fs.existsSync(uploads)) {
    for (const entry of fs.readdirSync(uploads, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'posters' || ids.has(entry.name)) continue;
      items.push({ id: entry.name, kind: 'material', ...dirStats(path.join(uploads, entry.name)) });
    }
  }

  const posters = path.join(uploads, 'posters');
  if (fs.existsSync(posters)) {
    for (const entry of fs.readdirSync(posters, { withFileTypes: true })) {
      if (!entry.isDirectory() || ids.has(entry.name)) continue;
      items.push({ id: entry.name, kind: 'poster', ...dirStats(path.join(posters, entry.name)) });
    }
  }

  return items;
}

/**
 * 仅由用户明确确认后调用。删除前重新扫描，只清理数据库中已不存在的活动目录，
 * 避免误删仍有效的数据；系统不做任何自动删除。
 */
export function cleanOrphanUploads(
  actor: { id: string; name: string },
  ids: string[]
): { removed: number; bytes: number } {
  const orphanIds = new Set(scanOrphanUploads().map((item) => item.id));
  const targets = [...new Set(ids.filter(Boolean))].filter((id) => orphanIds.has(id));
  let removed = 0;
  let bytes = 0;

  for (const id of targets) {
    for (const dir of [path.join(uploadsDir(), id), path.join(uploadsDir(), 'posters', id)]) {
      if (!fs.existsSync(dir)) continue;
      const stats = dirStats(dir);
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        removed += 1;
        bytes += stats.bytes;
      } catch (error) {
        console.warn('[resources] 清理孤儿目录失败', dir, error instanceof Error ? error.message : error);
      }
    }
  }

  audit(actor, 'resource.clean_orphans', '', `目录 ${removed} 个，释放 ${bytes}B`);
  return { removed, bytes };
}

export function getResourceStats(): ResourceStats {
  const disk = diskUsage();
  const memoryUsage = process.memoryUsage();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();

  const storageRow = getDb()
    .prepare("SELECT COALESCE(SUM(size), 0) AS total, COUNT(*) AS count FROM materials WHERE delete_state != 'approved'")
    .get() as { total: number; count: number };

  const storageWarnBytes = Number(process.env.STORAGE_WARN_GB || 5) * 1024 * 1024 * 1024;
  const memoryWarnPercent = Number(process.env.MEMORY_WARN_PERCENT || 85);
  const stale = staleMaterialCount();
  const pendingDeletions = listPendingDeletions();
  const deletionPending = pendingDeletions.length;
  const orphanItems = scanOrphanUploads();
  const orphanBytes = orphanItems.reduce((sum, item) => sum + item.bytes, 0);

  const warnings: string[] = [];
  if (disk.total > 0 && disk.free < storageWarnBytes) {
    warnings.push(`磁盘剩余空间低于 ${(storageWarnBytes / 1024 / 1024 / 1024).toFixed(1)} GB，请人工清理，系统不会自动删除。`);
  }
  if (totalMemory > 0 && ((totalMemory - freeMemory) / totalMemory) * 100 >= memoryWarnPercent) {
    warnings.push(`服务器内存占用已达 ${memoryWarnPercent}% 阈值，请关注并人工处理，系统不会自动终止任务。`);
  }
  if (stale > 0) {
    warnings.push(`有 ${stale} 份原始素材连续 7 天未被调用，建议审查是否仍需要保留。`);
  }
  if (deletionPending > 0) {
    warnings.push(`有 ${deletionPending} 份素材等待删除审批，批准前不会删除。`);
  }
  if (orphanItems.length > 0) {
    warnings.push(`发现 ${orphanItems.length} 个已删除活动的孤儿目录，确认后可人工清理，系统不会自动删除。`);
  }

  return {
    dataDir: dataDir(),
    disk,
    memory: {
      rss: memoryUsage.rss,
      heapUsed: memoryUsage.heapUsed,
      total: totalMemory,
      free: freeMemory
    },
    storageUsed: storageRow.total,
    materialCount: storageRow.count,
    staleCount: stale,
    deletionPending,
    pendingDeletions,
    orphanCount: orphanItems.length,
    orphanBytes,
    orphanItems,
    thresholds: { storageWarnBytes, memoryWarnPercent },
    warnings
  };
}
