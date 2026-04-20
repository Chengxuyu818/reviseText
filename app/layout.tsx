import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'EssayFixer - 英语作文三色批改',
  description: '拼写红色、用词蓝色、语法绿色的英语作文自动批改网站',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
