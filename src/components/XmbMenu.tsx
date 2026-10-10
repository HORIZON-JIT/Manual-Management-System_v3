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
    <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 ${className}`}>
      {categories.map((c, ci) => {
        const activeCat = ci === cat;
        return (
          <section
            key={c.key}
            onMouseEnter={() => { if (!activeCat) selectCat(ci); }}
            className={`xmb-card flex flex-col rounded-xl border bg-white p-4 transition ${
              activeCat ? 'xmb-card-active' : 'border-neutral-200'
            }`}
          >
            {/* カテゴリの見出し */}
            <button
              type="button"
              onClick={() => selectCat(ci)}
              aria-pressed={activeCat}
              className="flex flex-col items-center gap-2 border-b border-neutral-100 pb-4 outline-none"
            >
              <span
                className={`flex h-14 w-14 items-center justify-center rounded-2xl border transition ${
                  activeCat ? 'xmb-cat-icon-active' : 'brand-border-soft brand-panel brand-text'
                }`}
              >
                <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {c.icon}
                </svg>
              </span>
              <span className="text-sm font-semibold text-neutral-950">{c.label}</span>
            </button>

            {/* 項目（すべて表示） */}
            <div className="mt-2 flex flex-col gap-1">
              {c.items.map((it, ii) => {
                const activeItem = activeCat && ii === item;
                return (
                  <button
                    key={it.title}
                    type="button"
                    onMouseEnter={() => { setCat(ci); setItem(ii); }}
                    onFocus={() => { setCat(ci); setItem(ii); }}
                    onClick={() => { setCat(ci); setItem(ii); activate(it); }}
                    className={`group flex w-full items-start gap-3 rounded-lg border px-2.5 py-2.5 text-left transition ${
                      activeItem ? 'xmb-item-active' : 'border-transparent hover:bg-neutral-50'
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-500 transition ${
                        activeItem ? 'xmb-item-icon-active' : ''
                      }`}
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        {it.icon}
                      </svg>
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[14px] font-semibold leading-5 text-neutral-950">{it.title}</span>
                      {it.description && (
                        <span className="mt-0.5 block text-[12px] leading-5 text-neutral-500">{it.description}</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
      <p className="col-span-full hidden text-center text-[11px] text-neutral-400 sm:block">← → でカテゴリ、↑ ↓ で項目、Enter で開く</p>
    </div>
  );
}
