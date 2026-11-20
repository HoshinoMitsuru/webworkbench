interface TopBarProps {
  liveModel: boolean;
  userName: string;
  libraryCount: number;
  onOpenLibrary: () => void;
  onLogout: () => void;
}

export default function TopBar({ liveModel, userName, libraryCount, onOpenLibrary, onLogout }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="brandmark" aria-hidden="true" />
      <div>
        <div className="brand-name">C公益 · 内容工作台</div>
        <div className="brand-sub">CONTENT WORKBENCH · 内部使用</div>
      </div>
      <div className="spacer" />
      <div className="topbar-meta">
        <span className="chip">
          <span className="chip-dot" />
          内部使用，不对外
        </span>
        <span className={`chip ${liveModel ? 'chip-live' : 'chip-demo'}`}>
          <span className="chip-dot" />
          {liveModel ? '已接入模型' : '演示模式'}
        </span>
        <span className="chip chip-always">
          <span className="chip-dot" />
          AI 生成，发布前需人工核对
        </span>
        <button className="link-btn" type="button" onClick={onOpenLibrary}>
          共享活动库{libraryCount > 0 ? `（${libraryCount}）` : ''}
        </button>
        <a className="link-btn" href="/help" target="_blank" rel="noreferrer">
          使用说明
        </a>
        <span className="chip chip-user" title="当前登录账号">
          {userName}
        </span>
        <button className="link-btn" type="button" onClick={onLogout}>
          退出
        </button>
      </div>
    </header>
  );
}
