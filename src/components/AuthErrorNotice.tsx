'use client';

import { useState } from 'react';
import { isAuthRequiredError, signIn } from '@/lib/googleAuth';

export const AUTH_EXPIRED_MESSAGE = 'Google ログインの有効期限が切れました。「再ログイン」を押すと続きから操作できます。';

/** Drive 呼び出しの失敗を画面向けの文言にする。認証切れだけは共通文言にして再ログインを案内する */
export function driveErrorMessage(error: unknown, fallback: string): string {
  return isAuthRequiredError(error) ? AUTH_EXPIRED_MESSAGE : fallback;
}

interface Props {
  error: string | null;
  /** 再ログインに成功したあとに実行する処理（一覧の再読み込みなど） */
  onRetry?: () => void;
  className?: string;
  tone?: 'amber' | 'red';
}

/** エラー表示。認証切れのときは「再ログイン」ボタンを添える */
export default function AuthErrorNotice({ error, onRetry, className = '', tone = 'amber' }: Props) {
  const [busy, setBusy] = useState(false);
  if (!error) return null;
  const isAuth = error === AUTH_EXPIRED_MESSAGE;
  const palette = tone === 'red'
    ? 'border-red-100 bg-red-50 text-red-700'
    : 'border-amber-200 bg-amber-50 text-amber-800';

  const handleReauth = async () => {
    setBusy(true);
    try {
      const ok = await signIn();
      if (ok) onRetry?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`rounded-md border px-4 py-3 text-sm ${palette} ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>{error}</span>
        {isAuth && (
          <button
            type="button"
            onClick={handleReauth}
            disabled={busy}
            className="shrink-0 rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            {busy ? 'ログイン中...' : '再ログイン'}
          </button>
        )}
      </div>
    </div>
  );
}

/** 起動直後、保存済みセッションの復元を待つ間の表示 */
export function AuthChecking({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center py-16 text-sm text-slate-400 ${className}`}>
      ログイン状態を確認しています...
    </div>
  );
}
