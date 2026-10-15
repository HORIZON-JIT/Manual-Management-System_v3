'use client';

import { useEffect, useMemo, useState } from 'react';
import { Step, WorkInstruction, getStepImages, getStepConditionIds } from '@/types/instruction';
import { cloneStepsForCopy } from '@/lib/copySteps';

interface StepCopyModalProps {
  /** コピー元の手順書 */
  source: WorkInstruction;
  sourceName: string;
  /** 今編集中のステップ（挿入位置の選択に使う） */
  currentSteps: Step[];
  onCopy: (steps: Step[], insertAfterIndex: number | null) => void;
  onClose: () => void;
}

const excerpt = (text: string, max = 60) => {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
};

/** 別の手順書からステップを選んで取り込むモーダル */
export default function StepCopyModal({ source, sourceName, currentSteps, onCopy, onClose }: StepCopyModalProps) {
  const sorted = useMemo(() => [...(source.steps ?? [])].sort((a, b) => a.orderIndex - b.orderIndex), [source.steps]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [insertAfter, setInsertAfter] = useState<string>('end');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const allSelected = sorted.length > 0 && selected.size === sorted.length;

  const handleCopy = () => {
    if (selected.size === 0) return;
    const steps = cloneStepsForCopy(sorted, [...selected]);
    const afterIndex = insertAfter === 'end' ? null : Number(insertAfter);
    onCopy(steps, Number.isFinite(afterIndex as number) ? afterIndex : null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-6" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true">
      <div className="flex max-h-[calc(100vh-24px)] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-950">他の手順書からステップをコピー</h2>
            <p className="mt-0.5 truncate text-xs text-slate-500">コピー元: {source.title?.trim() || sourceName}（{sorted.length} ステップ）</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50">
            閉じる
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-2.5 text-sm">
          <label className="inline-flex cursor-pointer items-center gap-2 text-slate-700">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => setSelected(allSelected ? new Set() : new Set(sorted.map((s) => s.id)))}
              className="h-4 w-4 rounded border-slate-300"
            />
            すべて選択
          </label>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{selected.size} 件を選択中</span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
          {sorted.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">この手順書にはステップがありません。</p>
          ) : (
            <ul className="space-y-2">
              {sorted.map((step, index) => {
                const images = getStepImages(step).length;
                const checked = selected.has(step.id);
                return (
                  <li key={step.id}>
                    <label className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition ${checked ? 'border-blue-300 bg-blue-50/60' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggle(step.id)} className="mt-1 h-4 w-4 rounded border-slate-300" data-copy-step={index} />
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-700">{index + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-slate-900">{step.title?.trim() || '（無題）'}</span>
                        {step.description?.trim() && <span className="mt-0.5 block text-xs leading-5 text-slate-500">{excerpt(step.description)}</span>}
                        <span className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-slate-500">
                          {images > 0 && <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">画像 {images}</span>}
                          {(step.checkItems?.length ?? 0) > 0 && <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">チェック {step.checkItems!.length}</span>}
                          {(step.links?.length ?? 0) > 0 && <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">リンク {step.links!.length}</span>}
                          {step.caution?.trim() && <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700">注意</span>}
                          {(step.jumps?.length ?? 0) > 0 && <span className="brand-border brand-surface brand-text rounded-full border px-2 py-0.5">分岐</span>}
                          {getStepConditionIds(step).length > 0 && <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">条件つき</span>}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="space-y-3 border-t border-slate-200 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="text-xs font-semibold text-slate-600">挿入位置</label>
            <select value={insertAfter} onChange={(e) => setInsertAfter(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400" data-copy-position>
              <option value="end">末尾に追加</option>
              {currentSteps.map((s, i) => (
                <option key={s.id} value={String(i)}>ステップ {i + 1}「{s.title?.trim() || '無題'}」の後</option>
              ))}
            </select>
          </div>
          <p className="text-xs leading-5 text-slate-500">
            画像・注釈・注意・チェック項目・関連リンクごとコピーします。元の手順書の条件や、選んだ範囲の外への進み先は引き継ぎません（選んだ範囲内の分岐は残ります）。
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50">
              キャンセル
            </button>
            <button type="button" onClick={handleCopy} disabled={selected.size === 0} className="rounded-lg bg-slate-950 px-5 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-40">
              {selected.size} ステップをコピー
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
