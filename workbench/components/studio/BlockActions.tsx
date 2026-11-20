import type { BlockKey } from '@/lib/types';
import { REWRITE_INSTRUCTIONS } from '@/lib/studio-config';

interface BlockActionsProps {
  blockKey: BlockKey;
  text: string;
  copyPayload?: string;
  busy: boolean;
  disabled: boolean;
  copied: boolean;
  onRewrite: (key: BlockKey, text: string, instruction: string) => void;
  onCopy: (key: string, text: string) => void;
}

export default function BlockActions({
  blockKey,
  text,
  copyPayload = text,
  busy,
  disabled,
  copied,
  onRewrite,
  onCopy
}: BlockActionsProps) {
  return (
    <div className="actions">
      <button
        className="action-btn"
        disabled={disabled}
        onClick={() => onRewrite(blockKey, text, REWRITE_INSTRUCTIONS.rewrite)}
      >
        {busy ? '修改中…' : '重写'}
      </button>
      <button
        className="action-btn"
        disabled={disabled}
        onClick={() => onRewrite(blockKey, text, REWRITE_INSTRUCTIONS.casual)}
      >
        更口语
      </button>
      <button
        className="action-btn"
        disabled={disabled}
        onClick={() => onRewrite(blockKey, text, REWRITE_INSTRUCTIONS.formal)}
      >
        更正式
      </button>
      <button
        className="action-btn"
        disabled={disabled}
        onClick={() => onRewrite(blockKey, text, REWRITE_INSTRUCTIONS.shorten)}
      >
        缩短
      </button>
      <button className="action-btn" onClick={() => onCopy(blockKey, copyPayload)}>
        {copied ? '已复制' : '复制'}
      </button>
    </div>
  );
}
