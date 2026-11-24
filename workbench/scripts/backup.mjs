#!/usr/bin/env node
/**
 * 备份 SQLite 数据库与 uploads 目录，输出一个 zip 包。
 * 用法：npm run backup
 * 可选环境变量：DATA_DIR（默认 ./data）、BACKUP_DIR（默认 ./backups）
 * 说明：数据库使用 better-sqlite3 的在线备份接口，服务运行中也可以执行。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, 'data');
const backupDir = process.env.BACKUP_DIR ? path.resolve(process.env.BACKUP_DIR) : path.join(root, 'backups');
const dbPath = path.join(dataDir, 'workbench.db');
const uploadsDir = path.join(dataDir, 'uploads');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const time =
    ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f);
  const day =
    (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f);
  return { time, day };
}

function createZip(entries) {
  const encoder = new TextEncoder();
  const { time, day } = dosDateTime(new Date());
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const raw = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
    const compressed = zlib.deflateRawSync(raw, { level: 6 });
    const data = compressed.length < raw.length ? compressed : raw;
    const method = compressed.length < raw.length ? 8 : 0;
    const checksum = crc32(raw);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, method, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, day, true);
    lv.setUint32(14, checksum, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, day, true);
    cv.setUint32(16, checksum, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);

    localParts.push(local, data);
    centralParts.push(central);
    offset += local.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const parts = [...localParts, ...centralParts, end];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    output.set(part, cursor);
    cursor += part.length;
  }
  return output;
}

function walk(dir, prefix, output) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const name = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      walk(full, name, output);
    } else if (entry.isFile()) {
      output.push({ name, data: new Uint8Array(fs.readFileSync(full)) });
    }
  }
}

async function main() {
  if (!fs.existsSync(dbPath)) {
    console.error(`未找到数据库：${dbPath}`);
    process.exit(1);
  }
  fs.mkdirSync(backupDir, { recursive: true });

  const stamp = new Date()
    .toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })
    .replace(/[-: ]/g, '')
    .slice(0, 14);
  const zipPath = path.join(backupDir, `cgy-backup-${stamp}.zip`);
  const tempDb = path.join(backupDir, `.workbench-${process.pid}.db`);

  console.log(`正在备份数据库：${dbPath}`);
  const db = new Database(dbPath, { readonly: true });
  try {
    await db.backup(tempDb);
  } finally {
    db.close();
  }

  const entries = [];
  entries.push({ name: 'workbench.db', data: new Uint8Array(fs.readFileSync(tempDb)) });
  const uploads = [];
  walk(uploadsDir, 'uploads', uploads);
  entries.push(...uploads);

  const manifest = {
    createdAt: new Date().toISOString(),
    dataDir,
    dbBytes: fs.statSync(tempDb).size,
    uploadFiles: uploads.length,
    uploadBytes: uploads.reduce((sum, item) => sum + item.data.length, 0),
    note: '恢复时先停止服务，将 workbench.db 放回 DATA_DIR，uploads 目录放回 DATA_DIR/uploads，再启动服务。'
  };
  entries.push({ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) });

  const zip = createZip(entries);
  fs.writeFileSync(zipPath, zip);
  fs.unlinkSync(tempDb);

  console.log(`备份完成：${zipPath}`);
  console.log(`包含：workbench.db（${(manifest.dbBytes / 1024).toFixed(1)} KB）、uploads（${uploads.length} 个文件）`);
  console.log('恢复：停止服务 → 解压覆盖到 DATA_DIR → 启动服务 → 访问 /api/health 验证。');
}

main().catch((error) => {
  console.error('备份失败：', error instanceof Error ? error.message : error);
  process.exit(1);
});
