import type { ActivityMeta } from '@/lib/api-types';
import { formatTime } from '@/lib/studio-format';

interface LibraryDrawerProps {
  open: boolean;
  items: ActivityMeta[];
  currentId: string | null;
  busy: boolean;
  error: string;
  onClose: () => void;
  onNew: () => void;
  onRefresh: () => void;
  onOpenActivity: (id: string) => void;
  onRemove: (id: string, title: string) => void;
}

export default function LibraryDrawer({
  open,
  items,
  currentId,
  busy,
  error,
  onClose,
  onNew,
  onRefresh,
  onOpenActivity,
  onRemove
}: LibraryDrawerProps) {
  if (!open) return null;

  return (
    <div className="drawer-overlay" role="presentation" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-label="共享活动库" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <h2>共享活动库</h2>
            <p>机构内所有成员都能查看、继续编辑和删除</p>
          </div>
          <button className="link-btn" type="button" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="drawer-actions">
          <button className="btn btn-primary btn-small" type="button" onClick={onNew}>
            新建活动
          </button>
          <button className="btn btn-ghost btn-small" type="button" onClick={onRefresh} disabled={busy}>
            {busy ? '读取中…' : '刷新'}
          </button>
        </div>

        {error ? <div className="notice warn">{error}</div> : null}

        <div className="drawer-list">
          {!busy && items.length === 0 ? (
            <p className="drawer-empty">活动库还是空的。填好左侧资料后点「保存到活动库」，这里就会出现。</p>
          ) : null}
          {items.map((item) => (
            <div key={item.id} className={`drawer-item${item.id === currentId ? ' active' : ''}`}>
              <button className="drawer-item-main" type="button" onClick={() => onOpenActivity(item.id)}>
                <span className="drawer-item-title">{item.title}</span>
                <span className="drawer-item-meta">
                  {item.updatedByName} 编辑 · {formatTime(item.updatedAt)}
                  {item.hasResults ? ' · 已有成稿' : ' · 仅资料'}
                </span>
              </button>
              <button className="drawer-item-del" type="button" onClick={() => onRemove(item.id, item.title)}>
                删除
              </button>
            </div>
          ))}
        </div>

        <div className="drawer-foot">
          同一活动多人先后编辑时，后保存的人会看到版本冲突提示，可选择载入对方版本或覆盖。
        </div>
      </aside>
    </div>
  );
}
