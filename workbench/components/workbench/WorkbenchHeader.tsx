'use client';

import { useState } from 'react';

interface Props {
  userName: string;
  liveModel: boolean;
  current?: 'activities' | 'resources';
  right?: React.ReactNode;
}

export default function WorkbenchHeader({ userName, liveModel, current, right }: Props) {
  const [leaving, setLeaving] = useState(false);

  async function logout() {
    setLeaving(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      window.location.href = '/login';
    }
  }

  return (
    <header className="topbar wb-topbar">
      <a className="wb-brand" href="/activities">
        <span className="brandmark" aria-hidden="true" />
        <span>
          <span className="brand-name">C公益 · 活动工作台</span>
          <span className="brand-sub">ACTIVITY CONTENT WORKBENCH</span>
        </span>
      </a>

      <nav className="wb-nav">
        <a className={current === 'activities' ? 'active' : ''} href="/activities">
          活动列表
        </a>
        <a className={current === 'resources' ? 'active' : ''} href="/resources">
          资源监控
        </a>
        <a href="/studio">完整编辑</a>
        <a href="/help" target="_blank" rel="noreferrer">
          使用说明
        </a>
      </nav>

      <div className="spacer" />

      {right}

      <div className="topbar-meta">
        <span className={`chip ${liveModel ? 'chip-live' : 'chip-demo'}`}>
          <span className="chip-dot" />
          {liveModel ? '已接入模型' : '演示模式'}
        </span>
        <span className="chip" title="当前登录账号">
          {userName}
        </span>
        <button className="link-btn" type="button" onClick={logout} disabled={leaving}>
          {leaving ? '退出中…' : '退出'}
        </button>
      </div>
    </header>
  );
}
