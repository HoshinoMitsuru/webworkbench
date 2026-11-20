import type { ActivityRecord } from '@/lib/api-types';
import { formatTime } from '@/lib/studio-format';

interface ConflictBoxProps {
  conflict: ActivityRecord;
  onLoadLatest: () => void;
  onOverwrite: () => void;
}

export default function ConflictBox({ conflict, onLoadLatest, onOverwrite }: ConflictBoxProps) {
  return (
    <div className="conflict-box">
      <strong>这条活动已被 {conflict.updatedByName} 更新</strong>
      <p>
        服务器上是 {formatTime(conflict.updatedAt)} 的版本，你的改动还没有保存。可以载入最新版本，或用自己的版本覆盖。
      </p>
      <div className="form-actions">
        <button type="button" className="btn btn-ghost btn-small" onClick={onLoadLatest}>
          载入最新版本
        </button>
        <button type="button" className="btn btn-primary btn-small" onClick={onOverwrite}>
          用我的版本覆盖
        </button>
      </div>
    </div>
  );
}
