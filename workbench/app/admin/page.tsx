import { redirect } from 'next/navigation';
import WorkbenchHeader from '@/components/workbench/WorkbenchHeader';
import { getSessionUser } from '@/lib/current-user';
import { getDb } from '@/lib/db';
import { isLiveModel } from '@/lib/ark';
import { listConfigVersions } from '@/lib/ai-config';
import { brandVoiceStatus } from '@/lib/brand-voice';

export const dynamic = 'force-dynamic';

function formatDateTime(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const db = getDb();
  const users = db
    .prepare('SELECT username, name, created_at, last_login_at FROM users ORDER BY created_at ASC')
    .all() as Array<{ username: string; name: string; created_at: string; last_login_at: string | null }>;
  const runs = db
    .prepare(
      `SELECT r.created_at, r.status, r.mode, r.model, r.operator_name, r.ms, r.chars, r.tokens, r.cost, r.error,
              a.title AS activity_title, t.title AS task_title
       FROM ai_runs r
       LEFT JOIN activities a ON a.id = r.activity_id
       LEFT JOIN tasks t ON t.id = r.task_id
       ORDER BY r.created_at DESC LIMIT 30`
    )
    .all() as Array<{
    created_at: string;
    status: string;
    mode: string;
    model: string;
    operator_name: string;
    ms: number;
    chars: number;
    tokens: number;
    cost: number;
    error: string;
    activity_title: string | null;
    task_title: string | null;
  }>;
  const audits = db
    .prepare('SELECT at, user_name, action, target, detail FROM audit ORDER BY id DESC LIMIT 40')
    .all() as Array<{ at: string; user_name: string; action: string; target: string; detail: string }>;
  const configs = listConfigVersions();
  const voice = brandVoiceStatus();

  const configRows: Array<[string, string]> = [
    ['运行模式', isLiveModel() ? '已接入方舟模型' : '演示模式'],
    ['模型名称', process.env.ARK_MODEL || '未配置'],
    ['API Key', process.env.ARK_API_KEY ? '已配置（不显示）' : '未配置'],
    ['数据目录', process.env.DATA_DIR || '默认 data/'],
    ['生成暂停', process.env.PAUSED === '1' ? '是（PAUSED=1）' : '否'],
    ['费用单价', `${process.env.AI_COST_PER_1K_TOKENS || '0'} 元 / 1K tokens`],
    ['月度预算', `${process.env.AI_MONTHLY_BUDGET_CNY || '100'} 元`],
    ['语气库文件', `${voice.path}（${voice.exists ? `${voice.chars} 字` : '未找到'}）`]
  ];

  return (
    <div className="app-shell wb-shell">
      <WorkbenchHeader userName={user.name} liveModel={isLiveModel()} current="admin" />

      <main className="wb-main wb-resource-page">
        <section className="wb-hero compact">
          <div>
            <h1>运维只读页</h1>
            <p>仅供查看账号、运行配置、提示词版本与运行日志，不提供修改入口；配置变更请走服务器环境变量。</p>
          </div>
        </section>

        <section className="wb-resource-grid">
          <article className="wb-resource-card">
            <div className="wb-resource-head">
              <h2>运行配置</h2>
              <span>只读</span>
            </div>
            <dl>
              {configRows.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd className="mono">{value}</dd>
                </div>
              ))}
            </dl>
          </article>

          <article className="wb-resource-card">
            <div className="wb-resource-head">
              <h2>账号</h2>
              <span>{users.length} 个</span>
            </div>
            <ul className="wb-admin-list">
              {users.map((item) => (
                <li key={item.username}>
                  <strong>{item.name}</strong>
                  <span className="mono">{item.username}</span>
                  <em>
                    创建 {formatDateTime(item.created_at)} · 最近登录 {formatDateTime(item.last_login_at)}
                  </em>
                </li>
              ))}
            </ul>
          </article>

          <article className="wb-resource-card">
            <div className="wb-resource-head">
              <h2>提示词 / 模型版本</h2>
              <span>{configs.length} 条</span>
            </div>
            {configs.length === 0 ? (
              <p className="wb-muted">尚无生成记录。首次生成时会自动登记当前提示词与模型组合。</p>
            ) : (
              <ul className="wb-admin-list">
                {configs.map((item) => (
                  <li key={item.id}>
                    <strong className="mono">{item.version}</strong>
                    <span>{item.model || 'demo'}</span>
                    <em>
                      {formatDateTime(item.createdAt)} · {item.note}
                    </em>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </section>

        <section className="wb-panel">
          <div className="wb-panel-head">
            <h2>近期 AI 运行</h2>
            <span>最近 30 条</span>
          </div>
          <div className="wb-admin-table-wrap">
            <table className="wb-admin-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>活动 / 任务</th>
                  <th>状态</th>
                  <th>模式</th>
                  <th>耗时</th>
                  <th>字符</th>
                  <th>估算费用</th>
                  <th>操作人</th>
                  <th>错误</th>
                </tr>
              </thead>
              <tbody>
                {runs.length === 0 ? (
                  <tr>
                    <td colSpan={9}>暂无运行记录。</td>
                  </tr>
                ) : (
                  runs.map((run, index) => (
                    <tr key={`${run.created_at}-${index}`}>
                      <td>{formatDateTime(run.created_at)}</td>
                      <td>
                        {run.activity_title || '-'}
                        <em>{run.task_title || ''}</em>
                      </td>
                      <td>{run.status}</td>
                      <td>{run.mode}</td>
                      <td>{Math.round(run.ms / 1000)}s</td>
                      <td>{run.chars}</td>
                      <td>¥{run.cost.toFixed(4)}</td>
                      <td>{run.operator_name}</td>
                      <td className="wb-admin-error">{run.error}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="wb-panel">
          <div className="wb-panel-head">
            <h2>近期审计</h2>
            <span>最近 40 条</span>
          </div>
          <div className="wb-admin-table-wrap">
            <table className="wb-admin-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>操作人</th>
                  <th>动作</th>
                  <th>对象</th>
                  <th>详情</th>
                </tr>
              </thead>
              <tbody>
                {audits.length === 0 ? (
                  <tr>
                    <td colSpan={5}>暂无审计记录。</td>
                  </tr>
                ) : (
                  audits.map((item, index) => (
                    <tr key={`${item.at}-${index}`}>
                      <td>{formatDateTime(item.at)}</td>
                      <td>{item.user_name}</td>
                      <td className="mono">{item.action}</td>
                      <td className="mono">{item.target}</td>
                      <td>{item.detail}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
