import { SYSTEM_PROMPT } from './prompts';

const DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

export function isLiveModel(): boolean {
  return Boolean(process.env.ARK_API_KEY && process.env.ARK_MODEL) && process.env.DEMO_MODE !== '1';
}

interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
}

async function chat(prompt: string, options: ChatOptions = {}): Promise<string> {
  const baseUrl = (process.env.ARK_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  const timeoutMs = Number(process.env.AI_TIMEOUT_MS || 90_000);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.ARK_API_KEY}`
      },
      body: JSON.stringify({
        model: process.env.ARK_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ],
        temperature: options.temperature ?? 0.6,
        max_tokens: options.maxTokens ?? 3000
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new Error(`模型调用超过 ${Math.round(timeoutMs / 1000)} 秒未返回，已自动中止，请重试。`);
    }
    throw error;
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`模型调用失败（${response.status}）${detail ? `：${detail.slice(0, 200)}` : ''}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('模型返回为空，请稍后重试');
  return content;
}

function extractJson(raw: string): unknown {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error('模型返回的内容不是有效 JSON，请重试');
  }
}

export async function chatJson<T>(prompt: string): Promise<T> {
  const raw = await chat(prompt, { temperature: 0.5 });
  return extractJson(raw) as T;
}

export async function chatText(prompt: string): Promise<string> {
  return chat(prompt, { temperature: 0.5, maxTokens: 1600 });
}
