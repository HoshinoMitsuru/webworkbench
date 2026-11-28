'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';

interface Props {
  userName: string;
  liveModel: boolean;
  current?: 'activities' | 'resources' | 'admin';
  right?: React.ReactNode;
}

export default function WorkbenchHeader({ userName, liveModel, current, right }: Props) {
  const [leaving, setLeaving] = useState(false);
  const pathname = usePathname();
  // 仅在单个活动页（/activity/<id>）显示画布入口；画布页自身不重复显示
  const activityMatch = pathname ? pathname.match(/^\/activity\/([^/]+)$/) : null;

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
        {activityMatch ? (
          <a href={`/activity/${activityMatch[1]}/canvas`}>画布视图</a>
        ) : null}
        <a className={current === 'resources' ? 'active' : ''} href="/resources">
          资源监控
        </a>
        <a className={current === 'admin' ? 'active' : ''} href="/admin">
          运维
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
