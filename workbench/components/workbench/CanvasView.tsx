'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { CanvasNodeId, CanvasNodeView, CanvasPayload } from '@/lib/canvas-state';
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
  const [zoom, setZoom] = useState(initial.zoom);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [previewId, setPreviewId] = useState<CanvasNodeId | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

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
          <span className="cv-tag">画布视图 · 只读</span>
        </div>
        <div className="spacer" />
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
                  setPreviewId(node.id);
                }
              }}
            >
              <header className="cv-node-head" onPointerDown={(event) => beginNodeDrag(event, node)}>
                <span className="cv-node-type">{node.label}</span>
                <span className={`cv-badge${node.empty ? ' is-empty' : ''}`}>{node.statusLabel}</span>
              </header>
              <div className="cv-node-body" onClick={() => setPreviewId(node.id)}>
                <h3>{node.title}</h3>
                <p>{node.summary}</p>
              </div>
              <footer className="cv-node-foot">
                <span className="cv-node-version">{node.version > 0 ? `v${node.version}` : '无版本'}</span>
                <button className="cv-node-open" type="button" onClick={() => setPreviewId(node.id)}>
                  查看预览
                </button>
              </footer>
            </article>
          ))}
        </div>
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
                aria-label="关闭预览"
              >
                ×
              </button>
            </header>
            <h2 id="cv-dialog-title">{preview.title}</h2>
            <div className="cv-dialog-meta">
              <span>版本 {preview.version > 0 ? `v${preview.version}` : '暂无'}</span>
              <span>状态 {preview.statusLabel}</span>
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
            <p className="cv-dialog-text">{preview.body || preview.summary}</p>
            <footer className="cv-dialog-foot">
              <span className="cv-muted">只读预览 · 画布不提供编辑或生成</span>
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
