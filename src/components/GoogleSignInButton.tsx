'use client';

import { useEffect, useState } from 'react';
import {
  GoogleAuthState,
  isGoogleConfigured,
  initGoogleAuth,
  addAuthListener,
  getAuthState,
  signIn,
  signOut,
} from '@/lib/googleAuth';

export default function GoogleSignInButton() {
  const [auth, setAuth] = useState<GoogleAuthState>(getAuthState());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isGoogleConfigured()) return;
    initGoogleAuth().catch(() => {});
    return addAuthListener(setAuth);
  }, []);

  if (!isGoogleConfigured() || !auth.isInitialized) return null;

  const handleSignIn = async () => {
    setBusy(true);
    try {
      await signIn();
    } finally {
      setBusy(false);
    }
  };

  if (auth.isSignedIn) {
    return (
      <div className="flex items-center gap-2.5">
        {auth.userPhoto && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={auth.userPhoto}
            alt=""
            className="h-7 w-7 rounded-full ring-1 ring-neutral-200"
          />
        )}
        <span className="hidden max-w-32 truncate text-sm text-neutral-600 lg:inline">
          {auth.userName || auth.userEmail}
        </span>
        {auth.needsReauth ? (
          <button
            onClick={handleSignIn}
            disabled={busy}
            title="ログインの有効期限が切れています。押すと再ログインします"
            className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-100 disabled:opacity-50"
          >
            {busy ? 'ログイン中...' : '再ログイン'}
          </button>
        ) : (
          <button
            onClick={signOut}
            className="rounded-md border border-neutral-200 px-2.5 py-1.5 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-950"
          >
            サインアウト
          </button>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={handleSignIn}
      disabled={busy}
      className="flex min-w-40 items-center justify-center gap-2 rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 shadow-[0_8px_18px_rgba(0,0,0,0.06)] transition hover:border-neutral-300 hover:bg-neutral-50 disabled:opacity-50"
    >
      <svg className="h-4 w-4" viewBox="0 0 24 24">
        <path
          fill="currentColor"
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        />
        <path
          fill="#34A853"
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        />
        <path
          fill="#FBBC05"
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        />
        <path
          fill="#EA4335"
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        />
      </svg>
      {busy ? 'ログイン中...' : 'Google Drive'}
    </button>
  );
}
