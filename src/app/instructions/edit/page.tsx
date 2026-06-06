'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { WorkInstruction } from '@/types/instruction';
import { downloadDriveFile } from '@/lib/googleDrive';
import {
  addAuthListener,
  getAuthState,
  GoogleAuthState,
  initGoogleAuth,
  isGoogleConfigured,
  signIn,
} from '@/lib/googleAuth';
import { getInstruction } from '@/lib/storage';
import { getTempData, removeTempData } from '@/lib/tempStorage';
import InstructionForm from '@/components/InstructionForm';
import EditorOnlyNotice from '@/components/EditorOnlyNotice';
import { VIEWER_ONLY } from '@/lib/appMode';

function EditInstructionContent() {
  const searchParams = useSearchParams();
  const [instruction, setInstruction] = useState<WorkInstruction | null>(null);
  const [loading, setLoading] = useState(true);
  const [auth, setAuth] = useState<GoogleAuthState>(getAuthState());
  const [error, setError] = useState<string | null>(null);
  const approvalMode = searchParams.get('mode') === 'approval';

  useEffect(() => {
    if (!isGoogleConfigured()) return;
    initGoogleAuth().catch(() => {});
    return addAuthListener(setAuth);
  }, []);

  useEffect(() => {
    const source = searchParams.get('source');
    const driveFileId = searchParams.get('driveFileId');
    if (source === 'drive') {
      if (driveFileId) {
        if (isGoogleConfigured() && !auth.isSignedIn) {
          queueMicrotask(() => {
            setInstruction(null);
            setLoading(false);
          });
          return;
        }
        queueMicrotask(() => {
          setLoading(true);
          setError(null);
        });
        downloadDriveFile(driveFileId)
          .then((raw) => {
            const json = JSON.parse(raw) as WorkInstruction;
            setInstruction({ ...json, driveFileId });
          })
          .catch((err) => {
            console.error('failed to load drive instruction', err);
            setInstruction(null);
            setError('Drive上の手順書を読み込めませんでした。ログイン状態とファイル権限を確認してください。');
          })
          .finally(() => setLoading(false));
        return;
      }

      getTempData('drive_import_instruction').then((raw) => {
        if (raw) {
          removeTempData('drive_import_instruction');
          try {
            setInstruction(JSON.parse(raw) as WorkInstruction);
          } catch {
            setInstruction(null);
          }
        }
        setLoading(false);
      }).catch(() => setLoading(false));
      return;
    }

    Promise.resolve().then(() => {
      const id = searchParams.get('id');
      setInstruction(id ? getInstruction(id) || null : null);
      setLoading(false);
    });
  }, [searchParams, auth.isSignedIn]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-slate-500">読み込み中...</p>
      </div>
    );
  }

  if (!instruction) {
    const driveFileId = searchParams.get('driveFileId');
    if (driveFileId && isGoogleConfigured() && !auth.isSignedIn) {
      return (
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4 text-center">
          <p className="text-lg font-semibold text-slate-700">承認用画面を開くにはGoogleログインが必要です</p>
          <button
            type="button"
            onClick={signIn}
            className="rounded-lg bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
          >
            Googleでログイン
          </button>
        </div>
      );
    }

    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-lg font-semibold text-slate-700">{error || '手順書が見つかりません'}</p>
        <Link href="/" className="text-sm font-medium text-blue-700 hover:text-blue-900">
          ホームへ戻る
        </Link>
      </div>
    );
  }

  return <InstructionForm initialData={instruction} approvalMode={approvalMode} />;
}

export default function EditInstructionPage() {
  if (VIEWER_ONLY) return <EditorOnlyNotice />;
  return (
    <Suspense fallback={<div className="flex min-h-[50vh] items-center justify-center"><p className="text-slate-500">読み込み中...</p></div>}>
      <EditInstructionContent />
    </Suspense>
  );
}
