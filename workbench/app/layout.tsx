import type { Metadata } from 'next';
import './styles/base.css';
import './styles/login.css';
import './styles/brand.css';
import './styles/topbar.css';
import './styles/workspace.css';
import './styles/panel.css';
import './styles/progress.css';
import './styles/results.css';
import './styles/poster.css';
import './styles/script.css';
import './styles/help.css';
import './styles/library.css';
import './styles/responsive.css';
import './styles/workbench.css';
import './styles/canvas.css';

export const metadata: Metadata = {
  title: 'C公益内容工作台',
  description: 'C公益内容工作台（内部使用）',
  robots: { index: false, follow: false, nocache: true }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
