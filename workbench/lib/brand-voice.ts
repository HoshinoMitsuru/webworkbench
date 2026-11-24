import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_PATH = path.join(process.cwd(), 'content', 'brand-voice.md');

let cache: { mtimeMs: number; text: string } | null = null;

export function brandVoicePath(): string {
  return process.env.BRAND_VOICE_PATH || DEFAULT_PATH;
}

/**
 * 读取机构语气库。只作为风格参考注入系统提示，事实仍以活动资料为准。
 * 文件不存在或不可读时返回空字符串，不阻断生成。
 */
export function loadBrandVoice(maxChars = 5000): string {
  const filePath = brandVoicePath();
  try {
    const stat = fs.statSync(filePath);
    if (!cache || cache.mtimeMs !== stat.mtimeMs) {
      cache = { mtimeMs: stat.mtimeMs, text: fs.readFileSync(filePath, 'utf8').trim() };
    }
    return cache.text.slice(0, maxChars);
  } catch {
    return '';
  }
}

export function brandVoiceStatus(): { path: string; exists: boolean; chars: number } {
  const filePath = brandVoicePath();
  try {
    const text = fs.readFileSync(filePath, 'utf8').trim();
    return { path: filePath, exists: true, chars: text.length };
  } catch {
    return { path: filePath, exists: false, chars: 0 };
  }
}
