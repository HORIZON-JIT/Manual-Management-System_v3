'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { WorkInstruction, getCategoryLabel } from '@/types/instruction';
import { getAllInstructions, deleteInstruction } from '@/lib/storage';
import { setTempData } from '@/lib/tempStorage';
import EditorOnlyNotice from '@/components/EditorOnlyNotice';
import { VIEWER_ONLY } from '@/lib/appMode';

function loadDrafts(): WorkInstruction[] {
  if (typeof window === 'undefined') return [];
  return getAllInstructions()
    .filter((inst) => !inst.status || inst.status === 'draft')
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export default function DraftsPage() {
  if (VIEWER_ONLY) return <EditorOnlyNotice />;
  return <DraftsPageContent />;
}

function DraftsPageContent() {
  const router = useRouter();
  const [drafts, setDrafts] = useState<WorkInstruction[]>(loadDrafts);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDelete = (id: string, title: string) => {
    if (!confirm(`「${title}」を削除しますか？`)) return;
    deleteInstruction(id);
    setDrafts((prev) => prev.filter((d) => d.id !== id));
  };

  const handleDeleteAll = () => {
    if (!confirm(`下書き ${drafts.length} 件をすべて削除しますか？\nブラウザの保存容量が解放されます。`)) return;
    drafts.forEach((d) => deleteInstruction(d.id));
    setDrafts([]);
  };

  const handleJsonFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const json = JSON.parse(ev.target?.result as string) as WorkInstruction;
        if (!json.id || !json.title || !Array.isArray(json.steps)) {
          alert('有効な手順書JSONファイルではありません。');
          return;
        }
        await setTempData('drive_import_instruction', JSON.stringify(json));
        router.push('/instructions/edit?source=drive');
      } catch {
        alert('JSONファイルの読み込みに失敗しました。ファイルが壊れている可能性があります。');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleJsonFileChange} />

      <div className="mb-8 flex flex-col gap-4 border-b border-slate-200 pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <Link href="/" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-500 transition hover:text-slate-900">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            ホームへ戻る
          </Link>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">下書き一覧</h1>
          <p className="mt-2 text-sm text-slate-500">{drafts.length} 件の下書きがあります。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => fileInputRef.current?.click()} className="rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700 shadow-sm transition hover:bg-blue-50">
            JSONから読み込む
          </button>
          {drafts.length >= 2 && (
            <button onClick={handleDeleteAll} className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 shadow-sm transition hover:bg-red-50">
              すべて削除
            </button>
          )}
        </div>
      </div>

      {drafts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-16 text-center shadow-sm">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
            <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p className="text-lg font-semibold text-slate-900">下書きはありません</p>
          <p className="mt-2 text-sm text-slate-500">新規作成から手順書を作り始められます。</p>
          <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link href="/instructions/new" className="rounded-lg bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800">
              新規作成
            </Link>
            <button onClick={() => fileInputRef.current?.click()} className="rounded-lg border border-blue-200 bg-white px-5 py-3 text-sm font-semibold text-blue-700 transition hover:bg-blue-50">
              JSONから読み込む
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {drafts.map((inst) => (
            <article key={inst.id} className="rounded-lg border border-slate-200 bg-white shadow-sm transition hover:border-blue-200 hover:shadow-md">
              <div className="flex flex-col gap-4 p-5 md:flex-row md:items-center">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-lg font-semibold text-slate-950">{inst.title || '無題の手順書'}</h2>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
                      {getCategoryLabel(inst.category)}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                    <span>{inst.steps.length} ステップ</span>
                    <span>最終更新: {new Date(inst.updatedAt).toLocaleString('ja-JP')}</span>
                    {inst.createdBy && <span>作成者: {inst.createdBy}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Link href={`/instructions/edit?id=${inst.id}`} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800">
                    編集を再開
                  </Link>
                  <button onClick={() => handleDelete(inst.id, inst.title)} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-500 transition hover:bg-red-50 hover:text-red-600">
                    削除
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
