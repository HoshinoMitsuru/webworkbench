import type { ReactNode } from 'react';
import type { AudienceBlock, BlockKey } from '@/lib/types';
import ResultCard from './ResultCard';
import SubBlock from './SubBlock';

interface AudienceCardProps {
  audience: AudienceBlock | null;
  busy: boolean;
  onGenerate: () => void;
  renderActions: (key: BlockKey, text: string) => ReactNode;
  renderBody: (text: string) => ReactNode;
}

export default function AudienceCard({
  audience,
  busy,
  onGenerate,
  renderActions,
  renderBody
}: AudienceCardProps) {
  return (
    <ResultCard
      title="受众改写三版"
      tag="学生 / 公众 / 新闻稿"
      actions={
        <button type="button" className="action-btn" onClick={onGenerate} disabled={busy}>
          {busy ? '生成中…' : audience ? '重新生成' : '生成三版'}
        </button>
      }
    >
      {!audience ? (
        <div className="empty-state" style={{ padding: '24px 20px' }}>
          <p>同一份资料，分别改写成学生版、公众版和新闻稿版，避免三处重复劳动。</p>
        </div>
      ) : (
        <>
          <SubBlock title="学生版" actions={renderActions('audience.student', audience.student)}>
            {renderBody(audience.student)}
          </SubBlock>
          <SubBlock title="公众版" actions={renderActions('audience.public', audience.public)}>
            {renderBody(audience.public)}
          </SubBlock>
          <SubBlock title="新闻稿版" actions={renderActions('audience.press', audience.press)}>
            {renderBody(audience.press)}
          </SubBlock>
        </>
      )}
    </ResultCard>
  );
}
