import type { ReactNode } from 'react';

interface SubBlockProps {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}

/** 结果卡内部的子区块（朋友圈版 / 社群版 / 三个受众版本） */
export default function SubBlock({ title, actions, children }: SubBlockProps) {
  return (
    <div className="sub-block">
      <div className="sub-block-head">
        <h4>{title}</h4>
        <div className="spacer" />
        {actions}
      </div>
      <div className="sub-block-body">{children}</div>
    </div>
  );
}
