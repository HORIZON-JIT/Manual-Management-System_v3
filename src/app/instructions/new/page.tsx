'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import InstructionForm from '@/components/InstructionForm';
import EditorOnlyNotice from '@/components/EditorOnlyNotice';
import { VIEWER_ONLY } from '@/lib/appMode';
import { getAllInstructions } from '@/lib/storage';
import { WorkInstruction } from '@/types/instruction';

const RESUME_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** 直近 7 日以内に自動保存／下書き保存された手順書があれば「前回の続き」として案内する */
function ResumeBanner() {
  const [draft, setDraft] = useState<WorkInstruction | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAllInstructions()
      .then((all) => {
        const since = Date.now() - RESUME_WINDOW_MS;
        const latest = all
          .filter((inst) => (!inst.status || inst.status === 'draft') && new Date(inst.updatedAt).getTime() >= since)
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
        if (!cancelled && latest) setDraft(latest);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!draft || dismissed) return null;
  const when = new Date(draft.updatedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return (
    <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <p>
          前回の続きがあります: <span className="font-semibold">{draft.title?.trim() || '無題の手順書'}</span>
          <span className="ml-2 text-xs text-amber-700">（{when} に自動保存）</span>
        </p>
        <div className="flex items-center gap-2">
          <Link
            href={`/instructions/edit?id=${encodeURIComponent(draft.id)}`}
            className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            続きから編集
          </Link>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-800 transition hover:bg-amber-100"
          >
            新規で始める
          </button>
        </div>
      </div>
    </div>
  );
}

export default function NewInstructionPage() {
  if (VIEWER_ONLY) return <EditorOnlyNotice />;
  return (
    <>
      <ResumeBanner />
      <InstructionForm />
    </>
  );
}
