'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PosterPanel from '@/components/PosterPanel';
import type { PosterTemplate } from '@/lib/poster';
import { withAiMetadata } from '@/lib/png';
import {
  ACTIVITY_STATUS_LABEL,
  CONTENT_STATUS_LABEL,
  STAGES,
  STAGE_MAP,
  TASK_KIND_META,
  TASK_STATUS_LABEL
} from '@/lib/workflow';
import type { WorkspacePayload, OutputRecord, TaskRecord } from '@/lib/workspace-types';
import WorkbenchHeader from './WorkbenchHeader';
import TaskDetail from './TaskDetail';
import MaterialPanel from './MaterialPanel';
import { api, formatDate, TASK_STATUS_COLOR } from './api';

interface Props {
  activityId: string;
  user: { id: string; name: string };
  liveModel: boolean;
  paused: boolean;
}

const COLUMN_WIDTH = 320;
const CARD_WIDTH = 280;

type Notice = { text: string; kind: 'info' | 'error' };

export default function ActivityWorkspace({ activityId, user, liveModel, paused }: Props) {
  const [workspace, setWorkspace] = useState<WorkspacePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('task') || '';
  });
  const [view, setView] = useState<'canvas' | 'list'>('canvas');
  const [onlyMine, setOnlyMine] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 16, y: 16 });
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [materialOpen, setMaterialOpen] = useState(false);
  const [posterTask, setPosterTask] = useState<TaskRecord | null>(null);
  const [posterTemplate, setPosterTemplate] = useState<PosterTemplate>('sky');
  const [posterAiMark, setPosterAiMark] = useState(true);
  const [busyTaskId, setBusyTaskId] = useState('');
  const [focusOutputId, setFocusOutputId] = useState<string | null>(null);
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [pulseTaskId, setPulseTaskId] = useState('');
  const [metaStatus, setMetaStatus] = useState('planning');
  const [metaOwner, setMetaOwner] = useState('');
  const [metaStage, setMetaStage] = useState('planning');

  const canvasRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
  } | null>(null);
  const panRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const notify = useCallback((text: string, kind: 'info' | 'error' = 'info') => {
    setNotice({ text, kind });
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await api<{ workspace: WorkspacePayload }>(`/api/activities/${activityId}/workspace`);
      setWorkspace(data.workspace);
      setMetaStatus(data.workspace.activity.status);
      setMetaOwner(data.workspace.activity.ownerName);
      setMetaStage(data.workspace.activity.stage);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '工作台加载失败');
    } finally {
      setLoading(false);
    }
  }, [activityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const tasks = workspace?.tasks ?? [];
  const outputs = workspace?.outputs ?? [];
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;

  useEffect(() => {
    if (tasks.length === 0) return;
    if (selectedTaskId && tasks.some((task) => task.id === selectedTaskId)) return;
    const preferred =
      tasks.find((task) => task.stage === workspace?.activity.stage && task.status !== 'done' && task.status !== 'na') ??
      tasks.find((task) => task.status !== 'done' && task.status !== 'na') ??
      tasks[0];
    setSelectedTaskId(preferred.id);
  }, [tasks, selectedTaskId, workspace?.activity.stage]);

  useEffect(() => {
    if (typeof window === 'undefined' || !selectedTaskId) return;
    const url = new URL(window.location.href);
    url.searchParams.set('task', selectedTaskId);
    window.history.replaceState(null, '', url.toString());
  }, [selectedTaskId]);

  const fitView = useCallback(() => {
    const width = canvasRef.current?.clientWidth ?? 900;
    const next = Math.max(0.45, Math.min(1, (width - 48) / (STAGES.length * COLUMN_WIDTH)));
    setZoom(Number(next.toFixed(2)));
    setPan({ x: 16, y: 12 });
  }, []);

  useEffect(() => {
    if (!loading && workspace) fitView();
    // 只在首次加载完成时适应视图，拖动任务时不重置画布
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const patchTask = useCallback(
    async (id: string, patch: Partial<TaskRecord>) => {
      setWorkspace((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          tasks: prev.tasks.map((task) => (task.id === id ? { ...task, ...patch } : task))
        };
      });
      try {
        const body: Record<string, unknown> = {};
        if (patch.status !== undefined) body.status = patch.status;
        if (patch.assignee !== undefined) body.assignee = patch.assignee;
        if (patch.dueDate !== undefined) body.dueDate = patch.dueDate;
        if (patch.note !== undefined) body.note = patch.note;
        if (patch.waitReason !== undefined) body.waitReason = patch.waitReason;
        if (patch.naReason !== undefined) body.naReason = patch.naReason;
        if (patch.posX !== undefined) body.posX = patch.posX;
        if (patch.posY !== undefined) body.posY = patch.posY;
        if (patch.inputRefs !== undefined) body.inputRefs = patch.inputRefs;
        if (patch.title !== undefined) body.title = patch.title;
        if (patch.stage !== undefined) body.stage = patch.stage;
        await api(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      } catch (err) {
        notify(err instanceof Error ? err.message : '任务保存失败', 'error');
        await load();
      }
    },
    [load, notify]
  );

  async function generate(task: TaskRecord): Promise<OutputRecord | null> {
    if (busyTaskId) return null;
    setBusyTaskId(task.id);
    setFocusOutputId(null);
    try {
      const result = await api<{
        output: OutputRecord;
        mode: string;
        notices: string[];
      }>(`/api/tasks/${task.id}/generate`, { method: 'POST' });
      if (task.status === 'todo' || task.status === 'na') {
        await api(`/api/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'doing' }) });
      }
      await load();
      setSelectedTaskId(task.id);
      setFocusOutputId(result.output.id);
      notify(
        result.notices.length > 0
          ? result.notices.join(' ')
          : result.mode === 'visual'
            ? '已创建可编辑海报版本。'
            : '初稿已生成。请核对事实与待核项后再提交审核。'
      );
      return result.output;
    } catch (err) {
      notify(err instanceof Error ? err.message : '生成失败，请重试', 'error');
      return null;
    } finally {
      setBusyTaskId('');
    }
  }

  async function savePosterVersion(task: TaskRecord, blob: Blob) {
    const output = await generate(task);
    if (!output) throw new Error('海报版本创建失败，请重试。');

    const withMeta = withAiMetadata(await blob.arrayBuffer(), {
      activityId,
      taskId: task.id,
      outputId: output.id
    });
    const form = new FormData();
    form.append('file', withMeta, 'poster-final.png');
    form.append('state', 'final');
    form.append('outputId', output.id);
    const response = await fetch(`/api/tasks/${task.id}/posters`, { method: 'POST', body: form });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error || '上传定稿海报失败，请重试。');
    }
    await load();
    setPosterTask(null);
    notify('已保存为定稿海报并上传云端，将随成品包一起导出。');
  }

  async function saveMeta(patch: { status?: string; ownerName?: string; stage?: string }) {
    try {
      const result = await api<{ activity: WorkspacePayload['activity'] }>(`/api/activities/${activityId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch)
      });
      setWorkspace((prev) => (prev ? { ...prev, activity: result.activity } : prev));
      setMetaStatus(result.activity.status);
      setMetaOwner(result.activity.ownerName);
      setMetaStage(result.activity.stage);
      notify('活动信息已更新。');
    } catch (err) {
      notify(err instanceof Error ? err.message : '更新失败', 'error');
    }
  }

  async function copyFlow() {
    try {
      const result = await api<{ activity: { id: string } }>(`/api/activities/${activityId}/copy`, {
        method: 'POST'
      });
      window.location.href = `/activity/${result.activity.id}`;
    } catch (err) {
      notify(err instanceof Error ? err.message : '复制失败', 'error');
    }
  }

  async function downloadPackage() {
    try {
      const response = await fetch(`/api/activities/${activityId}/export`);
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        notify(data.error || '打包下载失败，请稍后重试。', 'error');
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const disposition = response.headers.get('content-disposition') || '';
      const match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
      link.download = match ? decodeURIComponent(match[1]) : '成品包.zip';
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
      notify('成品包已开始下载。');
    } catch {
      notify('打包下载失败，请稍后重试。', 'error');
    }
  }

  function focusStage(stage: string) {
    const index = STAGES.findIndex((item) => item.key === stage);
    setZoom(1);
    setPan({ x: -index * COLUMN_WIDTH + 24, y: 12 });
  }

  function focusTask(task: TaskRecord) {
    setSelectedTaskId(task.id);
    setQuery('');
    setSearchOpen(false);
    setCollapsed((prev) => prev.filter((key) => key !== task.stage));
    setView('canvas');
    window.setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      setZoom(1);
      setPan({
        x: Math.round(width / 2 - (task.posX + CARD_WIDTH / 2)),
        y: Math.round(height / 2 - (task.posY + 48))
      });
      setPulseTaskId(task.id);
      window.setTimeout(() => setPulseTaskId(''), 1600);
    }, 60);
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const card = target.closest('[data-task-id]') as HTMLElement | null;
    innerRef.current?.setPointerCapture(event.pointerId);
    if (card) {
      const id = card.dataset.taskId || '';
      const task = tasks.find((item) => item.id === id);
      if (!task) return;
      event.preventDefault();
      dragRef.current = {
        id,
        startX: event.clientX,
        startY: event.clientY,
        origX: task.posX,
        origY: task.posY,
        lastX: task.posX,
        lastY: task.posY,
        moved: false
      };
      setSelectedTaskId(id);
    } else {
      panRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    }
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current) {
      const dx = (event.clientX - dragRef.current.startX) / zoom;
      const dy = (event.clientY - dragRef.current.startY) / zoom;
      if (Math.abs(dx) + Math.abs(dy) > 3) dragRef.current.moved = true;
      const posX = Math.max(0, Math.round(dragRef.current.origX + dx));
      const posY = Math.max(0, Math.round(dragRef.current.origY + dy));
      dragRef.current.lastX = posX;
      dragRef.current.lastY = posY;
      setWorkspace((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          tasks: prev.tasks.map((task) =>
            task.id === dragRef.current?.id ? { ...task, posX, posY } : task
          )
        };
      });
      return;
    }
    if (panRef.current) {
      setPan({
        x: panRef.current.panX + (event.clientX - panRef.current.x),
        y: panRef.current.panY + (event.clientY - panRef.current.y)
      });
    }
  }

  function onPointerUp() {
    if (dragRef.current?.moved) {
      void patchTask(dragRef.current.id, {
        posX: dragRef.current.lastX,
        posY: dragRef.current.lastY
      });
    }
    dragRef.current = null;
    panRef.current = null;
  }

  const materialCount = workspace?.materials.length ?? 0;
  const exportCount = useMemo(() => {
    const approved = outputs.filter((output) => output.status === 'approved' && output.body.trim());
    return new Set(approved.map((output) => output.taskId)).size;
  }, [outputs]);
  const posterCleanup = useMemo(
    () => (workspace?.posters ?? []).filter((poster) => poster.cleanupDue || poster.stale),
    [workspace]
  );
  const stageStats = useMemo(() => {
    return STAGES.map((stage) => {
      const stageTasks = tasks.filter((task) => task.stage === stage.key);
      return {
        ...stage,
        total: stageTasks.length,
        done: stageTasks.filter((task) => task.status === 'done').length,
        waiting: stageTasks.filter((task) => task.status === 'waiting' || task.status === 'blocked').length
      };
    });
  }, [tasks]);

  const searchResults = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return [];
    const matched = tasks
      .map((task) => {
        const title = task.title.toLowerCase();
        const kind = (TASK_KIND_META[task.kind]?.label || task.kind).toLowerCase();
        const stage = (STAGE_MAP[task.stage]?.label || task.stage).toLowerCase();
        const status = (TASK_STATUS_LABEL[task.status] || task.status).toLowerCase();
        const assignee = (task.assignee || '').toLowerCase();
        if (![title, kind, stage, status, assignee].some((field) => field.includes(keyword))) return null;
        const score = title.startsWith(keyword) ? 0 : title.includes(keyword) ? 1 : assignee.includes(keyword) ? 2 : 3;
        return { task, score };
      })
      .filter((item): item is { task: TaskRecord; score: number } => item !== null)
      .sort((a, b) => a.score - b.score);
    return matched.slice(0, 8).map((item) => item.task);
  }, [tasks, query]);

  if (loading) {
    return (
      <div className="app-shell wb-shell">
        <WorkbenchHeader userName={user.name} liveModel={liveModel} current="activities" />
        <div className="wb-empty page">正在打开工作台…</div>
      </div>
    );
  }

  if (error || !workspace) {
    return (
      <div className="app-shell wb-shell">
        <WorkbenchHeader userName={user.name} liveModel={liveModel} current="activities" />
        <div className="wb-empty page">
          <p>{error || '活动不存在或已被删除。'}</p>
          <a className="btn" href="/activities">
            返回活动列表
          </a>
        </div>
      </div>
    );
  }

  const { activity } = workspace;

  return (
    <div className="app-shell wb-shell wb-workspace-shell">
      <WorkbenchHeader userName={user.name} liveModel={liveModel} current="activities" />

      <div className="wb-ws-bar">
        <a className="wb-back" href="/activities">
          ← 活动列表
        </a>
        <div className="wb-ws-title">
          <h1>{activity.title}</h1>
          <span className={`wb-status wb-status-${activity.status}`}>
            {ACTIVITY_STATUS_LABEL[activity.status] || activity.status}
          </span>
          <span className="wb-muted">更新 {formatDate(activity.updatedAt)}</span>
        </div>
        <div className="spacer" />
        <div className="wb-ws-meta">
          <label>
            <span>状态</span>
            <select
              value={metaStatus}
              onChange={(event) => {
                setMetaStatus(event.target.value);
                void saveMeta({ status: event.target.value });
              }}
            >
              {Object.entries(ACTIVITY_STATUS_LABEL).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>负责人</span>
            <input
              value={metaOwner}
              onChange={(event) => setMetaOwner(event.target.value)}
              onBlur={() => {
                if (metaOwner.trim() && metaOwner.trim() !== activity.ownerName) {
                  void saveMeta({ ownerName: metaOwner.trim() });
                }
              }}
            />
          </label>
          <label>
            <span>当前阶段</span>
            <select
              value={metaStage}
              onChange={(event) => {
                setMetaStage(event.target.value);
                void saveMeta({ stage: event.target.value });
              }}
            >
              {STAGES.map((stage) => (
                <option key={stage.key} value={stage.key}>
                  {stage.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="wb-ws-actions">
          <button className="btn btn-sm" type="button" onClick={() => setMaterialOpen(true)}>
            资料库 {materialCount > 0 ? `(${materialCount})` : ''}
          </button>
          <button className="btn btn-sm" type="button" onClick={copyFlow} title="复制本场流程结构，清空日期、报名与个人数据">
            复制流程
          </button>
          <button
            className="btn btn-sm"
            type="button"
            onClick={() => void downloadPackage()}
            disabled={exportCount === 0}
            title={exportCount === 0 ? '暂无已通过审核的成品' : '打包下载已通过审核的文字成品，含清单与 AI 声明说明'}
          >
            打包下载成品{exportCount > 0 ? ` (${exportCount})` : ''}
          </button>
          <a className="btn btn-sm" href="/studio">
            完整编辑
          </a>
          <a className="btn btn-sm" href="/resources">
            资源
          </a>
        </div>
      </div>

      {notice ? (
        <div className={`wb-toast ${notice.kind}`}>
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="关闭">
            ×
          </button>
        </div>
      ) : null}

      {paused ? <div className="wb-banner danger">工作台已被暂停，生成与修改已停用。</div> : null}

      {posterCleanup.length > 0 ? (
        <div className="wb-banner wb-banner-cleanup">
          <span>
            有 {posterCleanup.length} 个海报源文件超过保留期：废案 24 小时、定稿 7 天未使用。系统不会自动删除，请查看后确认是否清理。
          </span>
          <button
            className="btn btn-sm"
            type="button"
            onClick={() => {
              const task = (workspace?.tasks ?? []).find((item) => item.id === posterCleanup[0].taskId);
              if (task) focusTask(task);
            }}
          >
            去处理
          </button>
        </div>
      ) : null}

      <div className="wb-ws-body">
        <aside className="wb-stage-nav">
          <div className="wb-stage-nav-head">阶段</div>
          {stageStats.map((stage) => (
            <button
              key={stage.key}
              type="button"
              className={`wb-stage-link${activity.stage === stage.key ? ' active' : ''}`}
              onClick={() => focusStage(stage.key)}
            >
              <span>
                <em>{stage.group}</em>
                {stage.label}
              </span>
              <b>
                {stage.done}/{stage.total}
                {stage.waiting > 0 ? <i>{stage.waiting}</i> : null}
              </b>
            </button>
          ))}

          <div className="wb-stage-nav-filter">
            <label>
              <input type="checkbox" checked={onlyMine} onChange={(event) => setOnlyMine(event.target.checked)} />
              只看我的任务
            </label>
          </div>

          <div className="wb-side-material" onClick={() => setMaterialOpen(true)} role="button" tabIndex={0}>
            <strong>本场资料</strong>
            <span>{materialCount} 份 · 点击管理</span>
            {workspace.materials.some((material) => material.stale) ? <em>有素材 7 天未调用</em> : null}
          </div>

          <div className="wb-side-tip">
            拖动画布空白处平移；拖动任务卡调整位置；折叠阶段可减少干扰。
          </div>
        </aside>

        <section className="wb-ws-center">
          <div className="wb-canvas-toolbar">
            <div className="wb-tabs">
              <button type="button" className={`wb-tab${view === 'canvas' ? ' active' : ''}`} onClick={() => setView('canvas')}>
                画布
              </button>
              <button type="button" className={`wb-tab${view === 'list' ? ' active' : ''}`} onClick={() => setView('list')}>
                清单
              </button>
            </div>
            <div className="wb-task-search">
              <input
                type="search"
                value={query}
                aria-label="搜索任务"
                placeholder="搜索任务 / 负责人 / 阶段"
                onFocus={() => setSearchOpen(true)}
                onBlur={() => window.setTimeout(() => setSearchOpen(false), 120)}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSearchOpen(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setQuery('');
                    setSearchOpen(false);
                  }
                  if (event.key === 'Enter' && searchResults.length > 0) {
                    event.preventDefault();
                    focusTask(searchResults[0]);
                  }
                }}
              />
              {searchOpen && query.trim() ? (
                <div className="wb-search-results" role="listbox" aria-label="任务搜索结果">
                  {searchResults.length === 0 ? (
                    <div className="wb-search-empty">没有匹配的任务</div>
                  ) : (
                    searchResults.map((task) => (
                      <button
                        key={task.id}
                        type="button"
                        role="option"
                        aria-selected={selectedTaskId === task.id}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          focusTask(task);
                        }}
                      >
                        <span>
                          <strong>{task.title}</strong>
                          <em>
                            {STAGE_MAP[task.stage]?.label || task.stage} · {TASK_STATUS_LABEL[task.status] || task.status}
                          </em>
                        </span>
                        <b>{TASK_KIND_META[task.kind]?.label || task.kind}</b>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
            <div className="spacer" />
            {view === 'canvas' ? (
              <>
                <button className="wb-icon-btn" type="button" onClick={() => setZoom((value) => Math.max(0.4, Number((value - 0.1).toFixed(2))))} aria-label="缩小">
                  −
                </button>
                <span className="wb-zoom">{Math.round(zoom * 100)}%</span>
                <button className="wb-icon-btn" type="button" onClick={() => setZoom((value) => Math.min(1.4, Number((value + 0.1).toFixed(2))))} aria-label="放大">
                  +
                </button>
                <button className="btn btn-sm" type="button" onClick={fitView}>
                  适应视图
                </button>
              </>
            ) : null}
            <button className="btn btn-sm btn-primary" type="button" onClick={() => setAddTaskOpen((value) => !value)}>
              + 添加任务
            </button>
          </div>

          {addTaskOpen ? (
            <AddTaskForm
              activityId={activityId}
              defaultStage={activity.stage}
              userName={user.name}
              onCancel={() => setAddTaskOpen(false)}
              onCreated={async (task) => {
                setAddTaskOpen(false);
                await load();
                setSelectedTaskId(task.id);
                notify('任务已添加。');
              }}
            />
          ) : null}

          {view === 'canvas' ? (
            <div
              className="wb-canvas"
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <div
                className="wb-canvas-inner"
                ref={innerRef}
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  width: STAGES.length * COLUMN_WIDTH,
                  height: 900
                }}
              >
                {STAGES.map((stage, index) => {
                  const stageTasks = tasks.filter(
                    (task) => task.stage === stage.key && (!onlyMine || task.assignee === user.name)
                  );
                  const isCollapsed = collapsed.includes(stage.key);
                  return (
                    <div
                      key={stage.key}
                      className={`wb-canvas-col${isCollapsed ? ' collapsed' : ''}`}
                      style={{ left: index * COLUMN_WIDTH, width: COLUMN_WIDTH - 12 }}
                    >
                      <div className="wb-canvas-col-head">
                        <div>
                          <em>{stage.group}</em>
                          <strong>{stage.label}</strong>
                        </div>
                        <span>{stageTasks.length} 项</span>
                        <button
                          type="button"
                          className="wb-collapse"
                          onClick={(event) => {
                            event.stopPropagation();
                            setCollapsed((prev) =>
                              prev.includes(stage.key) ? prev.filter((key) => key !== stage.key) : [...prev, stage.key]
                            );
                          }}
                        >
                          {isCollapsed ? '展开' : '折叠'}
                        </button>
                      </div>
                      {isCollapsed ? (
                        <div className="wb-collapsed-hint">已折叠 {stageTasks.length} 项任务</div>
                      ) : null}
                    </div>
                  );
                })}

                {tasks
                  .filter((task) => !onlyMine || task.assignee === user.name)
                  .filter((task) => !collapsed.includes(task.stage))
                  .map((task) => {
                    const adopted = outputs.find((output) => output.taskId === task.id && output.adopted) ??
                      outputs.find((output) => output.taskId === task.id);
                    const kindMeta = TASK_KIND_META[task.kind];
                    return (
                      <article
                        key={task.id}
                        data-task-id={task.id}
                        className={`wb-task-card${selectedTaskId === task.id ? ' active' : ''}${pulseTaskId === task.id ? ' pulse' : ''}`}
                        style={{
                          left: task.posX,
                          top: task.posY,
                          width: CARD_WIDTH,
                          borderLeftColor: TASK_STATUS_COLOR[task.status] || 'var(--border)'
                        }}
                        onDoubleClick={() => setSelectedTaskId(task.id)}
                      >
                        <div className="wb-task-card-head">
                          <span className="wb-task-kind">{kindMeta?.label || task.kind}</span>
                          <span className={`wb-task-mode mode-${task.mode}`}>
                            {task.mode === 'ai' ? 'AI' : task.mode === 'visual' ? '视觉' : '人工'}
                          </span>
                        </div>
                        <h4>{task.title}</h4>
                        <div className="wb-task-card-foot">
                          <span title="负责人">{task.assignee || '未分配'}</span>
                          <span className={`wb-task-status status-${task.status}`}>
                            {TASK_STATUS_LABEL[task.status] || task.status}
                          </span>
                        </div>
                        {adopted ? (
                          <div className={`wb-task-output status-${adopted.status}`}>
                            {CONTENT_STATUS_LABEL[adopted.status] || adopted.status} · v{adopted.version}
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
              </div>
            </div>
          ) : (
            <div className="wb-list-view">
              {STAGES.map((stage) => {
                const stageTasks = tasks.filter(
                  (task) => task.stage === stage.key && (!onlyMine || task.assignee === user.name)
                );
                return (
                  <section key={stage.key} className="wb-list-stage">
                    <div className="wb-list-stage-head">
                      <h3>
                        {stage.label}
                        <em>{stage.group}</em>
                      </h3>
                      <span>{stageTasks.length} 项</span>
                    </div>
                    {stageTasks.length === 0 ? (
                      <p className="wb-muted">本阶段没有任务。</p>
                    ) : (
                      <div className="wb-list-rows">
                        {stageTasks.map((task) => {
                          const adopted = outputs.find((output) => output.taskId === task.id && output.adopted);
                          return (
                            <button
                              key={task.id}
                              type="button"
                              className={`wb-list-row${selectedTaskId === task.id ? ' active' : ''}`}
                              onClick={() => setSelectedTaskId(task.id)}
                            >
                              <span className="wb-row-main">
                                <strong>{task.title}</strong>
                                <em>{TASK_KIND_META[task.kind]?.label || task.kind}</em>
                              </span>
                              <span className="wb-row-side">
                                <span>{task.assignee || '未分配'}</span>
                                {task.dueDate ? <span>截止 {task.dueDate}</span> : null}
                                <span className={`wb-task-status status-${task.status}`}>
                                  {TASK_STATUS_LABEL[task.status] || task.status}
                                </span>
                                {adopted ? (
                                  <span className={`wb-content-status status-${adopted.status}`}>
                                    {CONTENT_STATUS_LABEL[adopted.status]}
                                  </span>
                                ) : null}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </section>

        <aside className="wb-detail">
          {selectedTask ? (
            <TaskDetail
              key={selectedTask.id}
              task={selectedTask}
              activity={activity}
              materials={workspace.materials}
              outputs={outputs}
              reviews={workspace.reviews}
              publishes={workspace.publishes}
              posters={workspace.posters}
              userName={user.name}
              liveModel={liveModel}
              paused={paused}
              busy={busyTaskId === selectedTask.id}
              focusOutputId={focusOutputId}
              onPatchTask={(patch) => patchTask(selectedTask.id, patch)}
              onGenerate={() => void generate(selectedTask)}
              onReload={load}
              onOpenMaterials={() => setMaterialOpen(true)}
              onOpenPoster={() => setPosterTask(selectedTask)}
              onNotice={notify}
            />
          ) : (
            <div className="wb-detail-empty">从画布或清单中选择一个任务。</div>
          )}
        </aside>
      </div>

      {materialOpen ? (
        <MaterialPanel
          activityId={activityId}
          materials={workspace.materials}
          currentUserId={user.id}
          onReload={load}
          onClose={() => setMaterialOpen(false)}
          onNotice={notify}
        />
      ) : null}

      {posterTask ? (
        <div className="wb-modal-backdrop" role="dialog" aria-modal="true" aria-label="海报编辑器">
          <div className="wb-modal wb-poster-modal">
            <div className="wb-modal-head">
              <div>
                <h2>{posterTask.title}</h2>
                <p>下载 PNG 会自动上传云端保存为废案版本；点击画布下方“保存为海报版本”才会标记定稿。</p>
              </div>
              <div className="wb-modal-actions">
                <button className="wb-icon-btn" type="button" onClick={() => setPosterTask(null)} aria-label="关闭">
                  ×
                </button>
              </div>
            </div>
            <PosterPanel
              activity={activity.data}
              template={posterTemplate}
              onTemplateChange={setPosterTemplate}
              showAiMark={posterAiMark}
              onShowAiMarkChange={setPosterAiMark}
              activityId={activity.id}
              taskId={posterTask.id}
              outputId={
                outputs.find((output) => output.taskId === posterTask.id && output.adopted)?.id ??
                outputs.find((output) => output.taskId === posterTask.id)?.id
              }
              onSaveAsVersion={(blob) => savePosterVersion(posterTask, blob)}
              onNotice={notify}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AddTaskForm({
  activityId,
  defaultStage,
  userName,
  onCancel,
  onCreated
}: {
  activityId: string;
  defaultStage: string;
  userName: string;
  onCancel: () => void;
  onCreated: (task: TaskRecord) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [stage, setStage] = useState(defaultStage);
  const [mode, setMode] = useState('manual');
  const [assignee, setAssignee] = useState(userName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ task: TaskRecord }>(`/api/activities/${activityId}/tasks`, {
        method: 'POST',
        body: JSON.stringify({ title, stage, mode, assignee })
      });
      await onCreated(result.task);
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加失败');
      setBusy(false);
    }
  }

  return (
    <form className="wb-add-task" onSubmit={submit}>
      <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="任务名称" autoFocus />
      <select value={stage} onChange={(event) => setStage(event.target.value)}>
        {STAGES.map((item) => (
          <option key={item.key} value={item.key}>
            {item.label}
          </option>
        ))}
      </select>
      <select value={mode} onChange={(event) => setMode(event.target.value)}>
        <option value="manual">人工任务</option>
        <option value="ai">AI 起草</option>
        <option value="visual">视觉制作</option>
      </select>
      <input value={assignee} onChange={(event) => setAssignee(event.target.value)} placeholder="负责人" />
      <button className="btn btn-sm btn-primary" type="submit" disabled={!title.trim() || busy}>
        {busy ? '添加中…' : '添加'}
      </button>
      <button className="btn btn-sm" type="button" onClick={onCancel}>
        取消
      </button>
      {error ? <span className="wb-error">{error}</span> : null}
    </form>
  );
}
