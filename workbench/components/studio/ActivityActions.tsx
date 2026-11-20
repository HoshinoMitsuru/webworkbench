'use client';

import { useRef } from 'react';
import type { GenerateStatus } from '@/lib/api-types';

interface ActivityActionsProps {
  status: GenerateStatus;
  paused: boolean;
  exampleAvailable: boolean;
  exampleBusy: boolean;
  onGenerate: () => void;
  onAbort: () => void;
  onFillExample: () => void;
  onImportFile: (file: File | undefined) => void;
  onClear: () => void;
}

export default function ActivityActions({
  status,
  paused,
  exampleAvailable,
  exampleBusy,
  onGenerate,
  onAbort,
  onFillExample,
  onImportFile,
  onClear
}: ActivityActionsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loading = status === 'loading';

  return (
    <>
      <div className="form-actions">
        <button type="button" className="btn btn-primary" onClick={onGenerate} disabled={loading || paused}>
          {loading ? (
            <>
              <span className="spinner" />
              生成中…
            </>
          ) : (
            '生成内容'
          )}
        </button>
        {loading ? (
          <button type="button" className="btn btn-ghost" onClick={onAbort}>
            中止
          </button>
        ) : null}
      </div>

      <div className="form-actions" style={{ marginTop: 8 }}>
        {exampleAvailable ? (
          <button type="button" className="btn btn-ghost btn-small" onClick={onFillExample} disabled={exampleBusy}>
            {exampleBusy ? '载入中…' : '载入示例资料'}
          </button>
        ) : null}
        <button type="button" className="btn btn-ghost btn-small" onClick={() => fileInputRef.current?.click()}>
          导入方案文本
        </button>
        <button type="button" className="btn btn-ghost btn-small" onClick={onClear}>
          清除全部
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md,text/plain,text/markdown"
          hidden
          onChange={(event) => {
            onImportFile(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </div>
    </>
  );
}
