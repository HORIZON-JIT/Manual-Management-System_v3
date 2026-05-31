'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { WorkInstruction } from '@/types/instruction';
import { isGoogleConfigured, getAuthState, signIn } from '@/lib/googleAuth';
import { DriveFileInfo } from '@/lib/googleDrive';
import DriveJsonFilePicker from '@/components/DriveJsonFilePicker';
import InstructionLibrary from '@/components/InstructionLibrary';
import { setTempData } from '@/lib/tempStorage';
import { VIEWER_ONLY } from '@/lib/appMode';

const actions = [
  {
    href: '/instructions/new',
    title: '新規作成',
    icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />,
  },
  {
    href: '/instructions/drafts',
    title: '下書きから編集',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
      />
    ),
  },
  {
    href: '/instructions/bulk-department',
    title: '部署を一括設定',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a3 3 0 10-2.5-1.34M5 11a3 3 0 102.5-1.34"
      />
    ),
  },
  {
    href: '/instructions/bulk-category',
    title: 'カテゴリを一括設定',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M7 7h.01M7 3h5.172a2 2 0 011.414.586l6.828 6.828a2 2 0 010 2.828l-7.172 7.172a2 2 0 01-2.828 0L3.586 13.586A2 2 0 013 12.172V7a4 4 0 014-4z"
      />
    ),
  },
  {
    href: '/instructions/bulk-sequential',
    title: '読み飛ばし防止を一括変更',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10.5 6h9.75M10.5 12h9.75M10.5 18h9.75M3.75 6h.008v.008H3.75V6zm0 6h.008v.008H3.75V12zm0 6h.008v.008H3.75V18z"
      />
    ),
  },
  {
    href: '/instructions/backup',
    title: 'バックアップを作成',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2zm9 4v5m0-5-2 2m2-2 2 2"
      />
    ),
  },
];

export default function HomePage() {
  if (VIEWER_ONLY) {
    return <InstructionLibrary />;
  }
  return <EditorHomePage />;
}

function EditorHomePage() {
  const router = useRouter();
  const [importError, setImportError] = useState<string | null>(null);
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const [showJsonPicker, setShowJsonPicker] = useState(false);
  const [showPreviewPicker, setShowPreviewPicker] = useState(false);
  const [version, setVersion] = useState('');

  useEffect(() => {
    fetch('https://api.github.com/repos/HORIZON-JIT/FC/pulls?state=closed&per_page=1', {
      headers: { Accept: 'application/vnd.github.v3+json' },
    })
      .then((res) => {
        const link = res.headers.get('Link') ?? '';
        const match = link.match(/[?&]page=(\d+)>;\s*rel="last"/);
        if (match) setVersion(`1.${match[1]}`);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!importError) return;
    const timer = setTimeout(() => setImportError(null), 5000);
    return () => clearTimeout(timer);
  }, [importError]);

  const ensureDriveReady = () => {
    const auth = getAuthState();
    if (isGoogleConfigured() && auth.isSignedIn) {
      setShowAuthPrompt(false);
      return true;
    }
    setShowAuthPrompt(true);
    setImportError(
      'Google Drive に接続してください。右上のサインインボタンからログインできます。',
    );
    return false;
  };

  const handleUpdateClick = () => {
    if (ensureDriveReady()) setShowJsonPicker(true);
  };

  const handlePreviewClick = () => {
    if (ensureDriveReady()) setShowPreviewPicker(true);
  };

  const handlePreviewFileLoaded = async (content: string, file: DriveFileInfo) => {
    try {
      const json = JSON.parse(content);
      if (!json.id || !json.title || !json.steps || !Array.isArray(json.steps)) {
        throw new Error('有効な手順書データではありません。');
      }
      await setTempData(
        'preview_instruction',
        JSON.stringify({ ...json, driveFileId: file.id }),
      );
      router.push('/instructions/view?source=preview');
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : `${file.name} の読み込みに失敗しました。`,
      );
    }
  };

  const handleJsonFileLoaded = async (content: string, file: DriveFileInfo) => {
    try {
      const json = JSON.parse(content);
      if (!json.id || !json.title || !json.steps || !Array.isArray(json.steps)) {
        throw new Error('有効な手順書データではありません。');
      }
      const instruction = { ...(json as WorkInstruction), driveFileId: file.id };
      instruction.status = 'completed';
      await setTempData('drive_import_instruction', JSON.stringify(instruction));
      router.push('/instructions/edit?source=drive');
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : `${file.name} の読み込みに失敗しました。`,
      );
    }
  };

  return (
    <div className="mx-auto flex min-h-[calc(100vh-76px)] max-w-7xl flex-col px-6 py-8 lg:py-10">
      <section className="border-b border-neutral-200 pb-8">
        <div className="max-w-3xl">
          <div className="mb-5 h-px w-16 bg-[#a48149]" />
          <p className="mb-4 text-xs font-semibold tracking-[0.28em] text-[#8a6a37]">HORIZON JIT</p>
          <h1 className="max-w-2xl text-4xl font-semibold leading-[1.03] tracking-[-0.03em] text-neutral-950 sm:text-5xl">
            Manual Management
          </h1>
          <p className="mt-5 max-w-xl text-[15px] leading-7 text-neutral-600">
            業務手順を、作成から保存・共有まで整えるためのワークスペースです。
          </p>
        </div>
      </section>

      <section className="mt-7 grid w-full flex-none gap-2 self-start rounded-lg border border-neutral-200 bg-white/70 p-2 shadow-[0_18px_44px_rgba(0,0,0,0.06)] sm:grid-cols-2 lg:grid-cols-4">
        {actions.map((action) => (
          <Link
            key={action.title}
            href={action.href}
            className="group flex min-h-24 items-center gap-4 rounded-md px-4 py-4 transition hover:bg-[#f7f3ec]"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-700 transition group-hover:border-[#a48149]/50 group-hover:text-[#8a6a37]">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {action.icon}
              </svg>
            </div>
            <h2 className="text-base font-semibold leading-6 text-neutral-950">{action.title}</h2>
          </Link>
        ))}

        <button
          type="button"
          onClick={handleUpdateClick}
          className="group flex min-h-24 items-center gap-4 rounded-md px-4 py-4 text-left transition hover:bg-[#f7f3ec]"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-700 transition group-hover:border-[#a48149]/50 group-hover:text-[#8a6a37]">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          </div>
          <h2 className="text-base font-semibold leading-6 text-neutral-950">
            <span className="block">Driveの手順書を</span>
            <span className="block">編集</span>
          </h2>
        </button>

        <button
          type="button"
          onClick={handlePreviewClick}
          className="group flex min-h-24 items-center gap-4 rounded-md px-4 py-4 text-left transition hover:bg-[#f7f3ec]"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-700 transition group-hover:border-[#a48149]/50 group-hover:text-[#8a6a37]">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </div>
          <h2 className="text-base font-semibold leading-6 text-neutral-950">
            <span className="block">Driveの手順書を</span>
            <span className="block">表示</span>
          </h2>
        </button>
      </section>

      {showAuthPrompt && (
        <section className="mt-6 rounded-lg border border-neutral-200 bg-white px-5 py-5 shadow-[0_18px_44px_rgba(0,0,0,0.06)]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-neutral-950">Google Drive にログインしてください</p>
              <p className="mt-1 text-sm leading-6 text-neutral-500">
                Drive上の手順書を編集・表示するには、先にGoogleアカウントの認証が必要です。
              </p>
            </div>
            <button
              type="button"
              onClick={signIn}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-neutral-200 bg-neutral-950 px-5 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(0,0,0,0.16)] transition hover:bg-neutral-800"
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
              Googleでログイン
            </button>
          </div>
        </section>
      )}

      {importError && !showAuthPrompt && (
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {importError}
        </div>
      )}

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-5 text-xs text-neutral-400">
        <p>Developed by Yuma Tani</p>
        <div className="flex items-center gap-3">
          <span>Build 2026</span>
          {version && <span>Version {version}</span>}
        </div>
      </footer>

      <DriveJsonFilePicker
        open={showJsonPicker}
        onClose={() => setShowJsonPicker(false)}
        onFileLoaded={handleJsonFileLoaded}
      />
      <DriveJsonFilePicker
        open={showPreviewPicker}
        onClose={() => setShowPreviewPicker(false)}
        onFileLoaded={handlePreviewFileLoaded}
      />
    </div>
  );
}
