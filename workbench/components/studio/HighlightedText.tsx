import { escapeRegExp } from '@/lib/studio-format';

interface HighlightedTextProps {
  text: string;
  tokens: string[];
}

/** 把事实回查未命中的片段用 <mark> 标出，其余文本原样渲染 */
export default function HighlightedText({ text, tokens }: HighlightedTextProps) {
  if (tokens.length === 0) return <>{text}</>;

  const pattern = new RegExp(`(${tokens.map(escapeRegExp).join('|')})`, 'g');
  return (
    <>
      {text.split(pattern).map((part, index) =>
        tokens.includes(part) ? <mark key={index}>{part}</mark> : <span key={index}>{part}</span>
      )}
    </>
  );
}
