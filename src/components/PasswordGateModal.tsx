'use client';

import { useEffect, useRef, useState } from 'react';
import { checkFromVideoPassword, unlockFromVideo } from '@/lib/videoGate';

interface Props {
  title?: string;
  onUnlock: () => void;
  onCancel: () => void;
}

/** 検証中の機能に入るためのパスワード入力モーダル */
export default function PasswordGateModal({ title = '動画から作成', onUnlock, onCancel }: Props) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    if (checkFromVideoPassword(value)) {
      unlockFromVideo();
      onUnlock();
    } else {
      setError(true);
      inputRef.current?.select();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onCancel} role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-50 text-amber-600">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
          </div>
          <div>
            <p className="text-base font-semibold text-slate-900">{title}</p>
            <p className="text-xs text-slate-500">検証中の機能です。パスワードを入力してください。</p>
          </div>
        </div>
        <form
          className="mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(false);
            }}
            placeholder="パスワード"
            aria-label="パスワード"
            className={`w-full rounded-lg border px-3 py-2.5 text-sm tracking-widest focus:outline-none focus:ring-2 ${error ? 'border-red-300 focus:ring-red-100' : 'border-slate-300 focus:border-blue-400 focus:ring-blue-100'}`}
          />
          {error && <p className="mt-2 text-xs font-medium text-red-600">パスワードが違います。</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50">
              キャンセル
            </button>
            <button type="submit" disabled={!value} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-40">
              開く
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
