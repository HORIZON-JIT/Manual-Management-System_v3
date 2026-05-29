'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import GoogleSignInButton from './GoogleSignInButton';
import DriveFolderPicker from './DriveFolderPicker';
import HelpModal from './HelpModal';
import ThemeToggle from './ThemeToggle';
import { VIEWER_ONLY } from '@/lib/appMode';
import { getTargetFolder, DriveFolder } from '@/lib/googleDrive';
import { isGoogleConfigured, getAuthState } from '@/lib/googleAuth';

export default function Header() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [currentFolder, setCurrentFolder] = useState<DriveFolder | null>(() =>
    typeof window === 'undefined' ? null : getTargetFolder()
  );

  const handleFolderClick = () => {
    const auth = getAuthState();
    if (isGoogleConfigured() && auth.isSignedIn) {
      setShowFolderPicker(true);
    }
  };

  const handleFolderSelected = (folder: DriveFolder | null) => {
    setCurrentFolder(folder ?? getTargetFolder());
  };
  const isInstructionView = pathname.includes('/instructions/view');

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-neutral-200/80 bg-white/90 text-neutral-950 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3">
          <Link href="/" className="flex min-w-0 items-center gap-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-neutral-950 text-sm font-semibold tracking-wide text-white shadow-[0_10px_24px_rgba(0,0,0,0.16)]">
              H
            </span>
            <span className="truncate text-[15px] font-semibold tracking-[0.08em]">{VIEWER_ONLY ? 'MANUAL VIEWER' : 'MANUAL SYSTEM'}</span>
          </Link>

          <nav className="hidden items-center gap-1.5 md:flex">
            {isInstructionView && (
              <button
                type="button"
                onClick={() => window.dispatchEvent(new Event('open-instruction-search'))}
                className="mr-2 inline-flex h-10 w-10 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 shadow-[0_6px_16px_rgba(0,0,0,0.04)] transition hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-950"
                aria-label="手順書内を検索"
                title="手順書内を検索"
              >
                <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-4.35-4.35m1.6-5.15a6.75 6.75 0 1 1-13.5 0 6.75 6.75 0 0 1 13.5 0Z" />
                </svg>
              </button>
            )}
            <ThemeToggle />
            <button
              onClick={() => setShowHelp(true)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-950"
              title="使い方"
              aria-label="使い方"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
            <div className="ml-3 border-l border-neutral-200 pl-3">
              <GoogleSignInButton />
            </div>
            <button
              onClick={handleFolderClick}
              className="flex max-w-[220px] items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-600 shadow-[0_8px_18px_rgba(0,0,0,0.06)] transition hover:border-[#a48149]/40 hover:bg-[#fbfaf7]"
              title={currentFolder ? `保存先: ${currentFolder.name}` : 'Driveフォルダを指定'}
            >
              <svg className="h-4 w-4 shrink-0 text-[#a48149]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <span className="truncate">{currentFolder ? currentFolder.name : '保存先未設定'}</span>
            </button>
          </nav>

          <button
            className="inline-flex h-10 w-10 items-center justify-center rounded-md text-neutral-600 transition hover:bg-neutral-100 md:hidden"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="メニュー"
          >
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {menuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>

        {menuOpen && (
          <nav className="space-y-1 border-t border-neutral-200 bg-white px-4 py-3 md:hidden">
            <div className="flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium text-neutral-600">
              <span>テーマ切替</span>
              <ThemeToggle />
            </div>
            <button
              onClick={() => { setMenuOpen(false); setShowHelp(true); }}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-950"
            >
              使い方
            </button>
            <div className="px-3 py-2">
              <GoogleSignInButton />
            </div>
            <button
              onClick={() => { setMenuOpen(false); handleFolderClick(); }}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm text-neutral-600 hover:bg-neutral-100"
            >
              <svg className="h-4 w-4 shrink-0 text-[#a48149]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <span className="truncate">{currentFolder ? `保存先: ${currentFolder.name}` : 'Driveフォルダを指定'}</span>
            </button>
          </nav>
        )}
      </header>

      <HelpModal open={showHelp} onClose={() => setShowHelp(false)} />
      <DriveFolderPicker open={showFolderPicker} onClose={() => setShowFolderPicker(false)} onSelect={handleFolderSelected} />
    </>
  );
}
