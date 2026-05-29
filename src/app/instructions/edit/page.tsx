'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { WorkInstruction } from '@/types/instruction';
import { getInstruction } from '@/lib/storage';
import { getTempData, removeTempData } from '@/lib/tempStorage';
import InstructionForm from '@/components/InstructionForm';
import EditorOnlyNotice from '@/components/EditorOnlyNotice';
import { VIEWER_ONLY } from '@/lib/appMode';

function EditInstructionContent() {
  const searchParams = useSearchParams();
  const [instruction, setInstruction] = useState<WorkInstruction | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const source = searchParams.get('source');
    if (source === 'drive') {
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
  }, [searchParams]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-slate-500">読み込み中...</p>
      </div>
    );
  }

  if (!instruction) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-lg font-semibold text-slate-700">手順書が見つかりません</p>
        <Link href="/" className="text-sm font-medium text-blue-700 hover:text-blue-900">
          ホームへ戻る
        </Link>
      </div>
    );
  }

  return <InstructionForm initialData={instruction} />;
}

export default function EditInstructionPage() {
  if (VIEWER_ONLY) return <EditorOnlyNotice />;
  return (
    <Suspense fallback={<div className="flex min-h-[50vh] items-center justify-center"><p className="text-slate-500">読み込み中...</p></div>}>
      <EditInstructionContent />
    </Suspense>
  );
}
