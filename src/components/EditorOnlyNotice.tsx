'use client';

import Link from 'next/link';

/**
 * 閲覧専用エディションで、作成・編集系ページにアクセスされた際の案内。
 */
export default function EditorOnlyNotice() {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-76px)] max-w-2xl flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-neutral-200 bg-neutral-50 text-neutral-400">
        <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      </div>
      <div>
        <h1 className="text-xl font-semibold text-neutral-950">この機能は閲覧専用版では使用できません</h1>
        <p className="mt-2 text-sm leading-6 text-neutral-500">
          手順書の作成・編集は資材課版で行ってください。このエディションは手順書の閲覧専用です。
        </p>
      </div>
      <Link
        href="/"
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-neutral-950 px-5 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(0,0,0,0.16)] transition hover:bg-neutral-800"
      >
        手順書一覧へ戻る
      </Link>
    </div>
  );
}
