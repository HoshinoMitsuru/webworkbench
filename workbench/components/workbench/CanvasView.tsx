'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { CanvasNodeId, CanvasNodeView, CanvasPayload } from '@/lib/canvas-state';
import type { CanvasCommentField, CanvasCommentRecord, CanvasMember } from '@/lib/canvas-comments';
import WorkbenchHeader from './WorkbenchHeader';

interface Props {
  activityId: string;
  activityTitle: string;
  userName: string;
  liveModel: boolean;
  initial: CanvasPayload;
}

const NODE_WIDTH = 280;
const NODE_HEIGHT = 230;
/** 连线从节点标题栏中线出发，避免正文高度不同导致连线上下跳动 */
const HEAD_OFFSET = 70;
const COORD_MIN = -10000;
const COORD_MAX = 10000;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 2;
const SAVE_DELAY = 600;

const NODE_ORDER: CanvasNodeId[] = ['schedule', 'theme', 'plan', 'wechat', 'xhs'];
const NODE_LABELS: Record<CanvasNodeId, string> = {
  schedule: '排期',
  theme: '主题',
  plan: '方案',
  wechat: '公众号',
  xhs: '小红书'
};
const COMMENT_FIELDS: CanvasCommentField[] = ['title', 'body', 'general'];
const COMMENT_FIELD_LABELS: Record<CanvasCommentField, string> = {
  title: '标题',
  body: '正文',
  general: '整体'
};

const EDGES: Array<[CanvasNodeId, CanvasNodeId]> = [
  ['schedule', 'theme'],
  ['theme', 'plan'],
  ['plan', 'wechat'],
  ['plan', 'xhs']
];

type DragState =
  | { kind: 'node'; id: CanvasNodeId; startX: number; startY: number; originX: number; originY: number }
  | { kind: 'pan'; startX: number; startY: number; originX: number; originY: number };

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function clampCoord(value: number): number {
  return Math.min(COORD_MAX, Math.max(COORD_MIN, value));
}

export default function CanvasView({ activityId, activityTitle, userName, liveModel, initial }: Props) {
  const [nodes, setNodes] = useState<CanvasNodeView[]>(initial.nodes);
  const [topic, setTopic] = useState(initial.topic);
  const [zoom, setZoom] = useState(initial.zoom);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [previewId, setPreviewId] = useState<CanvasNodeId | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  const [draftTitle, setDraftTitle] = useState('');
  const [draftDirection, setDraftDirection] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editNotice, setEditNotice] = useState<string | null>(null);
  const [showPrevious, setShowPrevious] = useState(false);
  const [aiAck, setAiAck] = useState(false);

  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<CanvasCommentRecord[]>([]);
  const [members, setMembers] = useState<CanvasMember[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [commentNodeId, setCommentNodeId] = useState<CanvasNodeId>('theme');
  const [commentField, setCommentField] = useState<CanvasCommentField>('general');
  const [commentBody, setCommentBody] = useState('');
  const [commentSaving, setCommentSaving] = useState(false);

  const nodesRef = useRef<CanvasNodeView[]>(initial.nodes);
  const zoomRef = useRef(initial.zoom);
  const panRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef<DragState | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  const applyZoom = useCallback((value: number) => {
    zoomRef.current = value;
    setZoom(value);
  }, []);

  const applyPan = useCallback((value: { x: number; y: number }) => {
    panRef.current = value;
    setPan(value);
  }, []);

  const applyCanvas = useCallback((canvas: CanvasPayload) => {
    // 保留当前本地坐标，避免编辑保存的响应覆盖尚未落库的拖动位置
    const currentById = new Map(nodesRef.current.map((node) => [node.id, node]));
    const merged = canvas.nodes.map((node) => {
      const current = currentById.get(node.id);
      return current ? { ...node, x: current.x, y: current.y } : node;
    });
    nodesRef.current = merged;
    setNodes(merged);
    setTopic(canvas.topic);
    return merged;
  }, []);

  const persist = useCallback(async () => {
    setSaveState('saving');
    const payload = {
      nodes: Object.fromEntries(
        nodesRef.current.map((node) => [node.id, { x: Math.round(node.x), y: Math.round(node.y) }])
      ),
      zoom: Number(zoomRef.current.toFixed(3))
    };
    try {
      const response = await fetch(`/api/activities/${activityId}/canvas`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error || '保存失败，请稍后重试。');
      setSaveState('saved');
      setSaveError(null);
    } catch (error) {
      setSaveState('error');
      setSaveError(error instanceof Error ? error.message : '保存失败，请稍后重试。');
    }
  }, [activityId]);

  const persistRef = useRef(persist);
  useEffect(() => {
    persistRef.current = persist;
  }, [persist]);

  const queueSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void persistRef.current();
    }, SAVE_DELAY);
  }, []);

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    []
  );

  const bounds = useCallback(() => {
    const list = nodesRef.current;
    const minX = Math.min(...list.map((node) => node.x));
    const minY = Math.min(...list.map((node) => node.y));
    const maxX = Math.max(...list.map((node) => node.x)) + NODE_WIDTH;
    const maxY = Math.max(...list.map((node) => node.y)) + NODE_HEIGHT;
    return { minX, minY, maxX, maxY };
  }, []);

  const fitView = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const { minX, minY, maxX, maxY } = bounds();
    const pad = 48;
    const width = Math.max(maxX - minX, 1);
    const height = Math.max(maxY - minY, 1);
    const next = Math.min(
      1,
      Math.max(ZOOM_MIN, Math.min((rect.width - pad * 2) / width, (rect.height - pad * 2) / height))
    );
    applyZoom(Number(next.toFixed(3)));
    applyPan({
      x: pad + (rect.width - pad * 2 - width * next) / 2 - minX * next,
      y: pad + (rect.height - pad * 2 - height * next) / 2 - minY * next
    });
  }, [applyPan, applyZoom, bounds]);

  const centerView = useCallback(
    (targetZoom: number) => {
      const el = viewportRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const { minX, minY, maxX, maxY } = bounds();
      const width = maxX - minX;
      const height = maxY - minY;
      applyPan({
        x: (rect.width - width * targetZoom) / 2 - minX * targetZoom,
        y: (rect.height - height * targetZoom) / 2 - minY * targetZoom
      });
    },
    [applyPan, bounds]
  );

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (initial.derived) fitView();
      else centerView(initial.zoom);
    });
    return () => cancelAnimationFrame(frame);
  }, [centerView, fitView, initial.derived, initial.zoom]);

  const handleMove = useCallback(
    (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (drag.kind === 'node') {
        const scale = zoomRef.current || 1;
        const nextX = clampCoord(drag.originX + dx / scale);
        const nextY = clampCoord(drag.originY + dy / scale);
        setNodes((previous) => {
          const next = previous.map((node) =>
            node.id === drag.id ? { ...node, x: nextX, y: nextY } : node
          );
          nodesRef.current = next;
          return next;
        });
      } else {
        applyPan({ x: drag.originX + dx, y: drag.originY + dy });
      }
    },
    [applyPan]
  );

  const handleUp = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    document.body.classList.remove('cv-dragging');
    if (drag?.kind === 'node') queueSave();
  }, [queueSave]);

  useEffect(() => {
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [handleMove, handleUp]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const pointX = event.clientX - rect.left;
      const pointY = event.clientY - rect.top;
      const previous = zoomRef.current;
      const next = Math.min(
        ZOOM_MAX,
        Math.max(ZOOM_MIN, Number((previous * Math.exp(-event.deltaY * 0.0015)).toFixed(3)))
      );
      if (next === previous) return;
      const currentPan = panRef.current;
      applyPan({
        x: pointX - ((pointX - currentPan.x) * next) / previous,
        y: pointY - ((pointY - currentPan.y) * next) / previous
      });
      applyZoom(next);
      queueSave();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [applyPan, applyZoom, queueSave]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (previewId) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [previewId]);

  useEffect(() => {
    if (!commentsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (dialogRef.current?.open) return;
      setCommentsOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [commentsOpen]);

  const loadComments = useCallback(async () => {
    setCommentsLoading(true);
    try {
      const response = await fetch(`/api/activities/${activityId}/canvas/comments`);
      const data = (await response.json().catch(() => null)) as
        | { comments?: CanvasCommentRecord[]; members?: CanvasMember[]; error?: string }
        | null;
      if (!response.ok) throw new Error(data?.error || '评论加载失败，请稍后重试。');
      setComments(data?.comments ?? []);
      setMembers(data?.members ?? []);
      setCommentsError(null);
    } catch (error) {
      setCommentsError(error instanceof Error ? error.message : '评论加载失败，请稍后重试。');
    } finally {
      setCommentsLoading(false);
    }
  }, [activityId]);

  useEffect(() => {
    if (commentsOpen) void loadComments();
  }, [commentsOpen, loadComments]);

  function openNode(node: CanvasNodeView) {
    setPreviewId(node.id);
    setShowPrevious(false);
    setEditError(null);
    setEditNotice(null);
    setAiAck(false);
    setCommentNodeId(node.id);

    if (node.id === 'schedule') {
      setDraftTitle(node.title);
      setDraftDirection('');
      setDraftBody(node.body);
      return;
    }
    if (node.id === 'theme') {
      setDraftTitle(topic.title === '尚未设定主题' ? '' : topic.title);
      setDraftDirection(topic.direction);
      setDraftBody('');
      return;
    }
    if (node.id === 'plan') {
      setDraftTitle('');
      setDraftDirection('');
      setDraftBody(node.empty ? '' : node.body);
      return;
    }
    setDraftTitle(node.empty ? '' : node.title);
    setDraftDirection('');
    setDraftBody(node.empty ? '' : node.body);
  }

  async function postCanvas(
    path: string,
    method: 'POST' | 'PUT',
    payload: Record<string, unknown>
  ): Promise<CanvasPayload> {
    const response = await fetch(`/api/activities/${activityId}/canvas/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = (await response.json().catch(() => null)) as
      | { canvas?: CanvasPayload; error?: string }
      | null;
    if (!response.ok) throw new Error(data?.error || '保存失败，请稍后重试。');
    if (!data?.canvas) throw new Error('服务端返回数据异常，请稍后重试。');
    return data.canvas;
  }

  async function handleSaveTheme() {
    setEditSaving(true);
    setEditError(null);
    setEditNotice(null);
    try {
      const canvas = await postCanvas('topic', 'POST', {
        action: 'save',
        title: draftTitle,
        direction: draftDirection
      });
      applyCanvas(canvas);
      setEditNotice('主题已保存');
    } catch (error) {
      setEditError(error instanceof Error ? error.message : '保存失败，请稍后重试。');
    } finally {
      setEditSaving(false);
    }
  }

  async function handleConfirmTheme() {
    setEditSaving(true);
    setEditError(null);
    setEditNotice(null);
    try {
      const canvas = await postCanvas('topic', 'POST', {
        action: 'confirm',
        title: draftTitle,
        direction: draftDirection
      });
      applyCanvas(canvas);
      setDraftTitle(canvas.topic.title);
      setDraftDirection(canvas.topic.direction);
      setEditNotice('主题已确认，已记录确认人与时间');
    } catch (error) {
      setEditError(error instanceof Error ? error.message : '确认失败，请稍后重试。');
    } finally {
      setEditSaving(false);
    }
  }

  async function handleUnconfirmTheme() {
    setEditSaving(true);
    setEditError(null);
    setEditNotice(null);
    try {
      const canvas = await postCanvas('topic', 'POST', { action: 'unconfirm' });
      applyCanvas(canvas);
      setEditNotice('已解除确认，可继续修改');
    } catch (error) {
      setEditError(error instanceof Error ? error.message : '解除确认失败，请稍后重试。');
    } finally {
      setEditSaving(false);
    }
  }

  async function handleSavePlan() {
    if (!preview) return;
    setEditSaving(true);
    setEditError(null);
    setEditNotice(null);
    try {
      const canvas = await postCanvas('plan', 'PUT', { body: draftBody });
      const nextNodes = applyCanvas(canvas);
      const saved = nextNodes.find((node) => node.id === preview.id);
      setEditNotice(saved ? `已保存为第 ${saved.version} 版` : '已保存');
    } catch (error) {
      setEditError(error instanceof Error ? error.message : '保存失败，请稍后重试。');
    } finally {
      setEditSaving(false);
    }
  }

  async function handleSavePost() {
    if (!preview) return;
    setEditSaving(true);
    setEditError(null);
    setEditNotice(null);
    try {
      const canvas = await postCanvas('post', 'PUT', {
        nodeId: preview.id,
        title: draftTitle,
        body: draftBody
      });
      const nextNodes = applyCanvas(canvas);
      const saved = nextNodes.find((node) => node.id === preview.id);
      setEditNotice(saved ? `已保存为第 ${saved.version} 版，旧版本保留` : '已保存');
    } catch (error) {
      setEditError(error instanceof Error ? error.message : '保存失败，请稍后重试。');
    } finally {
      setEditSaving(false);
    }
  }

  async function handleFinalize() {
    if (!preview) return;
    setEditSaving(true);
    setEditError(null);
    setEditNotice(null);
    try {
      const canvas = await postCanvas('finalize', 'POST', { nodeId: preview.id, aiAck });
      applyCanvas(canvas);
      setAiAck(false);
      setEditNotice('已定稿，定稿人与时间已记录，原版本保留');
    } catch (error) {
      setEditError(error instanceof Error ? error.message : '定稿失败，请稍后重试。');
    } finally {
      setEditSaving(false);
    }
  }

  async function handleSubmitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!commentBody.trim()) {
      setCommentsError('请填写评论内容');
      return;
    }
    setCommentSaving(true);
    setCommentsError(null);
    try {
      const response = await fetch(`/api/activities/${activityId}/canvas/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId: commentNodeId, field: commentField, body: commentBody })
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error || '评论保存失败，请稍后重试。');
      setCommentBody('');
      await loadComments();
    } catch (error) {
      setCommentsError(error instanceof Error ? error.message : '评论保存失败，请稍后重试。');
    } finally {
      setCommentSaving(false);
    }
  }

  function insertMention(name: string) {
    setCommentBody((previous) => {
      const spacer = previous && !previous.endsWith(' ') && !previous.endsWith('\n') ? ' ' : '';
      return `${previous}${spacer}@${name} `;
    });
  }

  function beginNodeDrag(event: ReactPointerEvent<HTMLElement>, node: CanvasNodeView) {
    if (event.button !== 0) return;
    // 窄屏下节点改为静态纵向堆叠，拖动坐标没有意义，直接交给点击预览
    if (window.matchMedia('(max-width: 920px)').matches) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      kind: 'node',
      id: node.id,
      startX: event.clientX,
      startY: event.clientY,
      originX: node.x,
      originY: node.y
    };
    document.body.classList.add('cv-dragging');
  }

  function beginPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('.cv-node') || target.closest('.cv-dialog')) return;
    event.preventDefault();
    dragRef.current = {
      kind: 'pan',
      startX: event.clientX,
      startY: event.clientY,
      originX: panRef.current.x,
      originY: panRef.current.y
    };
    document.body.classList.add('cv-dragging');
  }

  function handleViewportKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 160 : 64;
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    applyPan({ x: panRef.current.x + dx, y: panRef.current.y + dy });
  }

  function zoomBy(delta: number) {
    const previous = zoomRef.current;
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number((previous + delta).toFixed(2))));
    if (next === previous) return;
    const el = viewportRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const currentPan = panRef.current;
      applyPan({
        x: centerX - ((centerX - currentPan.x) * next) / previous,
        y: centerY - ((centerY - currentPan.y) * next) / previous
      });
    }
    applyZoom(next);
    queueSave();
  }

  const geometry = useMemo(() => {
    if (!nodes.length) return null;
    const minX = Math.min(...nodes.map((node) => node.x)) - 240;
    const minY = Math.min(...nodes.map((node) => node.y)) - 240;
    const maxX = Math.max(...nodes.map((node) => node.x)) + NODE_WIDTH + 240;
    const maxY = Math.max(...nodes.map((node) => node.y)) + NODE_HEIGHT + 240;
    return { minX, minY, width: maxX - minX, height: maxY - minY };
  }, [nodes]);

  const preview = previewId ? nodes.find((node) => node.id === previewId) ?? null : null;

  const saveLabel =
    saveState === 'saving'
      ? '保存中…'
      : saveState === 'saved'
        ? '已保存'
        : saveState === 'error'
          ? '保存失败'
          : '位置自动保存';

  return (
    <div className="app-shell wb-shell cv-shell">
      <WorkbenchHeader userName={userName} liveModel={liveModel} current="activities" />

      <div className="cv-bar">
        <a className="wb-back cv-back" href={`/activity/${activityId}`}>
          ← 返回工作台
        </a>
        <div className="cv-bar-title">
          <h1>{activityTitle}</h1>
          <span className="cv-tag">画布视图 · 可编辑</span>
        </div>
        <div className="spacer" />
        <button
          className="btn btn-sm"
          type="button"
          onClick={() => setCommentsOpen((open) => !open)}
          aria-expanded={commentsOpen}
          aria-controls="cv-comments-panel"
        >
          评论
        </button>
        <span className={`cv-save-state cv-save-${saveState}`} role="status">
          {saveLabel}
        </span>
        <div className="cv-zoom-controls">
          <button className="btn btn-sm" type="button" onClick={() => zoomBy(-0.1)} aria-label="缩小">
            −
          </button>
          <span className="cv-zoom">{Math.round(zoom * 100)}%</span>
          <button className="btn btn-sm" type="button" onClick={() => zoomBy(0.1)} aria-label="放大">
            ＋
          </button>
          <button className="btn btn-sm" type="button" onClick={fitView}>
            回到全图
          </button>
        </div>
      </div>

      {saveError ? (
        <div className="cv-banner" role="alert">
          <span>{saveError} 当前画面未丢失，可继续拖动或重试。</span>
          <button className="btn btn-sm" type="button" onClick={() => void persist()}>
            重试保存
          </button>
        </div>
      ) : null}

      <div className="cv-content">
        <div
          ref={viewportRef}
          className="cv-board"
          tabIndex={0}
          role="region"
          aria-label="活动画布，可拖动节点、平移画布，Ctrl 或 Command 加滚轮缩放"
          onPointerDown={beginPan}
          onKeyDown={handleViewportKeyDown}
        >
          <p className="cv-hint">拖动标题栏移动节点 · 空白处拖动平移 · Ctrl/⌘ + 滚轮缩放 · 方向键平移</p>

          <div className="cv-world" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
            {geometry ? (
              <svg
                className="cv-edges"
                style={{
                  left: geometry.minX,
                  top: geometry.minY,
                  width: geometry.width,
                  height: geometry.height
                }}
                viewBox={`${geometry.minX} ${geometry.minY} ${geometry.width} ${geometry.height}`}
                aria-hidden="true"
              >
                <defs>
                  <marker
                    id="cv-arrow"
                    className="cv-arrow-marker"
                    viewBox="0 0 8 8"
                    refX="6"
                    refY="4"
                    markerWidth="8"
                    markerHeight="8"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 8 4 L 0 8 z" />
                  </marker>
                </defs>
                {EDGES.map(([from, to]) => {
                  const source = nodes.find((node) => node.id === from);
                  const target = nodes.find((node) => node.id === to);
                  if (!source || !target) return null;
                  const x1 = source.x + NODE_WIDTH;
                  const y1 = source.y + HEAD_OFFSET;
                  const x2 = target.x;
                  const y2 = target.y + HEAD_OFFSET;
                  return (
                    <path
                      key={`${from}-${to}`}
                      className="cv-edge"
                      d={`M ${x1} ${y1} L ${x2} ${y2}`}
                      markerEnd="url(#cv-arrow)"
                    />
                  );
                })}
              </svg>
            ) : null}

            {nodes.map((node) => (
              <article
                key={node.id}
                className={`cv-node cv-node-${node.id}${node.empty ? ' is-empty' : ''}`}
                style={{ left: node.x, top: node.y }}
                tabIndex={0}
                aria-label={`${node.label}：${node.title}`}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    openNode(node);
                  }
                }}
              >
                <header className="cv-node-head" onPointerDown={(event) => beginNodeDrag(event, node)}>
                  <span className="cv-node-type">{node.label}</span>
                  <span className={`cv-badge${node.empty ? ' is-empty' : ''}`}>{node.statusLabel}</span>
                </header>
                <div className="cv-node-body" onClick={() => openNode(node)}>
                  <h3>{node.title}</h3>
                  <p>{node.summary}</p>
                  {node.finalized ? (
                    <p className="cv-node-final">
                      定稿：{node.finalizedBy} · {node.finalizedAt}
                    </p>
                  ) : null}
                </div>
                <footer className="cv-node-foot">
                  <span className="cv-node-version">{node.version > 0 ? `v${node.version}` : '无版本'}</span>
                  <button className="cv-node-open" type="button" onClick={() => openNode(node)}>
                    {node.editable ? '打开编辑' : '查看预览'}
                  </button>
                </footer>
              </article>
            ))}
          </div>
        </div>

        {commentsOpen ? (
          <aside
            id="cv-comments-panel"
            className="cv-comments"
            aria-label="画布评论"
            role="complementary"
          >
            <header className="cv-comments-head">
              <h2>评论</h2>
              <button
                className="cv-dialog-close"
                type="button"
                onClick={() => setCommentsOpen(false)}
                aria-label="关闭评论侧栏"
              >
                ×
              </button>
            </header>

            {commentsError ? (
              <p className="cv-warn" role="alert">
                {commentsError}
              </p>
            ) : null}

            <div className="cv-comment-list">
              {commentsLoading ? <p className="cv-muted">加载中…</p> : null}
              {!commentsLoading && !comments.length ? (
                <p className="cv-muted">还没有评论。可在下方选择节点与位置，写下第一条。</p>
              ) : null}
              {comments.map((comment) => (
                <article key={comment.id} className="cv-comment">
                  <header>
                    <span className="cv-comment-node">
                      {NODE_LABELS[comment.nodeId] ?? comment.nodeId} · {COMMENT_FIELD_LABELS[comment.field]}
                    </span>
                    <span className="cv-comment-meta">
                      {comment.authorName} · {comment.createdAt}
                    </span>
                  </header>
                  <p>{comment.body}</p>
                  {comment.mentions.length ? (
                    <div className="cv-mentions">
                      {comment.mentions.map((name) => (
                        <span key={name} className="cv-mention">
                          @{name}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>

            <form className="cv-comment-form" onSubmit={handleSubmitComment}>
              <div className="cv-comment-row">
                <label className="cv-field">
                  <span>节点</span>
                  <select
                    value={commentNodeId}
                    onChange={(event) => setCommentNodeId(event.target.value as CanvasNodeId)}
                  >
                    {NODE_ORDER.map((id) => (
                      <option key={id} value={id}>
                        {NODE_LABELS[id]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="cv-field">
                  <span>位置</span>
                  <select
                    value={commentField}
                    onChange={(event) => setCommentField(event.target.value as CanvasCommentField)}
                  >
                    {COMMENT_FIELDS.map((field) => (
                      <option key={field} value={field}>
                        {COMMENT_FIELD_LABELS[field]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="cv-field">
                <span>评论内容</span>
                <textarea
                  rows={4}
                  value={commentBody}
                  maxLength={4000}
                  placeholder="写下意见，可用下方成员按钮插入 @ 提及"
                  onChange={(event) => setCommentBody(event.target.value)}
                />
              </label>
              {members.length ? (
                <div className="cv-mention-buttons" aria-label="插入成员提及">
                  {members.map((member) => (
                    <button
                      key={member.id}
                      className="btn btn-sm"
                      type="button"
                      onClick={() => insertMention(member.name)}
                    >
                      @{member.name}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="cv-muted">暂无可提及成员，成员来自本地账号列表。</p>
              )}
              <button className="btn" type="submit" disabled={commentSaving}>
                {commentSaving ? '保存中…' : '发表评论'}
              </button>
            </form>
          </aside>
        ) : null}
      </div>

      <dialog
        ref={dialogRef}
        className="cv-dialog"
        aria-labelledby="cv-dialog-title"
        onClose={() => setPreviewId(null)}
        onClick={(event) => {
          if (event.target === dialogRef.current) setPreviewId(null);
        }}
      >
        {preview ? (
          <div className="cv-dialog-inner">
            <header className="cv-dialog-head">
              <span className="cv-node-type">{preview.label}</span>
              <span className={`cv-badge${preview.empty ? ' is-empty' : ''}`}>{preview.statusLabel}</span>
              <div className="spacer" />
              <button
                className="cv-dialog-close"
                type="button"
                onClick={() => setPreviewId(null)}
                aria-label="关闭编辑面板"
              >
                ×
              </button>
            </header>
            <h2 id="cv-dialog-title">{preview.title}</h2>
            <div className="cv-dialog-meta">
              <span>版本 {preview.version > 0 ? `第 ${preview.version} 版` : '暂无'}</span>
              <span>状态 {preview.statusLabel}</span>
              {preview.finalized ? (
                <span>
                  定稿 {preview.finalizedBy} · {preview.finalizedAt}
                </span>
              ) : null}
            </div>

            {preview.details.length ? (
              <dl className="cv-dialog-details">
                {preview.details.map((detail) => (
                  <div key={detail.label}>
                    <dt>{detail.label}</dt>
                    <dd>{detail.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}

            {preview.id === 'schedule' ? (
              <>
                <p className="cv-dialog-text">{preview.body || preview.summary}</p>
                <p className="cv-muted">排期来自活动资料，不在画布中编辑。如需修改时间、地点或对象，请回工作台。</p>
              </>
            ) : null}

            {preview.id === 'theme' ? (
              <>
                <label className="cv-field">
                  <span>主题标题</span>
                  <input
                    type="text"
                    value={draftTitle}
                    maxLength={120}
                    disabled={topic.confirmed || editSaving}
                    onChange={(event) => setDraftTitle(event.target.value)}
                  />
                </label>
                <label className="cv-field">
                  <span>方向说明</span>
                  <textarea
                    rows={5}
                    value={draftDirection}
                    maxLength={2000}
                    disabled={topic.confirmed || editSaving}
                    placeholder="写下主题方向，例如希望参与者关注的问题与体验重点"
                    onChange={(event) => setDraftDirection(event.target.value)}
                  />
                </label>
                {topic.confirmed ? (
                  <p className="cv-note">
                    主题已由 {topic.confirmedByName} 于 {topic.confirmedAt} 确认。修改前请先解除确认，保存不会静默覆盖已确认内容。
                  </p>
                ) : (
                  <p className="cv-muted">确认主题会记录确认人与时间；确认后需解除确认才能继续修改。</p>
                )}
                <div className="cv-actions">
                  {topic.confirmed ? (
                    <button className="btn btn-sm" type="button" onClick={() => void handleUnconfirmTheme()} disabled={editSaving}>
                      {editSaving ? '处理中…' : '解除确认'}
                    </button>
                  ) : (
                    <>
                      <button className="btn btn-sm" type="button" onClick={() => void handleSaveTheme()} disabled={editSaving}>
                        {editSaving ? '保存中…' : '保存主题'}
                      </button>
                      <button className="btn btn-sm" type="button" onClick={() => void handleConfirmTheme()} disabled={editSaving}>
                        确认主题
                      </button>
                    </>
                  )}
                </div>
              </>
            ) : null}

            {preview.id === 'plan' ? (
              <>
                {preview.empty ? (
                  <p className="cv-empty">
                    尚未生成方案。可在下方直接撰写并保存，保存后生成第 1 版；画布的 AI 生成留待后续版本。
                  </p>
                ) : null}
                <label className="cv-field">
                  <span>方案正文</span>
                  <textarea
                    rows={10}
                    value={draftBody}
                    maxLength={40000}
                    disabled={editSaving}
                    placeholder="写下活动目标、对象、流程与传播重点"
                    onChange={(event) => setDraftBody(event.target.value)}
                  />
                </label>
                <div className="cv-actions">
                  <button className="btn btn-sm" type="button" onClick={() => void handleSavePlan()} disabled={editSaving}>
                    {editSaving ? '保存中…' : '保存为新版本'}
                  </button>
                  <span className="cv-muted">当前第 {preview.version} 版</span>
                </div>
              </>
            ) : null}

            {preview.id === 'wechat' || preview.id === 'xhs' ? (
              <>
                {preview.empty ? (
                  <p className="cv-empty">
                    {preview.id === 'wechat' ? '尚未生成公众号稿' : '尚未生成小红书稿'}
                    。可在下方直接撰写并保存，保存后生成新版本。
                  </p>
                ) : null}
                <label className="cv-field">
                  <span>标题</span>
                  <input
                    type="text"
                    value={draftTitle}
                    maxLength={160}
                    disabled={editSaving}
                    onChange={(event) => setDraftTitle(event.target.value)}
                  />
                </label>
                <label className="cv-field">
                  <span>正文</span>
                  <textarea
                    rows={10}
                    value={draftBody}
                    maxLength={40000}
                    disabled={editSaving}
                    onChange={(event) => setDraftBody(event.target.value)}
                  />
                </label>
                <div className="cv-actions">
                  <button className="btn btn-sm" type="button" onClick={() => void handleSavePost()} disabled={editSaving}>
                    {editSaving ? '保存中…' : '保存为新版本'}
                  </button>
                  <span className="cv-muted">当前第 {preview.version} 版</span>
                </div>

                {preview.finalized ? (
                  <p className="cv-note">
                    已定稿：{preview.finalizedBy} · {preview.finalizedAt}。再次保存将产生新版本，原定稿版本保留。
                  </p>
                ) : (
                  <>
                    {preview.previous?.approvedByName ? (
                      <p className="cv-note">
                        上一版已由 {preview.previous.approvedByName} 于 {preview.previous.approvedAt} 定稿。再次保存将产生新版本，原定稿版本保留。
                      </p>
                    ) : null}
                    <div className="cv-finalize">
                      <p className="cv-muted">定稿会写入审核记录，并记录定稿人与时间。</p>
                      <label className="cv-check">
                        <input
                          type="checkbox"
                          checked={aiAck}
                          onChange={(event) => setAiAck(event.target.checked)}
                          disabled={editSaving || preview.empty}
                        />
                        <span>我已核对标题与正文，并知悉内容可能含 AI 生成成分</span>
                      </label>
                      <button
                        className="btn btn-sm"
                        type="button"
                        onClick={() => void handleFinalize()}
                        disabled={!aiAck || preview.empty || editSaving}
                      >
                        {editSaving ? '定稿中…' : '定稿该版本'}
                      </button>
                    </div>
                  </>
                )}
              </>
            ) : null}

            {preview.previous ? (
              <div className="cv-previous-wrap">
                <button
                  className="cv-link"
                  type="button"
                  onClick={() => setShowPrevious((value) => !value)}
                  aria-expanded={showPrevious}
                >
                  {showPrevious ? '收起上一版' : `查看上一版（第 ${preview.previous.version} 版）`}
                </button>
                {showPrevious ? (
                  <div className="cv-previous" aria-label="上一版只读内容">
                    <h4>{preview.previous.title}</h4>
                    <p>{preview.previous.body || '上一版没有正文。'}</p>
                    <span>
                      第 {preview.previous.version} 版 · {preview.previous.statusLabel} · {preview.previous.updatedAt}（只读）
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}

            {editError ? (
              <p className="cv-warn" role="alert">
                {editError} 输入内容已保留，可修改后重试。
              </p>
            ) : null}
            {editNotice ? (
              <p className="cv-ok" role="status">
                {editNotice}
              </p>
            ) : null}

            <footer className="cv-dialog-foot">
              <span className="cv-muted">Esc 关闭 · 坐标自动保存 · 正文保存后才生成版本</span>
              <button className="btn btn-sm" type="button" onClick={() => setPreviewId(null)}>
                关闭
              </button>
            </footer>
          </div>
        ) : null}
      </dialog>
    </div>
  );
}
