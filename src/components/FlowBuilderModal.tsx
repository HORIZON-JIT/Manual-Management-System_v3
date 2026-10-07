'use client';

import { useEffect, useMemo, useState } from 'react';
import { Step, JUMP_END_TARGET } from '@/types/instruction';
import {
  buildFlowGraph,
  addStepAfter,
  addAnswerStep,
  addAnswerQuestion,
  isQuestionOnlyStep,
  addBranch,
  removeBranch,
  setBranchQuestion,
  setAnswer,
  addAnswer,
  removeAnswer,
  setNext,
  setStepTitle,
  removeStep,
  successorOf,
  hasBranch,
  sortSteps,
  stepLabel,
  questionNodeId,
} from '@/lib/flowModel';
import { LayoutBox } from '@/lib/flowLayout';
import type { ConvertResult } from '@/lib/convertConditions';
import FlowFigure, { FlowLegend } from './FlowFigure';

interface FlowBuilderModalProps {
  steps: Step[];
  onChange: (steps: Step[]) => void;
  onClose: () => void;
  /** 「本文を編集」で閉じたあと、該当ステップへスクロールする */
  onEditStep?: (stepId: string) => void;
  /** 使えない理由（条件グループを使う手順書など）。指定時は図を出さず説明だけ出す。 */
  disabledReason?: string;
  /** 条件グループ→図方式の自動変換の結果（disabledReason があるときに使う） */
  conversion?: ConvertResult | null;
  /** 変換を実行する（変換後のステップを渡す） */
  onConvert?: (steps: Step[]) => void;
}

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-4 focus:ring-slate-100';
const labelClass = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400';
const actionClass =
  'w-full rounded-lg border px-3 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50';
// 控えめな通常ボタン／ブランド色の主ボタン／文字だけのボタン／削除
const neutralBtn = `${actionClass} border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50`;
const accentBtn = `${actionClass} brand-border brand-text bg-white hover:bg-[#faf7f1]`;
const ghostBtn = `${actionClass} border-transparent bg-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-900`;
const dangerBtn = `${actionClass} border-transparent bg-transparent text-red-600 hover:bg-red-50`;

export default function FlowBuilderModal({ steps, onChange, onClose, onEditStep, disabledReason, conversion, onConvert }: FlowBuilderModalProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sorted = useMemo(() => sortSteps(steps), [steps]);
  const graph = useMemo(() => buildFlowGraph(sorted), [sorted]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const selectedNode = selectedId ? graph.nodes.find((n) => n.id === selectedId) ?? null : null;
  const selectedStep = selectedNode?.stepId ? sorted.find((s) => s.id === selectedNode.stepId) ?? null : null;

  const handleBoxClick = (box: LayoutBox) => {
    const node = box.node;
    if (node.kind === 'start' || node.kind === 'end') { setSelectedId(null); return; }
    setSelectedId(node.id);
  };

  // 「＋ 次を追加」の先に何を置くかを選ぶ欄
  const renderPlaceholderPanel = (step: Step, jumpIndex: number) => {
    const answer = step.jumps?.[jumpIndex];
    const label = answer?.label || `（答え${jumpIndex + 1}）`;
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-bold text-slate-950">「{label}」の先に置くもの</h3>
        </div>
        <p className="text-sm leading-6 text-slate-600">
          質問「{step.branchQuestion || 'どちらに進む？'}」で「{label}」と答えたあと、何に進みますか？
        </p>
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => { const r = addAnswerStep(sorted, step.id, jumpIndex); onChange(r.steps); setSelectedId(r.newId); }}
            className={neutralBtn}
          >
            ＋ ステップを追加
          </button>
          <button
            type="button"
            onClick={() => { const r = addAnswerQuestion(sorted, step.id, jumpIndex); onChange(r.steps); setSelectedId(questionNodeId(r.newId)); }}
            className={accentBtn}
          >
            ？ 質問を追加（続けて分岐する）
          </button>
          <p className="text-xs leading-5 text-slate-500">
            「質問を追加」は、質問文をタイトルにした本文なしのステップを作り、すぐ次の分岐にします。
          </p>
          <button type="button" onClick={() => setSelectedId(questionNodeId(step.id))} className={ghostBtn}>
            質問に戻る
          </button>
        </div>
      </div>
    );
  };

  const renderStepPanel = (step: Step) => {
    const succ = successorOf(sorted, step);
    const branched = hasBranch(step);
    const nextValue = succ.kind === 'end' ? JUMP_END_TARGET : succ.id;
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-bold text-slate-950">ステップ {sorted.indexOf(step) + 1}</h3>
          <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-slate-500">ステップ</span>
        </div>
        <div>
          <label className={labelClass}>タイトル</label>
          <input
            type="text"
            value={step.title}
            onChange={(e) => onChange(setStepTitle(sorted, step.id, e.target.value))}
            className={inputClass}
            placeholder="例: 受入検査"
          />
        </div>
        {branched ? (
          <div className="brand-border-soft brand-panel rounded-lg border px-3 py-2.5 text-sm text-slate-700">
            このステップの後は質問で分かれます。
            <button type="button" onClick={() => setSelectedId(questionNodeId(step.id))} className="brand-text ml-2 font-semibold underline">
              質問を開く
            </button>
          </div>
        ) : (
          <div>
            <label className={labelClass}>次はどこ？</label>
            <select value={nextValue} onChange={(e) => onChange(setNext(sorted, step.id, e.target.value))} className={inputClass}>
              <option value={JUMP_END_TARGET}>終了</option>
              {sorted.filter((s) => s.id !== step.id).map((s) => (
                <option key={s.id} value={s.id}>{stepLabel(sorted, s)} へ</option>
              ))}
            </select>
            <p className="mt-1.5 text-xs leading-5 text-slate-500">
              すでにある箱を選ぶと線がつながります（合流）。前の箱に戻す場合は点線の「↩ 戻る」になります。
            </p>
          </div>
        )}
        <div className="space-y-2">
          {!branched && (
            <button
              type="button"
              onClick={() => { const r = addStepAfter(sorted, step.id); onChange(r.steps); setSelectedId(r.newId); }}
              className={neutralBtn}
            >
              ＋ 次に新しいステップを追加
            </button>
          )}
          {!branched && (
            <button
              type="button"
              onClick={() => { onChange(addBranch(sorted, step.id)); setSelectedId(questionNodeId(step.id)); }}
              className={accentBtn}
            >
              ？ ここで分岐（質問を入れる）
            </button>
          )}
          {onEditStep && (
            <button
              type="button"
              onClick={() => { onClose(); onEditStep(step.id); }}
              className={ghostBtn}
            >
              本文・画像を編集する
            </button>
          )}
          <button
            type="button"
            disabled={sorted.length <= 1}
            onClick={() => { onChange(removeStep(sorted, step.id)); setSelectedId(null); }}
            className={dangerBtn}
          >
            このステップを削除
          </button>
        </div>
      </div>
    );
  };

  const renderQuestionPanel = (step: Step) => (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-base font-bold text-slate-950">質問</h3>
        <span className="brand-surface brand-text rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide">分岐</span>
      </div>
      <div>
        <label className={labelClass}>質問文</label>
        <input
          type="text"
          value={step.branchQuestion ?? ''}
          onChange={(e) => onChange(setBranchQuestion(sorted, step.id, e.target.value))}
          className={inputClass}
          placeholder="例: 合格ですか？"
        />
        {isQuestionOnlyStep(step) && (
          <p className="mt-1.5 text-xs leading-5 text-slate-500">質問だけのステップです。ステップ名も同じ文になります。</p>
        )}
      </div>
      <div>
        <label className={labelClass}>答えと進み先</label>
        <div className="space-y-2">
          {(step.jumps ?? []).map((jump, index) => (
            <div key={jump.id} className="space-y-2 rounded-lg border border-slate-200/80 bg-slate-50/70 p-2.5">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={jump.label}
                  onChange={(e) => onChange(setAnswer(sorted, step.id, index, { label: e.target.value }))}
                  className={inputClass}
                  placeholder={`答え${index + 1}（例: はい）`}
                />
                <button
                  type="button"
                  onClick={() => onChange(removeAnswer(sorted, step.id, index))}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                  aria-label="この答えを削除"
                >
                  ×
                </button>
              </div>
              <select
                value={jump.targetStepId}
                onChange={(e) => onChange(setAnswer(sorted, step.id, index, { targetStepId: e.target.value }))}
                className={inputClass}
              >
                <option value="">（未設定：図の「＋ 次を追加」を押す）</option>
                <option value={JUMP_END_TARGET}>終了</option>
                {sorted.filter((s) => s.id !== step.id).map((s) => (
                  <option key={s.id} value={s.id}>{stepLabel(sorted, s)} へ</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <button type="button" onClick={() => onChange(addAnswer(sorted, step.id))} className={neutralBtn}>
          ＋ 答えを増やす
        </button>
        <button type="button" onClick={() => setSelectedId(step.id)} className={ghostBtn}>
          ステップ {sorted.indexOf(step) + 1} に戻る
        </button>
        {isQuestionOnlyStep(step) ? (
          <button
            type="button"
            disabled={sorted.length <= 1}
            onClick={() => { onChange(removeStep(sorted, step.id)); setSelectedId(null); }}
            className={dangerBtn}
          >
            この質問を削除（枝は切り離されます）
          </button>
        ) : (
          <button
            type="button"
            onClick={() => { onChange(removeBranch(sorted, step.id)); setSelectedId(step.id); }}
            className={dangerBtn}
          >
            この質問を削除（枝は切り離されます）
          </button>
        )}
      </div>
    </div>
  );

  const unreachableCount = graph.nodes.filter((n) => !!n.stepId && (n.kind === 'step' || n.kind === 'question') && n.unreachable).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex h-[calc(100vh-16px)] w-[calc(100vw-16px)] flex-col rounded-2xl bg-white shadow-xl sm:h-[calc(100vh-32px)] sm:w-[calc(100vw-32px)]">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-950">図で分岐を組み立てる</h2>
            <p className="truncate text-xs text-slate-500">箱を押すと右（スマホでは下）に操作が出ます。並びは自動で整います。変更はすぐ手順ステップに反映されます。</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50">
            閉じる
          </button>
        </div>

        {disabledReason ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="w-full max-w-lg space-y-4">
              <p className="brand-border-soft brand-panel rounded-lg border px-4 py-3 text-sm leading-6 text-slate-700">{disabledReason}</p>
              {conversion?.ok && onConvert && (
                <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                  <p className="text-sm font-semibold text-slate-900">図で組み立てる方式に変換できます</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-slate-600">
                    <li>条件の選び方 {conversion.combinations} 通りすべてで、変換前後の手順の流れが一致することを確認済みです。</li>
                    <li>全 {conversion.reachable} ステップが変換後も図につながっています（つながらなくなるステップがある場合は変換できません）。</li>
                    <li>条件グループは質問（{conversion.questions} 件）に置き換わり、閲覧時は「条件を選択」のタブではなく、質問の答えを押して進む形になります。</li>
                    <li>変換はこの編集画面の中だけで行われます。保存するまで手順書は変わりません。</li>
                  </ul>
                  {conversion.fixedGroups.length > 0 && (
                    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-700">
                      <p className="font-semibold">閲覧画面で選べなかった条件は、これまでどおりの流れに固定します</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5">
                        {conversion.fixedGroups.map((g, i) => (
                          <li key={i}>
                            「{g.conditions.join('／')}」は閲覧画面にタブが出ない設定だったため、常に「{g.chosen}」の流れで変換します。分岐にしたい場合は、変換後に図で質問を追加してください。
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => onConvert(conversion.steps)}
                    className="mt-4 w-full rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
                  >
                    図で組み立てる方式に変換する
                  </button>
                </div>
              )}
              {conversion && !conversion.ok && (
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
                  自動変換は行えませんでした: {conversion.reason}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-rows-[1fr_auto] lg:grid-cols-[1fr_340px] lg:grid-rows-1">
            <div className="brand-panel min-h-0 overflow-auto p-4">
              {unreachableCount > 0 && (
                <p className="mb-3 rounded-lg border border-red-200/80 bg-red-50 px-3 py-2 text-xs text-red-700">
                  赤い点線の箱（{unreachableCount}件）はどこからもつながっていません。閲覧時には表示されません。
                </p>
              )}
              <FlowFigure steps={sorted} selectedId={selectedId} onBoxClick={handleBoxClick} />
              <div className="mt-4"><FlowLegend /></div>
            </div>
            <div className="max-h-[45vh] overflow-auto border-t border-slate-200 p-5 lg:max-h-none lg:border-l lg:border-t-0">
              {selectedStep && selectedNode?.kind === 'placeholder'
                ? renderPlaceholderPanel(selectedStep, selectedNode.jumpIndex ?? 0)
                : selectedStep && selectedNode?.kind === 'question'
                ? renderQuestionPanel(selectedStep)
                : selectedStep
                  ? renderStepPanel(selectedStep)
                  : (
                    <div className="space-y-3 text-sm leading-6 text-slate-600">
                      <p className="font-semibold text-slate-900">図の箱を押すと操作が出ます。</p>
                      <ul className="list-disc space-y-1 pl-5">
                        <li>ステップの箱：次を追加、ここで分岐、進み先の変更、削除</li>
                        <li>菱形（質問）：質問文と答え、各答えの進み先</li>
                        <li>「＋ 次を追加」：その答えの先に新しいステップを作る</li>
                      </ul>
                      <p className="text-xs text-slate-500">開始・終了の丸は押せません。</p>
                    </div>
                  )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
