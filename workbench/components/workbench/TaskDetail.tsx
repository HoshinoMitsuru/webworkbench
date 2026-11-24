'use client';

import { useEffect, useMemo, useState } from 'react';
import { ACTIVITY_STATUS_LABEL, CONTENT_STATUS_LABEL, TASK_KIND_META, TASK_STATUS_LABEL, STAGE_MAP } from '@/lib/workflow';
import type {
  ActivityDetail,
  AiRunRecord,
  MaterialRecord,
  OutputRecord,
  PosterAssetRecord,
  PublishRecord,
  ReviewRecord,
  TaskRecord
} from '@/lib/workspace-types';
import { checkSensitiveWords } from '@/lib/word-check';
import { api, downloadText, formatDate } from './api';

interface Props {
  task: TaskRecord;
  activity: ActivityDetail;
  materials: MaterialRecord[];
  outputs: OutputRecord[];
  reviews: ReviewRecord[];
  publishes: PublishRecord[];
  posters: PosterAssetRecord[];
  userName: string;
  liveModel: boolean;
  paused: boolean;
  busy: boolean;
  activeRun?: AiRunRecord | null;
  latestRun?: AiRunRecord | null;
  focusOutputId?: string | null;
  onPatchTask: (patch: Partial<TaskRecord>) => Promise<void>;
  onGenerate: () => void;
  onCancelRun: () => void;
  onReload: () => Promise<void>;
  onOpenMaterials: () => void;
  onOpenPoster: () => void;
  onNotice: (message: string, kind?: 'info' | 'error') => void;
}

const REVIEW_LABEL: Record<string, string> = {
  submit: '提交审核',
  approve: '审核通过',
  return: '退回修改'
};

function diffLines(before: string, after: string): Array<{ type: 'same' | 'add' | 'del'; text: string }> {
  const a = before.split('\n').slice(0, 400);
  const b = after.split('\n').slice(0, 400);
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows: Array<{ type: 'same' | 'add' | 'del'; text: string }> = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length && rows.length < 240) {
    if (a[i] === b[j]) {
      rows.push({ type: 'same', text: a[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: 'del', text: a[i] });
      i += 1;
    } else {
      rows.push({ type: 'add', text: b[j] });
      j += 1;
    }
  }
  while (i < a.length && rows.length < 240) rows.push({ type: 'del', text: a[i++] });
  while (j < b.length && rows.length < 240) rows.push({ type: 'add', text: b[j++] });
  return rows;
}

export default function TaskDetail({
  task,
  activity,
  materials,
  outputs,
  reviews,
  publishes,
  posters,
  userName,
  liveModel,
  paused,
  busy,
  activeRun = null,
  latestRun = null,
  focusOutputId,
  onPatchTask,
  onGenerate,
  onCancelRun,
  onReload,
  onOpenMaterials,
  onOpenPoster,
  onNotice
}: Props) {
  const taskOutputs = useMemo(
    () => outputs.filter((output) => output.taskId === task.id).sort((a, b) => b.version - a.version),
    [outputs, task.id]
  );

  const [selectedId, setSelectedId] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [comment, setComment] = useState('');
  const [note, setNote] = useState(task.note);
  const [refs, setRefs] = useState<string[]>(materials.map((material) => material.id));
  const [working, setWorking] = useState('');
  const [publishOpen, setPublishOpen] = useState(false);
  const [platform, setPlatform] = useState('公众号');
  const [url, setUrl] = useState('');
  const [publishNote, setPublishNote] = useState('');
  const [aiAck, setAiAck] = useState(false);
  const [aiDeclared, setAiDeclared] = useState(true);
  const [cleanupPosterId, setCleanupPosterId] = useState('');
  const [deletingPoster, setDeletingPoster] = useState('');
  const [nowTick, setNowTick] = useState(Date.now());

  useEffect(() => {
    if (!activeRun || activeRun.status !== 'running') return;
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeRun?.id, activeRun?.status]);

  const runElapsed = activeRun
    ? Math.max(0, Math.round((nowTick - new Date(activeRun.createdAt).getTime()) / 1000))
    : 0;

  const taskPosters = useMemo(
    () => posters.filter((poster) => poster.taskId === task.id).sort((a, b) => b.version - a.version),
    [posters, task.id]
  );

  const selected = useMemo(() => {
    if (selectedId) {
      const found = taskOutputs.find((output) => output.id === selectedId);
      if (found) return found;
    }
    return taskOutputs.find((output) => output.adopted) ?? taskOutputs[0] ?? null;
  }, [selectedId, taskOutputs]);

  useEffect(() => {
    if (focusOutputId && taskOutputs.some((output) => output.id === focusOutputId)) {
      setSelectedId(focusOutputId);
    }
  }, [focusOutputId, taskOutputs]);

  useEffect(() => {
    setTitle(selected?.title ?? '');
    setBody(selected?.body ?? '');
    setComment('');
    setPublishOpen(false);
    setAiAck(false);
    setAiDeclared(true);
  }, [selected?.id, selected?.updatedAt]);

  useEffect(() => {
    setNote(task.note);
  }, [task.id, task.note]);

  useEffect(() => {
    const available = materials.map((material) => material.id);
    const refsInUse = task.inputRefs.filter((id) => available.includes(id));
    setRefs(refsInUse.length > 0 ? refsInUse : available);
  }, [task.id, task.inputRefs, materials]);

  const usingAllMaterials = useMemo(
    () => task.inputRefs.filter((id) => materials.some((material) => material.id === id)).length === 0,
    [task.inputRefs, materials]
  );

  function toggleRef(id: string) {
    if (paused) return;
    const available = materials.map((material) => material.id);
    const current = usingAllMaterials
      ? available
      : available.filter((item) => task.inputRefs.includes(item));
    const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
    if (next.length === 0) {
      onNotice('至少保留一份资料；如需完全不带资料，请先确认任务不依赖资料起草。', 'error');
      return;
    }
    void onPatchTask({ inputRefs: next.length === available.length ? [] : next });
  }

  function useAllMaterials() {
    if (paused) return;
    void onPatchTask({ inputRefs: [] });
  }

  const meta = TASK_KIND_META[task.kind];
  const effectiveRefCount = usingAllMaterials ? materials.length : refs.length;
  const editable = selected ? ['draft', 'changes'].includes(selected.status) : false;
  const outputReviews = useMemo(
    () => reviews.filter((review) => review.outputId === selected?.id),
    [reviews, selected?.id]
  );
  const outputPublishes = useMemo(
    () => publishes.filter((record) => record.outputId === selected?.id),
    [publishes, selected?.id]
  );

  async function runAction(action: string, extra: Record<string, unknown> = {}) {
    if (!selected) return;
    if (action === 'approve' && !aiAck) {
      onNotice('请先提醒审核人：本内容含 AI 生成成分，勾选“已核对并知悉”后再通过。', 'error');
      return;
    }
    if (action === 'submit') {
      const found = checkSensitiveWords(`${title}\n${body}`);
      if (found.length > 0) {
        const tokens = [...new Set(found.map((item) => item.token))].join('、');
        const confirmed = window.confirm(
          `自检发现 ${found.length} 处合规敏感用词：${tokens}\n\n建议先修改；如确需提交，审核人仍会看到提示。是否继续提交？`
        );
        if (!confirmed) return;
      }
    }
    setWorking(action);
    try {
      const result = await api<{ output?: OutputRecord }>(`/api/outputs/${selected.id}/action`, {
        method: 'POST',
        body: JSON.stringify({ action, ...extra })
      });
      if (action === 'revise' && result.output) {
        setSelectedId(result.output.id);
      }
      await onReload();
      if (action === 'approve') {
        onNotice('已通过审核。隐式 AI 元数据与审核留痕保留，发布时仍需在平台完成 AI 声明。');
      } else if (action === 'return') {
        onNotice('已退回，请按审核意见修改后重新提交。');
      } else if (action === 'submit') {
        onNotice('已提交审核。请提醒审核人查看待核项后再确认。');
      } else if (action === 'adopt') {
        onNotice('已采用该版本。');
      } else if (action === 'revise') {
        onNotice('已基于该版本新建草稿，原版本保持不变。');
      }
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '操作失败', 'error');
    } finally {
      setWorking('');
    }
  }

  async function saveDraft() {
    if (!selected) return;
    setWorking('save');
    try {
      await api(`/api/outputs/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title, body })
      });
      await onReload();
      onNotice('草稿已保存。');
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '保存失败', 'error');
    } finally {
      setWorking('');
    }
  }

  function exportOutput(formal: boolean) {
    if (!selected) return;
    if (formal && selected.status !== 'approved') {
      onNotice('只有审核通过的版本才能正式导出；可先导出草稿副本。', 'error');
      return;
    }
    const header = formal
      ? ''
      : '【草稿 · AI 生成内容，发布前需人工核对；未经审核不得正式对外】\n\n';
    downloadText(`${activity.title}-${selected.title || task.title}.txt`, `${header}${title}\n\n${body}`);
  }

  async function savePublish() {
    if (!selected) return;
    setWorking('publish');
    try {
      await api(`/api/outputs/${selected.id}/publish`, {
        method: 'POST',
        body: JSON.stringify({ platform, url, note: publishNote, aiDeclared })
      });
      setPublishOpen(false);
      setUrl('');
      setPublishNote('');
      await onReload();
      onNotice('发布记录已保存。');
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '发布记录保存失败', 'error');
    } finally {
      setWorking('');
    }
  }

  async function removePoster(id: string) {
    setDeletingPoster(id);
    try {
      await api(`/api/posters/${id}`, { method: 'DELETE' });
      setCleanupPosterId('');
      await onReload();
      onNotice('已删除该海报源文件。');
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '删除失败', 'error');
    } finally {
      setDeletingPoster('');
    }
  }

  const waitOrBlocked = task.status === 'waiting' || task.status === 'blocked';

  return (
    <div className="wb-detail-inner">
      <div className="wb-detail-head">
        <div>
          <span className="wb-kicker">{STAGE_MAP[task.stage]?.label || task.stage}</span>
          <h2>{task.title}</h2>
          <p>{meta ? `${meta.scene} · ${meta.channel} · ${meta.audience}` : task.kind}</p>
        </div>
        <span className={`wb-mode wb-mode-${task.mode}`}>
          {task.mode === 'ai' ? 'AI 起草' : task.mode === 'visual' ? '模板制作' : '人工任务'}
        </span>
      </div>

      <div className="wb-form-grid compact">
        <label className="wb-field">
          <span>任务状态</span>
          <select value={task.status} onChange={(event) => onPatchTask({ status: event.target.value })}>
            {Object.entries(TASK_STATUS_LABEL).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="wb-field">
          <span>负责人</span>
          <div className="wb-assignee-row">
            <input
              defaultValue={task.assignee}
              key={`${task.id}-assignee`}
              placeholder={task.role ? `待认领 · ${task.role}` : '待认领'}
              onBlur={(event) => {
                if (event.target.value.trim() !== task.assignee) onPatchTask({ assignee: event.target.value.trim() });
              }}
            />
            {!task.assignee ? (
              <button
                className="btn btn-sm"
                type="button"
                disabled={paused}
                onClick={() => onPatchTask({ assignee: userName })}
              >
                认领
              </button>
            ) : null}
          </div>
          <small className="wb-muted">{task.role ? `责任角色：${task.role}` : '未设置责任角色'}</small>
        </label>
        <label className="wb-field">
          <span>截止时间</span>
          <input
            type="date"
            defaultValue={task.dueDate}
            key={`${task.id}-due`}
            onChange={(event) => onPatchTask({ dueDate: event.target.value })}
          />
        </label>
      </div>

      {waitOrBlocked ? (
        <label className="wb-field">
          <span>等待原因 / 负责方</span>
          <input
            defaultValue={task.waitReason}
            key={`${task.id}-wait`}
            onBlur={(event) => {
              if (event.target.value !== task.waitReason) onPatchTask({ waitReason: event.target.value });
            }}
            placeholder="例如：等待场地确认，负责方：合作方王老师"
          />
        </label>
      ) : null}

      {task.mode === 'manual' ? (
        <div className="wb-block">
          <div className="wb-block-head">
            <strong>任务记录</strong>
            <button
              className="btn btn-sm"
              type="button"
              disabled={working === 'note'}
              onClick={async () => {
                setWorking('note');
                await onPatchTask({ note });
                await onReload();
                setWorking('');
                onNotice('任务记录已保存。');
              }}
            >
              保存记录
            </button>
          </div>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={5} placeholder="记录实际结果、数据来源、对接人和待确认事项。" />
          <p className="wb-muted">人工任务的结果会自动成为后续 AI 任务的参考资料。</p>
        </div>
      ) : null}

      <div className="wb-block">
        <div className="wb-block-head">
          <strong>引用资料</strong>
          <span className="wb-muted">
            {materials.length === 0
              ? '暂无资料'
              : usingAllMaterials
                ? `默认使用全部 ${materials.length} 份`
                : `已选 ${refs.length} / ${materials.length} 份`}
          </span>
          <button className="link-btn" type="button" onClick={onOpenMaterials}>
            管理资料（{materials.length}）
          </button>
        </div>
        {materials.length === 0 ? (
          <p className="wb-muted">还没有资料。上传方案、名单、照片说明或已确认引语后，AI 会基于这些内容起草。</p>
        ) : (
          <>
            <p className="wb-muted">
              只勾选本次起草需要参考的资料；不勾选（或点“使用全部”）时默认带入全部可见资料。
            </p>
            <div className="wb-ref-scroll">
              {materials.map((material) => {
                const checked = refs.includes(material.id);
                return (
                  <label key={material.id} className={`wb-ref-item${checked ? ' checked' : ''}`}>
                    <input type="checkbox" checked={checked} disabled={paused} onChange={() => toggleRef(material.id)} />
                    <span className={`wb-kind kind-${material.kind}`}>
                      {material.kind === 'file' ? material.category : material.kind}
                    </span>
                    <span className="wb-ref-name" title={material.name}>
                      {material.name}
                    </span>
                    <span className="wb-ref-meta">
                      {material.visibility === 'private' ? '仅自己' : '共享'}
                      {material.lastUsedAt ? ` · ${formatDate(material.lastUsedAt)}` : ''}
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="wb-ref-actions">
              <button className="btn btn-sm" type="button" onClick={useAllMaterials} disabled={paused || usingAllMaterials}>
                使用全部资料
              </button>
              <span className="wb-muted">修改后立即保存，下次生成生效。</span>
            </div>
          </>
        )}
      </div>

      <div className="wb-fact-mini">
        <div>
          <span>活动</span>
          <strong>{activity.data.name || '待补充'}</strong>
        </div>
        <div>
          <span>时间地点</span>
          <strong>
            {[activity.data.date, activity.data.location].filter(Boolean).join(' · ') || '待补充'}
          </strong>
        </div>
        <div>
          <span>报名方式</span>
          <strong>{activity.data.signup || '待补充'}</strong>
        </div>
        <p>事实只从活动资料与上传文件中读取，缺项会显示为待补充，不会自动编造。</p>
      </div>

      {task.mode === 'ai' ? (
        <div className="wb-generate-bar">
          <button
            className="btn btn-primary"
            type="button"
            disabled={paused || busy}
            onClick={onGenerate}
          >
            {busy ? '生成中…' : taskOutputs.length > 0 ? '重新生成初稿' : '生成初稿'}
          </button>
          {activeRun && activeRun.status === 'running' ? (
            <>
              <span>
                生成中 · 已运行 {runElapsed} 秒
                {activeRun.mode === 'live' ? '（模型调用）' : '（演示模式）'}
              </span>
              <button className="btn btn-sm btn-danger" type="button" onClick={onCancelRun}>
                取消生成
              </button>
            </>
          ) : (
            <span>
              {liveModel
                ? `将引用 ${effectiveRefCount} 份资料调用模型起草；超时或取消后不会生成新版本。`
                : `演示模式：将引用 ${effectiveRefCount} 份资料跑通流程，正式使用前需配置模型。`}
            </span>
          )}
        </div>
      ) : null}

      {task.mode === 'ai' && !busy && latestRun && ['failed', 'cancelled'].includes(latestRun.status) ? (
        <div className="wb-run-failed">
          <strong>{latestRun.status === 'cancelled' ? '上次生成已取消' : '上次生成失败'}</strong>
          <span>{latestRun.error || '未生成新版本'}</span>
          <button className="btn btn-sm" type="button" onClick={onGenerate} disabled={paused}>
            重试
          </button>
        </div>
      ) : null}

      {task.mode === 'visual' ? (
        <div className="wb-generate-bar">
          <button className="btn btn-primary" type="button" onClick={onOpenPoster} disabled={paused}>
            打开海报编辑器
          </button>
          <span>关键文字与二维码为可控元素，导出 1080×1440 PNG。</span>
        </div>
      ) : null}

      {task.mode === 'visual' ? (
        <div className="wb-block">
          <div className="wb-block-head">
            <strong>云端海报文件</strong>
            <span className="wb-muted">
              {taskPosters.length > 0
                ? `${taskPosters.length} 个版本，定稿 ${taskPosters.filter((poster) => poster.state === 'final').length} 个`
                : '尚未上传'}
            </span>
          </div>
          {taskPosters.length === 0 ? (
            <p className="wb-muted">
              在海报编辑器下载 PNG 会自动上传为废案版本；保存为海报版本会标记定稿。系统只做清理提示，不会自动删除。
            </p>
          ) : (
            <div className="wb-poster-list">
              {taskPosters.map((poster) => {
                const needsCleanup = poster.cleanupDue || poster.stale;
                return (
                  <div className="wb-poster-row" key={poster.id}>
                    <div className="wb-poster-info">
                      <strong>v{poster.version}</strong>
                      <span className={poster.state === 'final' ? 'wb-poster-state final' : 'wb-poster-state'}>
                        {poster.state === 'final' ? '定稿' : '废案'}
                      </span>
                      <em>
                        {formatDate(poster.createdAt)} · {poster.size < 1024 ? '<1' : Math.round(poster.size / 1024)} KB
                      </em>
                    </div>
                    <div className="wb-poster-actions">
                      <a
                        className="btn btn-sm"
                        href={`/api/posters/${poster.id}/file`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        下载
                      </a>
                      {needsCleanup ? (
                        cleanupPosterId === poster.id ? (
                          <>
                            <button
                              className="btn btn-sm btn-danger"
                              type="button"
                              onClick={() => void removePoster(poster.id)}
                              disabled={deletingPoster === poster.id}
                            >
                              {deletingPoster === poster.id ? '删除中…' : '确认删除'}
                            </button>
                            <button className="btn btn-sm" type="button" onClick={() => setCleanupPosterId('')}>
                              取消
                            </button>
                          </>
                        ) : (
                          <button className="btn btn-sm" type="button" onClick={() => setCleanupPosterId(poster.id)}>
                            {poster.stale ? '确认是否清理' : '清理'}
                          </button>
                        )
                      ) : null}
                    </div>
                    {needsCleanup ? (
                      <p className="wb-poster-hint">
                        {poster.stale
                          ? '定稿已超过 7 天未使用，建议确认是否仍保留。'
                          : '废案已超过 24 小时，建议清理源文件。'}
                        仅在你点击确认后删除。
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      <div className="wb-block">
        <div className="wb-block-head">
          <strong>内容版本</strong>
          <span className="wb-muted">{taskOutputs.length > 0 ? `${taskOutputs.length} 个版本` : '尚未生成'}</span>
        </div>

        {taskOutputs.length > 0 ? (
          <>
            <div className="wb-version-tabs">
              {taskOutputs.map((output) => (
                <button
                  key={output.id}
                  type="button"
                  className={`wb-version${selected?.id === output.id ? ' active' : ''}`}
                  onClick={() => setSelectedId(output.id)}
                >
                  v{output.version}
                  {output.adopted ? <em>采用</em> : null}
                </button>
              ))}
            </div>

            {selected ? (
              <>
                <div className="wb-output-head">
                  <span className={`wb-content-status status-${selected.status}`}>
                    {CONTENT_STATUS_LABEL[selected.status] || selected.status}
                  </span>
                  {selected.aiMark ? <span className="wb-ai-badge">AI 生成，需人工核对</span> : <span className="wb-human-badge">人工确认</span>}
                  <span className="wb-muted">
                    {selected.createdByName} · {formatDate(selected.updatedAt)}
                  </span>
                </div>

                {selected.warnings.length > 0 ? (
                  <div className="wb-warnings">
                    <strong>待核对 / 合规提示（{selected.warnings.length}）</strong>
                    <div>
                      {selected.warnings.map((warning) => (
                        <span
                          key={`${warning.token}-${warning.reason}`}
                          title={warning.reason}
                          className={warning.reason.startsWith('合规') ? 'wb-warning-compliance' : undefined}
                        >
                          {warning.token}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                <input
                  className="wb-title-input"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  readOnly={!editable}
                  placeholder="内容标题"
                />
                <textarea
                  className="wb-body-input"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  readOnly={!editable}
                  rows={14}
                  placeholder="生成后可在这里修改。"
                />

                {selected.status === 'pending' ? (
                  <div className="wb-ai-notice">
                    <strong>本内容含 AI 生成成分</strong>
                    <p>
                      本次送审版本为 v{selected.version}，系统会保存送审快照，审核完成后可在下方审核记录中查看快照与当前内容的差异。
                    </p>
                    <p>
                      请审核人核对事实、数据、引用与肖像/作品授权，并知悉：通过后可不再显示显式 AI 标识，但文件隐式元数据与审核留痕始终保留；发布时仍需在平台完成 AI 声明。
                    </p>
                    <label className="wb-ai-check">
                      <input type="checkbox" checked={aiAck} onChange={(event) => setAiAck(event.target.checked)} />
                      <span>我已核对事实、数据与授权，并知悉本内容含 AI 生成成分</span>
                    </label>
                  </div>
                ) : null}

                <div className="wb-action-row">
                  {editable ? (
                    <button className="btn btn-sm" type="button" onClick={saveDraft} disabled={working === 'save'}>
                      {working === 'save' ? '保存中…' : '保存草稿'}
                    </button>
                  ) : null}
                  {!selected.adopted ? (
                    <button className="btn btn-sm" type="button" onClick={() => runAction('adopt')} disabled={Boolean(working)}>
                      采用此版本
                    </button>
                  ) : null}
                  {editable ? (
                    <button
                      className="btn btn-sm btn-primary"
                      type="button"
                      onClick={() => runAction('submit', { comment })}
                      disabled={Boolean(working)}
                    >
                      提交审核
                    </button>
                  ) : null}
                  {selected.status === 'pending' ? (
                    <>
                      <button
                        className="btn btn-sm btn-primary"
                        type="button"
                        onClick={() => runAction('approve', { comment, aiAck })}
                        disabled={Boolean(working) || !aiAck}
                        title={aiAck ? '' : '请先勾选“已核对并知悉本内容含 AI”'}
                      >
                        通过审核
                      </button>
                      <button
                        className="btn btn-sm btn-danger"
                        type="button"
                        onClick={() => runAction('return', { comment })}
                        disabled={Boolean(working)}
                      >
                        退回修改
                      </button>
                    </>
                  ) : null}
                  {selected.status !== 'draft' && selected.status !== 'changes' ? (
                    <button className="btn btn-sm" type="button" onClick={() => runAction('revise')} disabled={Boolean(working)}>
                      另建草稿
                    </button>
                  ) : null}
                  <button className="btn btn-sm" type="button" onClick={() => exportOutput(false)}>
                    导出草稿
                  </button>
                  {selected.status === 'approved' ? (
                    <>
                      <button className="btn btn-sm btn-primary" type="button" onClick={() => exportOutput(true)}>
                        正式导出
                      </button>
                      <button className="btn btn-sm" type="button" onClick={() => setPublishOpen((value) => !value)}>
                        记录发布
                      </button>
                    </>
                  ) : null}
                </div>

                <label className="wb-field">
                  <span>审核意见（退回时必填）</span>
                  <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={2} placeholder="指出需要核对或修改的地方。" />
                </label>

                <p className="wb-compliance">
                  审核通过时可免显式 AI 标识，但导出的 PNG 等文件保留隐式元数据，审核与发布全程留痕。发布默认由工作人员在平台手动完成，工作台只记录结果；一键发布需平台资质与接口配置，当前未启用。
                </p>

                {publishOpen ? (
                  <div className="wb-publish-box">
                    <div className="wb-publish-mode">
                      <strong>发布方式：人工发布（推荐）</strong>
                      <span>
                        请先在平台后台手动发布，再回到工作台记录结果与链接。工作台不会自动调用公众号/小红书等平台接口；公众号一键发布需认证主体、接口凭据与服务器 IP 白名单，当前未启用。
                      </span>
                    </div>
                    <div className="wb-form-grid compact">
                      <label className="wb-field">
                        <span>平台</span>
                        <select value={platform} onChange={(event) => setPlatform(event.target.value)}>
                          {['公众号', '小红书', '视频号', '社群', '其他'].map((item) => (
                            <option key={item}>{item}</option>
                          ))}
                        </select>
                      </label>
                      <label className="wb-field">
                        <span>链接</span>
                        <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://" />
                      </label>
                    </div>
                    <label className="wb-field">
                      <span>备注</span>
                      <input value={publishNote} onChange={(event) => setPublishNote(event.target.value)} placeholder="发布时间、账号或交接人" />
                    </label>
                    <label className="wb-ai-check">
                      <input
                        type="checkbox"
                        checked={aiDeclared}
                        onChange={(event) => setAiDeclared(event.target.checked)}
                      />
                      <span>已在平台完成“AI 生成内容”声明（默认勾选；平台无对应选项时请保留隐式元数据并在备注说明）</span>
                    </label>
                    <button className="btn btn-sm btn-primary" type="button" onClick={savePublish} disabled={working === 'publish'}>
                      保存发布记录
                    </button>
                  </div>
                ) : null}

                {outputPublishes.length > 0 ? (
                  <div className="wb-history">
                    <strong>发布记录</strong>
                    {outputPublishes.map((record) => (
                      <div key={record.id}>
                        <span>{record.platform}</span>
                        {record.url ? (
                          <a href={record.url} target="_blank" rel="noreferrer">
                            {record.url}
                          </a>
                        ) : null}
                        <em>
                          {record.userName} · {formatDate(record.createdAt)} · {record.aiDeclared ? '已声明 AI' : '未声明 AI'}{' '}
                          {record.note}
                        </em>
                      </div>
                    ))}
                  </div>
                ) : null}

                {outputReviews.length > 0 ? (
                  <div className="wb-history">
                    <strong>审核记录</strong>
                    {outputReviews.map((review) => (
                      <div key={review.id}>
                        <span>
                          {REVIEW_LABEL[review.action] || review.action}
                          {review.aiAck ? ' · 已确认含 AI' : ''}
                        </span>
                        <em>
                          {review.userName} · {formatDate(review.createdAt)}
                        </em>
                        {review.comment ? <p>{review.comment}</p> : null}
                        {review.snapshotBody ? (
                          <details className="wb-snapshot">
                            <summary>查看送审快照（{review.snapshotTitle || '无标题'}）</summary>
                            <pre>{review.snapshotBody}</pre>
                            {selected && review.snapshotBody !== selected.body ? (
                              <div className="wb-diff">
                                <strong>与当前版本 v{selected.version} 的差异</strong>
                                {diffLines(review.snapshotBody, selected.body).map((line, index) => (
                                  <div key={index} className={`wb-diff-${line.type}`}>
                                    {line.type === 'add' ? '+ ' : line.type === 'del' ? '- ' : '  '}
                                    {line.text || ' '}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <em className="wb-muted">与当前内容一致。</em>
                            )}
                          </details>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
          </>
        ) : (
          <div className="wb-empty small">
            {task.mode === 'ai'
              ? '还没有内容版本。点击上方生成初稿。'
              : task.mode === 'visual'
                ? '打开海报编辑器创建视觉版本。'
                : '人工任务请在“任务记录”中填写结果，标记完成后即可归档。'}
          </div>
        )}
      </div>

      <div className="wb-detail-foot">
        <span>{meta?.output || '本任务产物'} </span>
        <span>当前账号：{userName}</span>
        <span>活动状态：{ACTIVITY_STATUS_LABEL[activity.status] || activity.status}</span>
      </div>
    </div>
  );
}
