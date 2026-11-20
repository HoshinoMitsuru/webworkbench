import type { ReactNode } from 'react';

interface ResultCardProps {
  title: string;
  tag?: string;
  tagAccent?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}

export default function ResultCard({ title, tag, tagAccent, actions, children }: ResultCardProps) {
  return (
    <article className="result-card">
      <div className="result-card-head">
        <h3>{title}</h3>
        {tag ? <span className={`tag${tagAccent ? ' tag-accent' : ''}`}>{tag}</span> : null}
        <div className="spacer" />
        {actions}
      </div>
      {children}
    </article>
  );
}
