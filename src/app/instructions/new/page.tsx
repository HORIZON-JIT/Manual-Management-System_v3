'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import InstructionForm from '@/components/InstructionForm';
import EditorOnlyNotice from '@/components/EditorOnlyNotice';
import { VIEWER_ONLY } from '@/lib/appMode';
import { getAllInstructions } from '@/lib/storage';
import { getTempData, removeTempData } from '@/lib/tempStorage';
import { TEMPLATE_TEMP_KEY } from '@/lib/templateCopy';
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

/** ?source=template のときは、ひな形（複製）を初期値にして新規作成を開く */
function NewInstructionContent() {
  const searchParams = useSearchParams();
  const fromTemplate = searchParams.get('source') === 'template';
  const [template, setTemplate] = useState<WorkInstruction | null>(null);
  const [loading, setLoading] = useState(fromTemplate);

  useEffect(() => {
    if (!fromTemplate) return;
    let cancelled = false;
    getTempData(TEMPLATE_TEMP_KEY)
      .then((raw) => {
        if (raw) {
          removeTempData(TEMPLATE_TEMP_KEY).catch(() => {});
          try {
            if (!cancelled) setTemplate(JSON.parse(raw) as WorkInstruction);
          } catch {
            // 壊れていれば空の新規作成にする
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fromTemplate]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-slate-500">ひな形を読み込み中...</p>
      </div>
    );
  }
  if (template) {
    return (
      <>
        <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6">
          <p className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
            「{template.title || '無題の手順書'}」をひな形にした新しい手順書です。タイトルを変えてから保存してください。
          </p>
        </div>
        <InstructionForm initialData={template} asNew />
      </>
    );
  }
  return (
    <>
      <ResumeBanner />
      <InstructionForm />
    </>
  );
}

export default function NewInstructionPage() {
  if (VIEWER_ONLY) return <EditorOnlyNotice />;
  return (
    <Suspense fallback={<div className="flex min-h-[50vh] items-center justify-center"><p className="text-slate-500">読み込み中...</p></div>}>
      <NewInstructionContent />
    </Suspense>
  );
}
