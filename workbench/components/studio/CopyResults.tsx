import type { ActivityInput, AudienceBlock, BlockKey, GenerateResponse } from '@/lib/types';
import type { GenerateStatus, RewriteTarget } from '@/lib/api-types';
import AudienceCard from './AudienceCard';
import BlockActions from './BlockActions';
import GenerateProgress from './GenerateProgress';
import HighlightedText from './HighlightedText';
import ResultCard from './ResultCard';
import SubBlock from './SubBlock';

interface CopyResultsProps {
  activity: ActivityInput;
  results: GenerateResponse | null;
  audience: AudienceBlock | null;
  status: GenerateStatus;
  step: number;
  notice: string;
  error: string;
  warningTokens: string[];
  exampleAvailable: boolean;
  rewriting: RewriteTarget | null;
  copied: string | null;
  onGenerateAudience: () => void;
  onRewrite: (key: BlockKey, text: string, instruction: string) => void;
  onCopy: (key: string, text: string) => void;
}

export default function CopyResults({
  activity,
  results,
  audience,
  status,
  step,
  notice,
  error,
  warningTokens,
  exampleAvailable,
  rewriting,
  copied,
  onGenerateAudience,
  onRewrite,
  onCopy
}: CopyResultsProps) {
  const renderBody = (text: string) => <HighlightedText text={text} tokens={warningTokens} />;
  const renderActions = (key: BlockKey, text: string, copyPayload = text) => (
    <BlockActions
      blockKey={key}
      text={text}
      copyPayload={copyPayload}
      busy={rewriting === key}
      disabled={Boolean(rewriting)}
      copied={copied === key}
      onRewrite={onRewrite}
      onCopy={onCopy}
    />
  );

  return (
    <>
      {status === 'loading' ? <GenerateProgress step={step} /> : null}

      {notice ? <div className="notice">{notice}</div> : null}
      {error ? <div className="notice warn">{error}</div> : null}
      {warningTokens.length > 0 ? (
        <div className="warning-box">
          <strong>事实回查：以下内容未在资料中找到，请逐项核对后再发布</strong>
          <div className="warning-list">
            {warningTokens.map((token) => (
              <code key={token}>{token}</code>
            ))}
          </div>
        </div>
      ) : null}

      {!results && status !== 'loading' ? (
        <div className="panel">
          <div className="empty-state">
            <div className="empty-icon">文</div>
            <h3>右侧会放生成结果</h3>
            <p>
              填好左侧资料，点「生成内容」，这里会出现公众号推文、小红书笔记和社群话术。
              {exampleAvailable ? (
                <>
                  <br />
                  第一次用可以点「载入示例资料」直接看效果。
                </>
              ) : null}
            </p>
          </div>
        </div>
      ) : null}

      {results ? (
        <>
          <div className="panel">
            <div className="result-head">
              <h2>生成结果</h2>
              <span className="count">{results.mode === 'demo' ? '演示模式模板稿' : '模型生成草稿'}</span>
              <div className="spacer" />
              <span className="chip">AI 生成，发布前需人工核对</span>
            </div>
            <div className="panel-body">
              <div className="poster-meta">
                已按「{activity.postType === 'recruit' ? '招募' : '回顾'}」生成。所有结果都是草稿，时间、地点、报名方式请对照原文逐项确认。
              </div>
            </div>
          </div>

          <ResultCard
            title="公众号推文"
            tag={activity.postType === 'recruit' ? '招募' : '回顾'}
            tagAccent={activity.postType === 'recruit'}
            actions={renderActions(
              'article',
              results.article.body,
              `${results.article.title}\n\n${results.article.body}`
            )}
          >
            <div className="result-body">
              <h4>{results.article.title}</h4>
              {renderBody(results.article.body)}
            </div>
          </ResultCard>

          <ResultCard
            title="小红书笔记"
            tag="标题 + 正文 + 标签"
            actions={renderActions(
              'note',
              results.note.body,
              `${results.note.title}\n\n${results.note.body}\n\n${results.note.tags.join(' ')}`
            )}
          >
            <div className="result-body">
              <h4>{results.note.title}</h4>
              {renderBody(results.note.body)}
            </div>
            {results.note.tags.length > 0 ? (
              <div className="result-tags">
                {results.note.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            ) : null}
          </ResultCard>

          <ResultCard title="社群与朋友圈话术" tag="短文案">
            <SubBlock title="朋友圈版" actions={renderActions('social.moments', results.social.moments)}>
              {renderBody(results.social.moments)}
            </SubBlock>
            <SubBlock title="社群版" actions={renderActions('social.group', results.social.group)}>
              {renderBody(results.social.group)}
            </SubBlock>
          </ResultCard>

          <AudienceCard
            audience={audience}
            busy={rewriting === 'audience'}
            onGenerate={onGenerateAudience}
            renderActions={renderActions}
            renderBody={renderBody}
          />
        </>
      ) : null}
    </>
  );
}
