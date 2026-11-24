'use client';

import { useEffect, useState } from 'react';
import WorkbenchHeader from './WorkbenchHeader';
import { api, formatBytes, formatDate } from './api';
import type { ResourceStats } from '@/lib/workspace-types';

interface Props {
  userName: string;
  liveModel: boolean;
}

export default function ResourcesClient({ userName, liveModel }: Props) {
  const [stats, setStats] = useState<ResourceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pickedMaterials, setPickedMaterials] = useState<string[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await api<{ resources: ResourceStats }>('/api/resources');
      setStats(data.resources);
    } catch (err) {
      setError(err instanceof Error ? err.message : '资源信息读取失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function cleanOrphans() {
    if (!stats || stats.orphanItems.length === 0) return;
    const ok = window.confirm(
      `将清理 ${stats.orphanItems.length} 个已删除活动的孤儿目录（约 ${formatBytes(stats.orphanBytes)}），文件不可恢复。\n\n系统只清理数据库中已不存在的活动目录，仍有效的数据不会被删除。确认继续？`
    );
    if (!ok) return;
    setMessage('');
    try {
      const result = await api<{ removed: number; bytes: number }>('/api/resources/orphans', {
        method: 'POST',
        body: JSON.stringify({ action: 'clean', ids: stats.orphanItems.map((item) => item.id) })
      });
      setMessage(`已清理 ${result.removed} 个目录，释放 ${formatBytes(result.bytes)}。`);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '清理失败');
    }
  }

  async function requestBatchDeletion() {
    if (!stats || pickedMaterials.length === 0) return;
    const reason = window.prompt(
      `将为选中的 ${pickedMaterials.length} 份素材发起删除申请。\n删除需要其他成员批准，批准前文件仍保留。\n\n请填写申请原因：`,
      '连续 7 天未使用，申请清理'
    );
    if (reason === null) return;
    setMessage('');
    setBatchBusy(true);
    let ok = 0;
    const failed: string[] = [];
    const names = new Map(stats.staleMaterials.map((item) => [item.id, item.name]));
    for (const id of pickedMaterials) {
      try {
        await api(`/api/materials/${id}/deletion`, {
          method: 'POST',
          body: JSON.stringify({ action: 'request', reason })
        });
        ok += 1;
      } catch (err) {
        failed.push(`${names.get(id) || id}：${err instanceof Error ? err.message : '失败'}`);
      }
    }
    setBatchBusy(false);
    setPickedMaterials([]);
    await load();
    setMessage(
      failed.length === 0
        ? `已发起 ${ok} 份删除申请，等待审批。批准前文件不会删除。`
        : `已发起 ${ok} 份删除申请；${failed.length} 份失败：${failed.slice(0, 3).join('；')}`
    );
  }

  async function resolveDeletion(id: string, action: 'approve' | 'reject') {
    setMessage('');
    try {
      await api(`/api/materials/${id}/deletion`, {
        method: 'POST',
        body: JSON.stringify({ action })
      });
      setMessage(action === 'approve' ? '已批准删除，文件已移除。' : '已拒绝删除请求。');
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '操作失败');
    }
  }

  const diskPercent = stats && stats.disk.total > 0 ? Math.round((stats.disk.used / stats.disk.total) * 100) : 0;
  const memoryPercent =
    stats && stats.memory.total > 0
      ? Math.round(((stats.memory.total - stats.memory.free) / stats.memory.total) * 100)
      : 0;

  return (
    <div className="app-shell wb-shell">
      <WorkbenchHeader userName={userName} liveModel={liveModel} current="resources" />

      <main className="wb-main wb-resource-page">
        <section className="wb-hero compact">
          <div>
            <h1>资源监控</h1>
            <p>服务器容量与内存只做告警，系统不会自动删除资料或自动终止任务。原始素材的清理必须经过人工审批。</p>
          </div>
          <button className="btn btn-sm" type="button" onClick={load} disabled={loading}>
            {loading ? '刷新中…' : '刷新'}
          </button>
        </section>

        {error ? <div className="wb-banner danger">{error}</div> : null}
        {message ? <div className="wb-banner">{message}</div> : null}
        {stats?.warnings.length ? (
          <div className="wb-banner warn">
            <strong>需要关注</strong>
            <ul>
              {stats.warnings.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <section className="wb-resource-grid">
          <article className="wb-resource-card">
            <div className="wb-resource-head">
              <h2>磁盘</h2>
              <span>{diskPercent}% 已用</span>
            </div>
            <div className="wb-progress large">
              <span style={{ width: `${diskPercent}%` }} />
            </div>
            <dl>
              <div>
                <dt>总容量</dt>
                <dd>{formatBytes(stats?.disk.total || 0)}</dd>
              </div>
              <div>
                <dt>剩余</dt>
                <dd>{formatBytes(stats?.disk.free || 0)}</dd>
              </div>
              <div>
                <dt>素材占用</dt>
                <dd>{formatBytes(stats?.storageUsed || 0)}（{stats?.materialCount || 0} 份）</dd>
              </div>
              <div>
                <dt>数据目录</dt>
                <dd className="mono">{stats?.dataDir || '-'}</dd>
              </div>
            </dl>
          </article>

          <article className="wb-resource-card">
            <div className="wb-resource-head">
              <h2>内存</h2>
              <span>{memoryPercent}% 已用</span>
            </div>
            <div className="wb-progress large">
              <span style={{ width: `${memoryPercent}%` }} />
            </div>
            <dl>
              <div>
                <dt>系统总内存</dt>
                <dd>{formatBytes(stats?.memory.total || 0)}</dd>
              </div>
              <div>
                <dt>当前可用</dt>
                <dd>{formatBytes(stats?.memory.free || 0)}</dd>
              </div>
              <div>
                <dt>进程占用</dt>
                <dd>{formatBytes(stats?.memory.rss || 0)}</dd>
              </div>
              <div>
                <dt>告警阈值</dt>
                <dd>{stats?.thresholds.memoryWarnPercent || 85}%</dd>
              </div>
            </dl>
          </article>

          <article className="wb-resource-card">
            <div className="wb-resource-head">
              <h2>素材留存</h2>
              <span>{stats?.staleCount || 0} 份 7 天未调用</span>
            </div>
            <p className="wb-muted">
              连续 7 天未被调用的原始素材会在资料库中出现留存提示；是否删除由机构成员审批，系统不自动清理。
            </p>
            <dl>
              <div>
                <dt>素材总数</dt>
                <dd>{stats?.materialCount || 0} 份</dd>
              </div>
              <div>
                <dt>待删除审批</dt>
                <dd>{stats?.deletionPending || 0} 份</dd>
              </div>
              <div>
                <dt>告警阈值</dt>
                <dd>{formatBytes(stats?.thresholds.storageWarnBytes || 0)}</dd>
              </div>
            </dl>
            <a className="btn btn-sm" href="/activities">
              去活动列表
            </a>
          </article>

          <article className="wb-resource-card">
            <div className="wb-resource-head">
              <h2>本月 AI 用量</h2>
              <span>{stats?.aiUsage.monthRuns || 0} 次调用</span>
            </div>
            <p className="wb-muted">
              按成稿字符估算 token 与费用，单价由环境变量 AI_COST_PER_1K_TOKENS 配置；仅作预算参考。
            </p>
            <dl>
              <div>
                <dt>成功生成</dt>
                <dd>{stats?.aiUsage.monthSuccess || 0} 次</dd>
              </div>
              <div>
                <dt>估算 token</dt>
                <dd>{(stats?.aiUsage.monthTokens || 0).toLocaleString()}</dd>
              </div>
              <div>
                <dt>估算费用</dt>
                <dd>¥{(stats?.aiUsage.monthCost || 0).toFixed(2)}</dd>
              </div>
              <div>
                <dt>月度预算</dt>
                <dd>¥{stats?.aiUsage.monthlyBudget || 0}</dd>
              </div>
            </dl>
          </article>

          <article className="wb-resource-card">
            <div className="wb-resource-head">
              <h2>孤儿目录</h2>
              <span>{stats?.orphanCount || 0} 个</span>
            </div>
            <p className="wb-muted">
              活动删除后若磁盘目录清理失败，会残留为孤儿目录。系统不会自动删除，需人工确认后清理。
            </p>
            <dl>
              <div>
                <dt>目录数量</dt>
                <dd>{stats?.orphanCount || 0} 个</dd>
              </div>
              <div>
                <dt>占用空间</dt>
                <dd>{formatBytes(stats?.orphanBytes || 0)}</dd>
              </div>
            </dl>
            <button
              className="btn btn-sm btn-danger"
              type="button"
              onClick={cleanOrphans}
              disabled={!stats || stats.orphanItems.length === 0}
            >
              确认清理孤儿目录
            </button>
          </article>
        </section>

        {stats?.orphanItems.length ? (
          <section className="wb-panel">
            <div className="wb-panel-head">
              <h2>孤儿目录明细</h2>
              <span>仅列出数据库中已不存在的活动</span>
            </div>
            <p className="wb-muted">清理前会重新扫描校验，确认后不可恢复。</p>
            <ul className="wb-deletion-list">
              {stats.orphanItems.map((item) => (
                <li key={`${item.kind}-${item.id}`}>
                  <div>
                    <strong className="mono">{item.id}</strong>
                    <span>{item.kind === 'poster' ? '海报目录' : '素材目录'}</span>
                  </div>
                  <div className="wb-deletion-actions">
                    <span className="wb-muted">
                      {item.files} 个文件 · {formatBytes(item.bytes)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {stats?.staleMaterials.length ? (
          <section className="wb-panel">
            <div className="wb-panel-head">
              <h2>7 天未使用的素材</h2>
              <span>共 {stats.staleCount} 份，列出最近 {stats.staleMaterials.length} 份</span>
            </div>
            <p className="wb-muted">
              可勾选后批量发起删除申请；删除必须经人工审批，批准前文件仍保留，系统不会自动删除。
            </p>
            <div className="wb-deletion-actions" style={{ marginBottom: 8 }}>
              <label className="wb-muted">
                <input
                  type="checkbox"
                  checked={pickedMaterials.length === stats.staleMaterials.length && stats.staleMaterials.length > 0}
                  onChange={(event) =>
                    setPickedMaterials(event.target.checked ? stats.staleMaterials.map((item) => item.id) : [])
                  }
                />{' '}
                全选本页
              </label>
              <button
                className="btn btn-sm btn-danger"
                type="button"
                onClick={() => void requestBatchDeletion()}
                disabled={pickedMaterials.length === 0 || batchBusy}
              >
                {batchBusy ? '提交中…' : `批量发起删除申请（${pickedMaterials.length}）`}
              </button>
            </div>
            <ul className="wb-deletion-list">
              {stats.staleMaterials.map((item) => (
                <li key={item.id}>
                  <div>
                    <label>
                      <input
                        type="checkbox"
                        checked={pickedMaterials.includes(item.id)}
                        onChange={(event) =>
                          setPickedMaterials((prev) =>
                            event.target.checked ? [...prev, item.id] : prev.filter((id) => id !== item.id)
                          )
                        }
                      />{' '}
                      <strong>{item.name}</strong>
                    </label>
                    <span>
                      {item.activityTitle} · {item.uploadedByName} 上传 · 最近使用 {formatDate(item.lastUsedAt || item.createdAt)}
                    </span>
                  </div>
                  <div className="wb-deletion-actions">
                    <a className="link-btn" href={`/activity/${item.activityId}?materials=1`}>
                      去资料库处理
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="wb-panel">
          <div className="wb-panel-head">
            <h2>待审批的删除请求</h2>
            <span>删除批准后文件不可恢复</span>
          </div>
          <p className="wb-muted">删除请求在各活动工作台的资料库中发起；批准前文件仍保留。</p>
          {stats?.pendingDeletions.length ? (
            <ul className="wb-deletion-list">
              {stats.pendingDeletions.map((item) => (
                <li key={item.id}>
                  <div>
                    <strong>{item.name}</strong>
                    <span>
                      {item.uploadedByName} 上传 · {item.requestedByName} 申请 · {formatDate(item.requestedAt)}
                    </span>
                    {item.reason ? <em>原因：{item.reason}</em> : null}
                  </div>
                  <div className="wb-deletion-actions">
                    <a className="link-btn" href={`/activity/${item.activityId}`}>
                      去活动
                    </a>
                    <button className="btn btn-sm" type="button" onClick={() => resolveDeletion(item.id, 'reject')}>
                      拒绝
                    </button>
                    <button className="btn btn-sm btn-danger" type="button" onClick={() => resolveDeletion(item.id, 'approve')}>
                      批准删除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="wb-muted">当前没有待审批的删除请求。</p>
          )}
          <p className="wb-muted">最近刷新：{formatDate(new Date().toISOString())}</p>
        </section>
      </main>
    </div>
  );
}
