import type { StudioTab } from '@/lib/api-types';

const TABS: Array<{ key: StudioTab; icon: string; label: string; desc: string }> = [
  { key: 'copy', icon: '文', label: '文案', desc: '推文 / 笔记 / 话术' },
  { key: 'poster', icon: '图', label: '海报', desc: '3:4 封面出图' },
  { key: 'script', icon: '影', label: '脚本', desc: '1 分钟视频脚本' }
];

interface WorkspaceRailProps {
  tab: StudioTab;
  onTabChange: (tab: StudioTab) => void;
}

export default function WorkspaceRail({ tab, onTabChange }: WorkspaceRailProps) {
  return (
    <aside className="rail">
      <div className="rail-title">工作区</div>
      {TABS.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`rail-btn${tab === item.key ? ' active' : ''}`}
          onClick={() => onTabChange(item.key)}
        >
          <span className="rail-icon">{item.icon}</span>
          <span>
            <span className="rail-label">{item.label}</span>
            <br />
            <span className="rail-desc">{item.desc}</span>
          </span>
        </button>
      ))}

      <div className="rail-note">
        <strong>一次输入，多平台产出</strong>
        资料只在本页使用，生成后请人工核对时间、地点、报名方式再发布。
      </div>
    </aside>
  );
}
