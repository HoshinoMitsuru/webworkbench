import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { audit, getDb, nowIso, uploadsDir } from '@/lib/db';
import { getActivity } from '@/lib/activities';
import type { DuplicateHint, MaterialRecord } from '@/lib/workspace-types';

interface MaterialRow {
  id: string;
  activity_id: string;
  name: string;
  kind: string;
  category: string;
  mime: string;
  size: number;
  storage_path: string;
  text_content: string;
  note: string;
  fingerprint: string;
  visibility: string;
  uploaded_by_id: string;
  uploaded_by_name: string;
  last_used_at: string | null;
  delete_state: string;
  delete_requested_by_id: string;
  delete_requested_by_name: string;
  delete_requested_at: string | null;
  delete_reason: string;
  parse_status: string;
  consent: string;
  consent_by: string;
  consent_at: string | null;
  consent_note: string;
  created_at: string;
  updated_at: string;
}

const STALE_DAYS = 7;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.json']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);
const ALLOWED_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.json', '.pdf', '.docx', '.jpg', '.jpeg', '.png']);
const CONSENT_TYPES = new Set(['guardian', 'no_minors']);

export interface MaterialUser {
  id: string;
  name: string;
}

function isStale(row: MaterialRow): boolean {
  const base = row.last_used_at || row.created_at;
  const age = Date.now() - new Date(base).getTime();
  return age > STALE_DAYS * 24 * 60 * 60 * 1000;
}

function toMaterial(row: MaterialRow): MaterialRecord {
  return {
    id: row.id,
    activityId: row.activity_id,
    name: row.name,
    kind: row.kind,
    category: row.category,
    mime: row.mime,
    size: row.size,
    textContent: row.text_content,
    note: row.note,
    fingerprint: row.fingerprint,
    visibility: row.visibility === 'private' ? 'private' : 'shared',
    uploadedById: row.uploaded_by_id,
    uploadedByName: row.uploaded_by_name,
    lastUsedAt: row.last_used_at,
    deleteState:
      row.delete_state === 'requested' || row.delete_state === 'approved'
        ? (row.delete_state as 'requested' | 'approved')
        : 'none',
    deleteRequestedByName: row.delete_requested_by_name,
    deleteRequestedAt: row.delete_requested_at,
    deleteReason: row.delete_reason,
    parseStatus: row.parse_status,
    consent: row.consent,
    consentBy: row.consent_by,
    consentAt: row.consent_at,
    consentNote: row.consent_note,
    isImage: IMAGE_EXTENSIONS.has(path.extname(row.name).toLowerCase()),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stale: isStale(row)
  };
}

/** 历史未授权图片（早年无强制授权门槛时上传）不得送入 AI 生成 */
export function blocksGeneration(material: MaterialRecord): boolean {
  return material.isImage && !CONSENT_TYPES.has(material.consent);
}

export function canSeeMaterial(material: MaterialRecord, user: MaterialUser): boolean {
  return material.visibility === 'shared' || material.uploadedById === user.id;
}

export function listMaterials(activityId: string, user: MaterialUser): MaterialRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM materials WHERE activity_id = ? AND delete_state != 'approved'
        AND (visibility = 'shared' OR uploaded_by_id = ?)
       ORDER BY created_at DESC`
    )
    .all(activityId, user.id) as MaterialRow[];
  return rows.map(toMaterial);
}

export function getMaterial(id: string, user: MaterialUser): MaterialRecord | null {
  const row = getDb().prepare('SELECT * FROM materials WHERE id = ?').get(id) as MaterialRow | undefined;
  if (!row || row.delete_state === 'approved') return null;
  const material = toMaterial(row);
  return canSeeMaterial(material, user) ? material : null;
}

export function getMaterialFile(id: string, user: MaterialUser): { material: MaterialRecord; filePath: string } | null {
  const material = getMaterial(id, user);
  if (!material) return null;
  const row = getDb().prepare('SELECT storage_path FROM materials WHERE id = ?').get(id) as
    | { storage_path: string }
    | undefined;
  if (!row?.storage_path) return null;
  const filePath = path.join(uploadsDir(), row.storage_path);
  return fs.existsSync(filePath) ? { material, filePath } : null;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function fingerprintText(value: string): string {
  return createHash('sha256').update(normalizeText(value)).digest('hex');
}

function shingles(value: string): Set<string> {
  const text = normalizeText(value).replace(/[^\p{L}\p{N}]/gu, '');
  const set = new Set<string>();
  for (let index = 0; index < text.length - 2; index += 1) {
    set.add(text.slice(index, index + 3));
  }
  return set;
}

export function textSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const left = shingles(a);
  const right = shingles(b);
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const shingle of left) {
    if (right.has(shingle)) intersection += 1;
  }
  return intersection / (left.size + right.size - intersection);
}

function findDuplicates(input: {
  activityId: string;
  user: MaterialUser;
  fingerprint: string;
  text: string;
  name: string;
  size: number;
}): DuplicateHint[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM materials WHERE activity_id = ? AND delete_state != 'approved'
        AND (visibility = 'shared' OR uploaded_by_id = ?)`
    )
    .all(input.activityId, input.user.id) as MaterialRow[];

  const hints: DuplicateHint[] = [];
  const normalizedName = normalizeText(path.parse(input.name).name);

  for (const row of rows) {
    if (input.fingerprint && row.fingerprint === input.fingerprint) {
      hints.push({
        id: row.id,
        name: row.name,
        uploadedByName: row.uploaded_by_name,
        createdAt: row.created_at,
        kind: 'exact',
        score: 1,
        visibility: row.visibility
      });
      continue;
    }
    if (!input.text || !row.text_content) continue;
    const score = textSimilarity(input.text, row.text_content);
    const sameName = normalizedName.length > 3 && normalizeText(path.parse(row.name).name) === normalizedName;
    if (score >= 0.62 || (sameName && Math.abs(row.size - input.size) < 4096)) {
      hints.push({
        id: row.id,
        name: row.name,
        uploadedByName: row.uploaded_by_name,
        createdAt: row.created_at,
        kind: 'similar',
        score: Number(score.toFixed(2)),
        visibility: row.visibility
      });
    }
  }

  return hints.sort((a, b) => b.score - a.score).slice(0, 5);
}

export interface UploadMeta {
  category?: string;
  visibility?: string;
  note?: string;
  /** guardian（已取得监护人书面授权）/ no_minors（确认画面不含未成年人） */
  consent?: string;
  consentNote?: string;
}

export async function createFileMaterial(
  actor: MaterialUser,
  activityId: string,
  file: File,
  meta: UploadMeta
): Promise<{ material: MaterialRecord; duplicates: DuplicateHint[] } | { error: string }> {
  if (!getActivity(activityId)) return { error: '活动不存在或已被删除' };
  const originalName = file.name || '未命名文件';
  const ext = path.extname(originalName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { error: '首期支持 DOCX、PDF、JPG、PNG、TXT、MD、CSV 文件。' };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { error: '单个文件不能超过 25 MB。' };
  }

  // 图片必须二选一授权：已取得监护人书面授权，或确认画面不含未成年人
  const isImage = IMAGE_EXTENSIONS.has(ext);
  const requestedConsent = typeof meta.consent === 'string' ? meta.consent : '';
  if (isImage && !CONSENT_TYPES.has(requestedConsent)) {
    return {
      error: '图片资料需先确认未成年人肖像授权：已取得监护人书面授权，或确认画面不含未成年人，二者必选其一。'
    };
  }
  const consent = isImage ? requestedConsent : 'none';

  const id = crypto.randomUUID();
  const at = nowIso();
  const safeExt = ext.replace(/[^a-z0-9.]/g, '');
  const relative = path.join(activityId, `${id}${safeExt}`);
  const absolute = path.join(uploadsDir(), relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });

  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(absolute, buffer);
  const fingerprint = createHash('sha256').update(buffer).digest('hex');

  let textContent = '';
  let parseStatus = '未解析';
  if (TEXT_EXTENSIONS.has(ext)) {
    textContent = buffer.toString('utf8').slice(0, 200_000);
    parseStatus = '已解析';
  } else if (ext === '.pdf' || ext === '.docx') {
    parseStatus = '待解析';
  } else {
    parseStatus = '图片，需人工说明';
  }

  const visibility = meta.visibility === 'private' ? 'private' : 'shared';
  const category = (meta.category || (ext === '.jpg' || ext === '.jpeg' || ext === '.png' ? 'photo' : 'doc')).slice(0, 12);

  const duplicates = findDuplicates({
    activityId,
    user: actor,
    fingerprint,
    text: textContent,
    name: originalName,
    size: file.size
  });

  getDb()
    .prepare(
      `INSERT INTO materials
        (id, activity_id, name, kind, category, mime, size, storage_path, text_content, note, fingerprint,
         visibility, uploaded_by_id, uploaded_by_name, last_used_at, delete_state,
         delete_requested_by_id, delete_requested_by_name, delete_requested_at, delete_reason,
         parse_status, consent, consent_by, consent_at, consent_note, created_at, updated_at)
       VALUES (?, ?, ?, 'file', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'none', '', '', NULL, '', ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      activityId,
      originalName.slice(0, 160),
      category,
      file.type || 'application/octet-stream',
      file.size,
      relative,
      textContent,
      (meta.note || '').slice(0, 300),
      fingerprint,
      visibility,
      actor.id,
      actor.name,
      parseStatus,
      consent,
      consent === 'none' ? '' : actor.name,
      consent === 'none' ? null : at,
      (meta.consentNote || '').slice(0, 300),
      at,
      at
    );

  audit(actor, 'material.upload', id, `${originalName} (${file.size}B)`);
  const material = getMaterial(id, actor);
  return material ? { material, duplicates } : { error: '文件保存失败' };
}

export function createTextMaterial(
  actor: MaterialUser,
  activityId: string,
  input: { name?: unknown; text?: unknown; kind?: unknown; visibility?: unknown; note?: unknown }
): { material: MaterialRecord; duplicates: DuplicateHint[] } | { error: string } {
  if (!getActivity(activityId)) return { error: '活动不存在或已被删除' };
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 160) : '';
  const text = typeof input.text === 'string' ? input.text.trim().slice(0, 200_000) : '';
  const kind = input.kind === 'link' ? 'link' : 'text';
  if (!name || !text) return { error: '请填写资料名称和内容。' };

  const id = crypto.randomUUID();
  const at = nowIso();
  const visibility = input.visibility === 'private' ? 'private' : 'shared';
  const fingerprint = fingerprintText(text);
  const duplicates = findDuplicates({ activityId, user: actor, fingerprint, text, name, size: text.length });

  getDb()
    .prepare(
      `INSERT INTO materials
        (id, activity_id, name, kind, category, mime, size, storage_path, text_content, note, fingerprint,
         visibility, uploaded_by_id, uploaded_by_name, last_used_at, delete_state,
         delete_requested_by_id, delete_requested_by_name, delete_requested_at, delete_reason,
         parse_status, consent, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'text/plain', ?, '', ?, ?, ?, ?, ?, ?, NULL, 'none', '', '', NULL, '', '已解析', 'none', ?, ?)`
    )
    .run(
      id,
      activityId,
      name,
      kind,
      kind === 'link' ? 'link' : 'doc',
      text.length,
      text,
      (typeof input.note === 'string' ? input.note.slice(0, 300) : ''),
      fingerprint,
      visibility,
      actor.id,
      actor.name,
      at,
      at
    );

  audit(actor, 'material.add', id, name);
  const material = getMaterial(id, actor);
  return material ? { material, duplicates } : { error: '资料保存失败' };
}

export function updateMaterial(
  actor: MaterialUser,
  id: string,
  patch: { visibility?: unknown; note?: unknown; category?: unknown }
): MaterialRecord | null {
  const material = getMaterial(id, actor);
  if (!material) return null;

  const visibility =
    patch.visibility === 'shared' || patch.visibility === 'private' ? patch.visibility : material.visibility;
  const note = typeof patch.note === 'string' ? patch.note.slice(0, 300) : material.note;
  const category = typeof patch.category === 'string' ? patch.category.slice(0, 12) : material.category;

  getDb()
    .prepare('UPDATE materials SET visibility = ?, note = ?, category = ?, updated_at = ? WHERE id = ?')
    .run(visibility, note, category, nowIso(), id);

  audit(actor, 'material.update', id, `${visibility}/${category}`);
  return getMaterial(id, actor);
}

export function requestMaterialDeletion(
  actor: MaterialUser,
  id: string,
  reason: string
): MaterialRecord | null {
  const material = getMaterial(id, actor);
  if (!material) return null;
  if (material.deleteState === 'requested') return material;

  getDb()
    .prepare(
      `UPDATE materials SET delete_state = 'requested', delete_requested_by_id = ?,
        delete_requested_by_name = ?, delete_requested_at = ?, delete_reason = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(actor.id, actor.name, nowIso(), reason.slice(0, 200), nowIso(), id);

  audit(actor, 'material.delete_request', id, reason);
  return getMaterial(id, actor);
}

export function resolveMaterialDeletion(
  actor: MaterialUser,
  id: string,
  approve: boolean
): MaterialRecord | null {
  const row = getDb().prepare('SELECT * FROM materials WHERE id = ?').get(id) as MaterialRow | undefined;
  if (!row || row.delete_state !== 'requested') return null;

  if (!approve) {
    getDb()
      .prepare(
        `UPDATE materials SET delete_state = 'none', delete_reason = '', delete_requested_at = NULL,
          delete_requested_by_id = '', delete_requested_by_name = '', updated_at = ?
         WHERE id = ?`
      )
      .run(nowIso(), id);
    audit(actor, 'material.delete_reject', id, '');
    return null;
  }

  if (row.storage_path) {
    const filePath = path.join(uploadsDir(), row.storage_path);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (error) {
      console.warn('[materials] 删除文件失败', error instanceof Error ? error.message : error);
    }
  }

  getDb()
    .prepare(
      `UPDATE materials SET delete_state = 'approved', text_content = '', storage_path = '', updated_at = ?
       WHERE id = ?`
    )
    .run(nowIso(), id);

  audit(actor, 'material.delete_approve', id, row.name);
  return null;
}

export function markMaterialsUsed(ids: string[]): void {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return;
  const statement = getDb().prepare('UPDATE materials SET last_used_at = ?, updated_at = ? WHERE id = ?');
  const at = nowIso();
  for (const id of unique) statement.run(at, at, id);
}

export function listPendingDeletions(): Array<{
  id: string;
  activityId: string;
  name: string;
  uploadedByName: string;
  requestedByName: string;
  requestedAt: string | null;
  reason: string;
}> {
  const rows = getDb()
    .prepare(
      `SELECT id, activity_id, name, uploaded_by_name, delete_requested_by_name, delete_requested_at, delete_reason
       FROM materials WHERE delete_state = 'requested' ORDER BY delete_requested_at DESC`
    )
    .all() as Array<{
    id: string;
    activity_id: string;
    name: string;
    uploaded_by_name: string;
    delete_requested_by_name: string;
    delete_requested_at: string | null;
    delete_reason: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    activityId: row.activity_id,
    name: row.name,
    uploadedByName: row.uploaded_by_name,
    requestedByName: row.delete_requested_by_name,
    requestedAt: row.delete_requested_at,
    reason: row.delete_reason
  }));
}

export function staleMaterialCount(): number {
  const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS count FROM materials
       WHERE delete_state != 'approved' AND COALESCE(last_used_at, created_at) < ?`
    )
    .get(cutoff) as { count: number };
  return row.count;
}
