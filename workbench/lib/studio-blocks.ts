import type { AudienceBlock, BlockKey, GenerateResponse } from '@/lib/types';

export interface BlockRewriteResult {
  results: GenerateResponse | null;
  audience: AudienceBlock | null;
}

/** 只替换被改写的单个区块，其余内容原样保留 */
export function applyBlockRewrite(
  results: GenerateResponse | null,
  audience: AudienceBlock | null,
  key: BlockKey,
  text: string
): BlockRewriteResult {
  let nextResults = results;
  if (results) {
    if (key === 'article') nextResults = { ...results, article: { ...results.article, body: text } };
    else if (key === 'note') nextResults = { ...results, note: { ...results.note, body: text } };
    else if (key === 'social.moments') nextResults = { ...results, social: { ...results.social, moments: text } };
    else if (key === 'social.group') nextResults = { ...results, social: { ...results.social, group: text } };
  }

  let nextAudience = audience;
  if (audience) {
    if (key === 'audience.student') nextAudience = { ...audience, student: text };
    else if (key === 'audience.public') nextAudience = { ...audience, public: text };
    else if (key === 'audience.press') nextAudience = { ...audience, press: text };
  }

  return { results: nextResults, audience: nextAudience };
}
