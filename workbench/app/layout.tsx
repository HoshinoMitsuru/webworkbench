import type { Metadata } from 'next';
import './globals.css';

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
