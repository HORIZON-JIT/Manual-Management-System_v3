'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface XmbItem {
  title: string;
  description?: string;
  icon: React.ReactNode;
  href?: string;
  onClick?: () => void;
}

export interface XmbCategory {
  key: string;
  label: string;
  icon: React.ReactNode;
  items: XmbItem[];
}

/**
 * PS3のクロスメディアバー（XMB）風メニュー。
 * 横軸＝カテゴリ、縦軸＝そのカテゴリの項目。クリック/タップが主操作で、
 * キーボード（←→↑↓・Enter）も補助的に使える。ライト/ダーク両対応。
 */
export default function XmbMenu({
  categories,
  className = '',
}: {
  categories: XmbCategory[];
  className?: string;
}) {
  const router = useRouter();
  const [cat, setCat] = useState(0);
  const [item, setItem] = useState(0);

  const items = categories[cat]?.items ?? [];

  const selectCat = (i: number) => {
    setCat(i);
    setItem(0);
  };

  const activate = (it?: XmbItem) => {
    const target = it ?? items[item];
    if (!target) return;
    if (target.onClick) target.onClick();
    else if (target.href) router.push(target.href);
  };

  // キーボードは補助。クリック/タップだけでも全操作できる。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setItem(0);
        setCat((c) => (c + 1) % categories.length);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setItem(0);
        setCat((c) => (c - 1 + categories.length) % categories.length);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setItem((i) => Math.min(i + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setItem((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories.length, items.length, item, cat]);

  return (
    <div
      className={`xmb-bg flex flex-col items-center justify-start rounded-2xl border border-neutral-200 px-4 py-8 sm:py-12 ${className}`}
    >
      {/* 横軸：カテゴリ */}
      <div className="flex w-full max-w-3xl items-end justify-start gap-6 overflow-x-auto px-1 pb-2 pt-3 sm:justify-center sm:gap-12">
        {categories.map((c, i) => {
          const active = i === cat;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => selectCat(i)}
              aria-pressed={active}
              className="flex shrink-0 flex-col items-center gap-2 outline-none"
            >
              <span
                className={`flex h-14 w-14 items-center justify-center rounded-2xl border bg-white transition-all duration-200 ${
                  active
                    ? 'brand-border brand-text scale-110 shadow-[0_0_0_4px_rgba(164,129,73,0.18)]'
                    : 'border-neutral-200 text-neutral-400 hover:text-neutral-700'
                }`}
              >
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {c.icon}
                </svg>
              </span>
              <span
                className={`whitespace-nowrap text-xs font-semibold tracking-wide transition ${
                  active ? 'brand-text' : 'text-neutral-400'
                }`}
              >
                {c.label}
              </span>
            </button>
          );
        })}
      </div>

      <div className="my-6 h-px w-full max-w-md bg-neutral-200" />

      {/* 最大3項目分の高さを確保し、カテゴリ切替時にパネル全体が上下しないようにする。 */}
      <div className="flex w-full max-w-md flex-col gap-2 sm:min-h-72">
        {items.map((it, i) => {
          const active = i === item;
          return (
            <button
              key={it.title}
              type="button"
              onMouseEnter={() => setItem(i)}
              onFocus={() => setItem(i)}
              onClick={() => activate(it)}
              className={`group flex min-h-14 w-full items-center gap-4 rounded-xl border border-transparent px-3 py-3 text-left transition sm:px-4 ${
                active ? 'xmb-item-active' : 'xmb-item-idle'
              }`}
            >
              <span
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-500 transition ${
                  active ? 'xmb-item-icon-active' : ''
                }`}
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {it.icon}
                </svg>
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold leading-6 text-neutral-950">{it.title}</span>
                {it.description && (
                  <span className="hidden text-[13px] leading-5 text-neutral-500 sm:block">{it.description}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
