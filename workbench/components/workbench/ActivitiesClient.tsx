'use client';

import { useEffect, useMemo, useState } from 'react';
import WorkbenchHeader from './WorkbenchHeader';
import { api, formatDate } from './api';
import { ACTIVITY_STATUS_LABEL, DEFAULT_MATERIAL_KEYS, MATERIAL_PRESETS, STAGE_MAP, STAGES } from '@/lib/workflow';
import { EMPTY_ACTIVITY } from '@/lib/types';
import type { ActivitySummary, MyTaskItem } from '@/lib/workspace-types';

interface Props {
  user: { id: string; name: string };
  liveModel: boolean;
  paused: boolean;
}

type FilterKey = 'all' | 'mine' | 'review' | 'waiting' | 'empty';

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: '全部活动' },
  { key: 'mine', label: '我的待办' },
  { key: 'review', label: '待审核' },
  { key: 'waiting', label: '等待 / 受阻' },
  { key: 'empty', label: '缺资料' }
];

const STAGE_BADGE: Record<string, string> = {
  planning: '策划',
  recruit: '招募',
  signup: '报名筹备',
  live: '现场',
  organize: '资料整理',
  review: '回顾',
  archive: '归档'
};

export default function ActivitiesClient({ user, liveModel, paused }: Props) {
  const [summaries, setSummaries] = useState<ActivitySummary[]>([]);
  const [myTasks, setMyTasks] = useState<MyTaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await api<{ summaries: ActivitySummary[]; myTasks: MyTaskItem[] }>('/api/activities');
      setSummaries(data.summaries || []);
      setMyTasks(data.myTasks || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '活动列表加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    return summaries.filter((item) => {
      if (filter === 'mine') return item.myOpen > 0;
      if (filter === 'review') return item.pendingReview > 0;
      if (filter === 'waiting') return item.waiting > 0;
      if (filter === 'empty') return item.materialCount === 0;
      return true;
    });
  }, [summaries, filter]);

  const metrics = useMemo(
    () => ({
      active: summaries.filter((item) => !['archived', 'canceled', 'finished'].includes(item.status)).length,
      mine: myTasks.length,
      review: summaries.reduce((sum, item) => sum + item.pendingReview, 0),
      waiting: summaries.reduce((sum, item) => sum + item.waiting, 0)
    }),
    [summaries, myTasks]
  );

  return (
    <div className="app-shell wb-shell">
      <WorkbenchHeader
        userName={user.name}
        liveModel={liveModel}
        current="activities"
        right={
          <button className="btn btn-primary btn-sm" type="button" onClick={() => setCreating(true)} disabled={paused}>
            + 新建活动
          </button>
        }
      />

      <main className="wb-main">
        <section className="wb-hero">
          <div>
            <h1>活动内容工作台</h1>
            <p>
              从活动方案到招募、现场资料、回顾与归档，一条线在画布上推进。AI 只基于机构上传的资料起草，事实确认与最终审核由人负责。
            </p>
          </div>
          <div className="wb-hero-note">
            <strong>本场内测关注</strong>
            <span>画布推进是否比表格快 · 待核项是否真的被看 · 换活动是否不用重来</span>
          </div>
        </section>

        {paused ? <div className="wb-banner danger">工作台已被管理员暂停，当前只能查看历史内容。</div> : null}
        {error ? <div className="wb-banner danger">{error}</div> : null}

        <section className="wb-metrics">
          <div className="wb-metric">
            <span>进行中活动</span>
            <strong>{metrics.active}</strong>
          </div>
          <div className="wb-metric">
            <span>我的待办</span>
            <strong>{metrics.mine}</strong>
          </div>
          <div className="wb-metric">
            <span>待审核内容</span>
            <strong>{metrics.review}</strong>
          </div>
          <div className="wb-metric">
            <span>等待 / 受阻</span>
            <strong>{metrics.waiting}</strong>
          </div>
        </section>

        <div className="wb-columns">
          <section className="wb-list-panel">
            <div className="wb-toolbar">
              <div className="wb-tabs">
                {FILTERS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`wb-tab${filter === item.key ? ' active' : ''}`}
                    onClick={() => setFilter(item.key)}
                  >
                    {item.label}
                    {item.key === 'mine' && myTasks.length > 0 ? <em>{myTasks.length}</em> : null}
                  </button>
                ))}
              </div>
              <button className="link-btn" type="button" onClick={load} disabled={loading}>
                {loading ? '刷新中…' : '刷新'}
              </button>
            </div>

            {loading && summaries.length === 0 ? (
              <div className="wb-empty">正在读取活动…</div>
            ) : filtered.length === 0 ? (
              <div className="wb-empty">
                {filter === 'all' ? '还没有活动。新建一场活动，工作台会按阶段生成任务。' : '这个筛选下暂时没有活动。'}
              </div>
            ) : (
              <div className="wb-cards">
                {filtered.map((item) => {
                  const percent = item.taskCount > 0 ? Math.round((item.doneCount / item.taskCount) * 100) : 0;
                  return (
                    <a className="wb-card" href={`/activity/${item.id}`} key={item.id}>
                      <div className="wb-card-head">
                        <span className={`wb-status wb-status-${item.status}`}>{ACTIVITY_STATUS_LABEL[item.status] || item.status}</span>
                        <span className="wb-stage">{STAGE_BADGE[item.stage] || STAGE_MAP[item.stage]?.label || '策划'}</span>
                      </div>
                      <h3>{item.title || '未命名活动'}</h3>
                      <div className="wb-card-meta">
                        <span>负责人：{item.ownerName || '未指定'}</span>
                        <span>更新：{formatDate(item.updatedAt)}</span>
                      </div>
                      <div className="wb-progress" aria-label={`完成 ${percent}%`}>
                        <span style={{ width: `${percent}%` }} />
                      </div>
                      <div className="wb-card-foot">
                        <span>
                          {item.doneCount}/{item.taskCount} 项完成
                        </span>
                        <span>{item.materialCount} 份资料</span>
                        {item.pendingReview > 0 ? <span className="wb-dot warn">{item.pendingReview} 待审核</span> : null}
                        {item.waiting > 0 ? <span className="wb-dot wait">{item.waiting} 等待</span> : null}
                      </div>
                    </a>
                  );
                })}
              </div>
            )}
          </section>

          <aside className="wb-side-panel">
            <div className="wb-side-head">
              <h2>我的待办</h2>
              <span>{myTasks.length} 项</span>
            </div>
            {myTasks.length === 0 ? (
              <p className="wb-muted">当前没有分配给你的未完成任务。</p>
            ) : (
              <ul className="wb-task-list">
                {myTasks.slice(0, 14).map((task) => (
                  <li key={task.id}>
                    <a href={`/activity/${task.activityId}?task=${task.id}`}>
                      <span className="wb-task-title">{task.title}</span>
                      <span className="wb-task-sub">
                        {task.activityTitle} · {STAGE_MAP[task.stage]?.label || task.stage}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}

            <div className="wb-side-note">
              <strong>处理原则</strong>
              <p>等待外部确认时记录负责方与原因；时间到达只提示，不自动判定活动完成。</p>
            </div>
          </aside>
        </div>
      </main>

      {creating ? (
        <CreateDialog
          userName={user.name}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            window.location.href = `/activity/${id}`;
          }}
        />
      ) : null}
    </div>
  );
}

function CreateDialog({
  userName,
  onClose,
  onCreated
}: {
  userName: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [ownerName, setOwnerName] = useState(userName);
  const [date, setDate] = useState('');
  const [location, setLocation] = useState('');
  const [audience, setAudience] = useState('');
  const [signup, setSignup] = useState('');
  const [highlights, setHighlights] = useState('');
  const [startStage, setStartStage] = useState('planning');
  const [materials, setMaterials] = useState<string[]>(DEFAULT_MATERIAL_KEYS);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  function toggleMaterial(key: string) {
    setMaterials((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || pending) return;
    setPending(true);
    setError('');
    try {
      const result = await api<{ activity: { id: string } }>('/api/activities', {
        method: 'POST',
        body: JSON.stringify({
          data: {
            ...EMPTY_ACTIVITY,
            name: name.trim(),
            date,
            location,
            audience,
            signup,
            highlights,
            postType: 'recruit'
          },
          ownerName,
          startStage,
          materials
        })
      });
      onCreated(result.activity.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
      setPending(false);
    }
  }

  return (
    <div className="wb-modal-backdrop" role="dialog" aria-modal="true" aria-label="新建活动">
      <form className="wb-modal wb-create" onSubmit={submit}>
        <div className="wb-modal-head">
          <div>
            <h2>新建活动</h2>
            <p>先填已知信息，缺的可以在工作台里补。工作台会按阶段生成任务。</p>
          </div>
          <button className="wb-icon-btn" type="button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="wb-form-grid">
          <label className="wb-field full">
            <span>活动名称 *</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：周末城市漫游 · 老城观察" autoFocus />
          </label>
          <label className="wb-field">
            <span>负责人</span>
            <input value={ownerName} onChange={(event) => setOwnerName(event.target.value)} />
          </label>
          <label className="wb-field">
            <span>当前阶段</span>
            <select value={startStage} onChange={(event) => setStartStage(event.target.value)}>
              {STAGES.map((stage) => (
                <option key={stage.key} value={stage.key}>
                  {stage.label}（{stage.group}）
                </option>
              ))}
            </select>
          </label>
          <label className="wb-field">
            <span>活动日期</span>
            <input value={date} onChange={(event) => setDate(event.target.value)} placeholder="待确认可留空" />
          </label>
          <label className="wb-field">
            <span>地点</span>
            <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="待确认可留空" />
          </label>
          <label className="wb-field">
            <span>面向对象</span>
            <input value={audience} onChange={(event) => setAudience(event.target.value)} placeholder="例如：16—24 岁学生" />
          </label>
          <label className="wb-field">
            <span>报名方式</span>
            <input value={signup} onChange={(event) => setSignup(event.target.value)} placeholder="表单 / 群接龙 / 现场报名" />
          </label>
          <label className="wb-field full">
            <span>活动亮点或过程</span>
            <textarea
              value={highlights}
              onChange={(event) => setHighlights(event.target.value)}
              rows={3}
              placeholder="已确认的内容写清楚，未确认的写待补充"
            />
          </label>
        </div>

        <div className="wb-create-materials">
          <div className="wb-create-label">这次需要产出的物料</div>
          <div className="wb-material-options">
            {MATERIAL_PRESETS.map((preset) => (
              <label key={preset.key} className={`wb-check-card${materials.includes(preset.key) ? ' active' : ''}`}>
                <input
                  type="checkbox"
                  checked={materials.includes(preset.key)}
                  onChange={() => toggleMaterial(preset.key)}
                />
                <span>
                  <strong>{preset.label}</strong>
                  <em>{preset.description}</em>
                </span>
              </label>
            ))}
          </div>
          <p className="wb-muted">未勾选的平台不会出现在必做清单里；之后也可以在画布上补充任务。</p>
        </div>

        {error ? <div className="wb-banner danger">{error}</div> : null}

        <div className="wb-modal-foot">
          <button className="btn" type="button" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" type="submit" disabled={pending || !name.trim()}>
            {pending ? '创建中…' : '创建活动'}
          </button>
        </div>
      </form>
    </div>
  );
}
