/**
 * 轻量合规用词自检：在生成与提交前提示绝对化用语、承诺性表述。
 * 只做提示，不替代人工审核；词表可按机构要求继续补充。
 */
interface WordRule {
  token: string;
  reason: string;
}

const RULES: WordRule[] = [
  { token: '最好', reason: '合规提示：绝对化用语，建议改为可核实的具体表述' },
  { token: '最佳', reason: '合规提示：绝对化用语，建议改为可核实的具体表述' },
  { token: '最优', reason: '合规提示：绝对化用语，建议改为可核实的具体表述' },
  { token: '最强', reason: '合规提示：绝对化用语，建议改为可核实的具体表述' },
  { token: '顶级', reason: '合规提示：绝对化用语，建议改为可核实的具体表述' },
  { token: '极致', reason: '合规提示：绝对化用语，建议改为可核实的具体表述' },
  { token: '国家级', reason: '合规提示：资质类绝对化表述，需有正式认定依据' },
  { token: '世界级', reason: '合规提示：资质类绝对化表述，需有正式认定依据' },
  { token: '全国第一', reason: '合规提示：排名类绝对化表述，需有权威依据' },
  { token: '行业第一', reason: '合规提示：排名类绝对化表述，需有权威依据' },
  { token: '排名第一', reason: '合规提示：排名类绝对化表述，需有权威依据' },
  { token: '唯一', reason: '合规提示：排他性表述，建议改为可核实的范围描述' },
  { token: '独家', reason: '合规提示：排他性表述，建议改为可核实的范围描述' },
  { token: '百分百', reason: '合规提示：承诺性表述，公益内容不宜作出结果保证' },
  { token: '100%', reason: '合规提示：承诺性表述，公益内容不宜作出结果保证' },
  { token: '保证', reason: '合规提示：承诺性表述，公益内容不宜作出结果保证' },
  { token: '承诺', reason: '合规提示：承诺性表述，请确认有明确依据并写明边界' },
  { token: '保过', reason: '合规提示：结果承诺，公益内容不宜出现' },
  { token: '包过', reason: '合规提示：结果承诺，公益内容不宜出现' },
  { token: '保送', reason: '合规提示：结果承诺，公益内容不宜出现' },
  { token: '包就业', reason: '合规提示：结果承诺，公益内容不宜出现' },
  { token: '包录取', reason: '合规提示：结果承诺，公益内容不宜出现' },
  { token: '稳赚', reason: '合规提示：收益承诺，公益内容不宜出现' },
  { token: '保本', reason: '合规提示：收益承诺，公益内容不宜出现' },
  { token: '零风险', reason: '合规提示：风险承诺，建议改为客观说明' },
  { token: '无风险', reason: '合规提示：风险承诺，建议改为客观说明' },
  { token: '治愈', reason: '合规提示：医疗效果表述，需专业依据并避免夸大' },
  { token: '根治', reason: '合规提示：医疗效果表述，需专业依据并避免夸大' },
  { token: '包治', reason: '合规提示：医疗效果表述，公益内容不宜出现' },
  { token: '永久有效', reason: '合规提示：期限类绝对化表述，建议写明具体周期' }
];

export function checkSensitiveWords(text: string, limit = 20): Array<{ token: string; reason: string }> {
  if (!text) return [];
  const found: Array<{ token: string; reason: string }> = [];
  const seen = new Set<string>();
  for (const rule of RULES) {
    if (found.length >= limit) break;
    if (!text.includes(rule.token) || seen.has(rule.token)) continue;
    seen.add(rule.token);
    found.push({ token: rule.token, reason: rule.reason });
  }
  return found;
}
