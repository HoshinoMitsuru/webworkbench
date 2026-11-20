import type { ActivityEditMeta, SaveState } from '@/lib/api-types';
import { formatTime } from '@/lib/studio-format';

interface ActivityPanelHeadProps {
  activityName: string;
  currentId: string | null;
  meta: ActivityEditMeta | null;
  dirty: boolean;
  saveState: SaveState;
  onSave: () => void;
}

function saveStateLabel(saveState: SaveState, dirty: boolean, currentId: string | null): string {
  if (saveState === 'saving') return '保存中…';
  if (saveState === 'error') return '保存失败';
  if (dirty) return '有未保存改动';
  return currentId ? '已同步到活动库' : '未保存';
}

export default function ActivityPanelHead({
  activityName,
  currentId,
  meta,
  dirty,
  saveState,
  onSave
}: ActivityPanelHeadProps) {
  return (
    <div className="panel-head">
      <div className="panel-head-row">
        <div>
          <h2>活动资料</h2>
          <p>缺项也能生成，缺的字段会显示为「待补充」。</p>
        </div>
        <div className="panel-head-actions">
          <span className={`save-state${dirty ? ' dirty' : ''}${saveState === 'error' ? ' error' : ''}`}>
            {saveStateLabel(saveState, dirty, currentId)}
          </span>
          <button type="button" className="btn btn-ghost btn-small" onClick={onSave} disabled={saveState === 'saving'}>
            {currentId ? '保存' : '保存到活动库'}
          </button>
        </div>
      </div>
      <div className="meta-line">
        {currentId && meta
          ? `当前：${activityName || '未命名活动'} · 最后编辑 ${meta.updatedByName} · ${formatTime(meta.updatedAt)}`
          : '生成后会先自动保存到共享活动库，机构内成员都能打开继续编辑。'}
      </div>
    </div>
  );
}
