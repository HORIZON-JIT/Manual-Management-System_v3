import type { Metadata } from 'next';
import './globals.css';
import Header from '@/components/Header';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
import { VIEWER_ONLY } from '@/lib/appMode';

export const metadata: Metadata = {
  title: VIEWER_ONLY ? '手順書ビューア' : '手順書作成システム',
  description: VIEWER_ONLY
    ? '業務手順書を閲覧するためのビューアです'
    : '業務手順書を作成・管理・共有するためのシステム',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen">
        <Header />
        <main>{children}</main>
      </body>
    </html>
  );
}
