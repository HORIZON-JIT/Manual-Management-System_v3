'use client';

import { useEffect, useState } from 'react';
import { Theme, resolveInitialTheme, applyTheme, setTheme as persistTheme } from '@/lib/theme';

export default function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme>('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // 保存済みテーマを毎回再適用する。ハイドレーション等で <html> の dark クラスが
    // 剥がれても、各ページのマウント時に確実に元のテーマへ戻す。
    const resolved = resolveInitialTheme();
    applyTheme(resolved);
    setThemeState(resolved);
    setMounted(true);
  }, []);

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setThemeState(next);
    persistTheme(next);
  };

  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggle}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-950"
      title={isDark ? 'ライトテーマに切替' : 'ダークテーマに切替'}
      aria-label={isDark ? 'ライトテーマに切替' : 'ダークテーマに切替'}
    >
      {/* hydration 前はアイコンを出さず、サーバー/クライアントの不一致を避ける */}
      {mounted && isDark ? (
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="4" strokeWidth={2} />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 2v2m0 16v2m10-10h-2M4 12H2m15.07-7.07-1.41 1.41M6.34 17.66l-1.41 1.41m12.73 0-1.41-1.41M6.34 6.34 4.93 4.93"
          />
        </svg>
      ) : (
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"
          />
        </svg>
      )}
    </button>
  );
}
