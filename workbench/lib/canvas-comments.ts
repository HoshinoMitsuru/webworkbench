import { getActivity } from '@/lib/activities';
import { CANVAS_NODE_IDS, type CanvasNodeId } from '@/lib/canvas-state';
import { audit, getDb, nowIso } from '@/lib/db';
import { listUsers } from '@/lib/users';

export const CANVAS_COMMENT_FIELDS = ['title', 'body', 'general'] as const;

export type CanvasCommentField = (typeof CANVAS_COMMENT_FIELDS)[number];

export interface CanvasCommentRecord {
  id: string;
  activityId: string;
  nodeId: CanvasNodeId;
  field: CanvasCommentField;
  body: string;
  authorId: string;
  authorName: string;
  mentions: string[];
  createdAt: string;
  deletedAt: string | null;
}

export interface CanvasMember {
  id: string;
  name: string;
}

interface CommentRow {
  id: string;
  activity_id: string;
  node_id: string;
  field: string;
  body: string;
  author_id: string;
  author_name: string;
  mentions: string;
  created_at: string;
  deleted_at: string | null;
}

function parseMentions(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string').slice(0, 20)
      : [];
  } catch {
    return [];
  }
}

function toComment(row: CommentRow): CanvasCommentRecord {
  return {
    id: row.id,
    activityId: row.activity_id,
    nodeId: row.node_id as CanvasNodeId,
    field: (CANVAS_COMMENT_FIELDS.includes(row.field as CanvasCommentField)
      ? row.field
      : 'general') as CanvasCommentField,
    body: row.body,
    authorId: row.author_id,
    authorName: row.author_name,
    mentions: parseMentions(row.mentions),
    createdAt: row.created_at,
    deletedAt: row.deleted_at
  };
}

/** 读取时过滤已删除评论，历史软删除记录不会出现在画布侧栏 */
export function listCanvasComments(activityId: string): CanvasCommentRecord[] {
  const rows = getDb()
    .prepare(
      'SELECT * FROM canvas_comment WHERE activity_id = ? AND deleted_at IS NULL ORDER BY created_at DESC'
    )
    .all(activityId) as CommentRow[];
  return rows.map(toComment);
}

export function listCanvasMembers(): CanvasMember[] {
  return listUsers().map((user) => ({ id: user.id, name: user.name }));
}

export type CreateCommentResult =
  | { ok: true; comment: CanvasCommentRecord }
  | { ok: false; error: string };

export function createCanvasComment(
  actor: { id: string; name: string },
  activityId: string,
  input: unknown
): CreateCommentResult {
  if (!getActivity(activityId)) return { ok: false, error: '活动不存在' };
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: '请求内容格式不正确' };
  }

  const value = input as Record<string, unknown>;
  const nodeId = typeof value.nodeId === 'string' ? value.nodeId : '';
  if (!CANVAS_NODE_IDS.includes(nodeId as CanvasNodeId)) {
    return { ok: false, error: `不支持的节点：${nodeId || '（空）'}` };
  }

  const field = typeof value.field === 'string' ? value.field : 'general';
  if (!CANVAS_COMMENT_FIELDS.includes(field as CanvasCommentField)) {
    return { ok: false, error: '评论位置只能是标题、正文或整体' };
  }

  const body = typeof value.body === 'string' ? value.body.trim() : '';
  if (!body) return { ok: false, error: '请填写评论内容' };
  if (body.length > 4000) return { ok: false, error: '评论过长（上限 4000 字）' };

  const users = listUsers();
  const knownNames = users.map((user) => user.name);
  const provided = Array.isArray(value.mentions) ? value.mentions : [];
  const mentions: string[] = [];
  for (const item of provided) {
    if (typeof item !== 'string') continue;
    const name = item.trim();
    if (!name) continue;
    if (!knownNames.includes(name)) return { ok: false, error: `提及的成员不存在：${name}` };
    if (!mentions.includes(name)) mentions.push(name);
  }
  for (const name of knownNames) {
    if (body.includes(`@${name}`) && !mentions.includes(name)) mentions.push(name);
  }

  const id = crypto.randomUUID();
  const at = nowIso();
  getDb()
    .prepare(
      `INSERT INTO canvas_comment
        (id, activity_id, node_id, field, body, author_id, author_name, mentions, created_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    )
    .run(
      id,
      activityId,
      nodeId,
      field,
      body.slice(0, 4000),
      actor.id,
      actor.name,
      JSON.stringify(mentions.slice(0, 20)),
      at
    );

  audit(actor, 'canvas.comment', `${activityId}/${nodeId}`, body.slice(0, 120));

  return {
    ok: true,
    comment: {
      id,
      activityId,
      nodeId: nodeId as CanvasNodeId,
      field: field as CanvasCommentField,
      body: body.slice(0, 4000),
      authorId: actor.id,
      authorName: actor.name,
      mentions,
      createdAt: at,
      deletedAt: null
    }
  };
}
