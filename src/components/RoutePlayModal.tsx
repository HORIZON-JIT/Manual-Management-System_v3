'use client';

import { useEffect, useMemo, useState } from 'react';
import { WorkInstruction, Step, JUMP_END_TARGET } from '@/types/instruction';
import { computeRoute, groupConditionsOf, selectableGroupIds, DEFAULT_JUMP_VALUE, ConditionSelection, JumpSelection } from '@/lib/routeEngine';
import { checkRoutes, RouteIssue } from '@/lib/routeCheck';
import { tryConvertConditionsToFlow } from '@/lib/convertConditions';
import { sortSteps, isQuestionOnlyStep, questionNodeId, START_NODE, END_NODE, hasBranch } from '@/lib/flowModel';
import FlowFigure, { FlowLegend } from './FlowFigure';

/**
 * 試し読み: 作成中の手順書を閲覧者の操作（答えを押す・条件を選ぶ）で通して確認する。
 * 経路の計算は閲覧画面と同じ規則（routeEngine.computeRoute）。
 */
interface Props {
  instruction: WorkInstruction;
  onClose: () => void;
  /** 問題のあるステップの編集欄へ移動する */
  onEditStep?: (stepId: string) => void;
  /** 条件グループ方式の手順書を「図で分岐を組み立てる」へ送って変換する */
  onConvertRequest?: () => void;
}

const ISSUE_LABEL: Record<RouteIssue['kind'], string> = {
  unreachable: '表示されない',
  'unset-answer': '進み先が未設定',
  'broken-next': '次が不正',
  'no-exit': '終われない',
  'too-many': '確認省略',
};

export default function RoutePlayModal({ instruction, onClose, onEditStep, onConvertRequest }: Props) {
  const [selectedConditions, setSelectedConditions] = useState<ConditionSelection>({});
  const [selectedJumpTargets, setSelectedJumpTargets] = useState<JumpSelection>({});

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const steps = useMemo(() => sortSteps(instruction.steps), [instruction.steps]);
  const stepById = useMemo(() => new Map(steps.map((s) => [s.id, s])), [steps]);
  const issues = useMemo(() => checkRoutes(instruction), [instruction]);
  const route = useMemo(() => computeRoute(instruction, selectedConditions, selectedJumpTargets), [instruction, selectedConditions, selectedJumpTargets]);
  const usesConditions = (instruction.conditions?.length ?? 0) > 0;
  const conversion = useMemo(() => (usesConditions ? tryConvertConditionsToFlow(instruction) : null), [instruction, usesConditions]);
  const conditionGroups = useMemo(() => {
    if (!usesConditions) return [];
    const selectable = selectableGroupIds(instruction);
    return groupConditionsOf(instruction.conditions ?? []).filter((g) => selectable.has(g.groupId));
  }, [instruction, usesConditions]);

  const last = route[route.length - 1];
  const waiting = !!last && (last.jumps?.length ?? 0) > 0 && !selectedJumpTargets[last.id];
  const ended = !!last && !waiting;

  // 図の強調: 通った箱と線
  const { highlightIds, highlightEdges, currentId } = useMemo(() => {
    const seq: string[] = [START_NODE];
    for (const step of route) {
      if (!isQuestionOnlyStep(step)) seq.push(step.id);
      if (hasBranch(step)) seq.push(questionNodeId(step.id));
    }
    if (ended) seq.push(END_NODE);
    const ids = new Set(seq);
    const edges = new Set<string>();
    for (let i = 0; i < seq.length - 1; i++) edges.add(`${seq[i]}>${seq[i + 1]}`);
    const current = waiting && last ? questionNodeId(last.id) : ended ? END_NODE : null;
    return { highlightIds: ids, highlightEdges: edges, currentId: current };
  }, [route, ended, waiting, last]);

  const stepNo = (step: Step) => steps.findIndex((s) => s.id === step.id) + 1;

  // 閲覧画面と同じ: 戻る答えを押したら、戻り先から後の答えを消す
  const handleJumpSelect = (stepId: string, target: string, visibleIndex: number) => {
    const backIndex = route.findIndex((step, index) => index < visibleIndex && step.id === target);
    if (backIndex >= 0) {
      setSelectedJumpTargets((prev) => {
        const next = { ...prev };
        for (const step of route.slice(backIndex)) delete next[step.id];
        return next;
      });
      return;
    }
    setSelectedJumpTargets((prev) => ({ ...prev, [stepId]: target }));
  };

  const reset = () => { setSelectedConditions({}); setSelectedJumpTargets({}); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex h-[calc(100vh-16px)] w-full max-w-[1600px] flex-col rounded-2xl bg-white shadow-xl sm:h-[calc(100vh-32px)]">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-950">試し読み</h2>
            <p className="truncate text-xs text-slate-500">閲覧者と同じように答えを押して、表示される手順と流れを確かめます。</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={reset} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50">最初からやり直す</button>
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50">閉じる</button>
          </div>
        </div>

        {/* 問題の一覧 */}
        <div className={`border-b px-4 py-3 text-sm sm:px-6 ${issues.length ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-100 bg-emerald-50 text-emerald-700'}`}>
          {issues.length === 0 ? (
            <p className="font-medium">問題は見つかりませんでした。すべてのステップにたどり着け、答えの進み先も決まっています。</p>
          ) : (
            <>
              <p className="font-semibold">確認してください（{issues.length} 件）</p>
              <ul className="mt-1.5 space-y-1">
                {issues.map((issue, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-amber-800">{ISSUE_LABEL[issue.kind]}</span>
                    <span>{issue.message}</span>
                    {issue.stepId && onEditStep && (
                      <button type="button" onClick={() => { onEditStep(issue.stepId!); onClose(); }} className="text-xs font-semibold text-amber-900 underline decoration-amber-400 underline-offset-2 hover:text-amber-700">
                        このステップを編集
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
          {/* 左: 閲覧者に見える手順 */}
          <div className="min-h-0 overflow-y-auto border-b border-slate-200 px-4 py-4 sm:px-6 lg:border-b-0 lg:border-r">
            {usesConditions && conditionGroups.length > 0 && (
              <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-sm font-semibold text-slate-800">条件を選択</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {conditionGroups.map((g, gi) => (
                    <label key={g.groupId} className="text-xs text-slate-600">
                      <span className="mb-1 block">グループ {String.fromCharCode(65 + gi)}</span>
                      <select
                        value={selectedConditions[g.groupId] ?? g.conditions[0]?.id ?? ''}
                        onChange={(e) => { setSelectedConditions((prev) => ({ ...prev, [g.groupId]: e.target.value })); setSelectedJumpTargets({}); }}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900"
                      >
                        {g.conditions.map((c) => <option key={c.id} value={c.id}>{c.label || '（未入力）'}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <ol className="space-y-3">
              {route.map((step, index) => {
                const isLast = index === route.length - 1;
                const jumps = step.jumps ?? [];
                return (
                  <li key={step.id} id={`play-step-${step.id}`} className={`rounded-lg border bg-white ${isLast ? 'border-slate-900 shadow-sm' : 'border-slate-200'}`}>
                    <div className="flex items-start gap-3 px-4 py-3">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-950 text-xs font-bold text-white">{stepNo(step)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-900">{step.title || '（無題）'}</p>
                        {step.description && <p className="mt-1 line-clamp-3 whitespace-pre-line text-xs leading-5 text-slate-600">{step.description}</p>}
                        {step.caution && <p className="mt-1 text-xs text-amber-700">注意: {step.caution}</p>}
                      </div>
                    </div>
                    {jumps.length > 0 && (
                      <div className="border-t border-slate-100 px-4 py-3">
                        <p className="text-sm font-semibold text-slate-800">{step.branchQuestion && step.branchQuestion !== step.title ? step.branchQuestion : '次の進行を選択'}</p>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          {jumps.map((jump, ji) => {
                            const target = stepById.get(jump.targetStepId);
                            const selected = selectedJumpTargets[step.id] === jump.targetStepId;
                            const unset = !target && jump.targetStepId !== JUMP_END_TARGET;
                            return (
                              <button
                                key={jump.id}
                                type="button"
                                disabled={unset}
                                onClick={() => handleJumpSelect(step.id, jump.targetStepId, index)}
                                className={`rounded-lg border px-3 py-2 text-left transition ${selected ? 'border-slate-950 bg-slate-950 text-white' : unset ? 'cursor-not-allowed border-dashed border-red-300 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-800 hover:border-slate-400'}`}
                              >
                                <span className="block text-sm font-semibold">{jump.label.trim() || `（答え${ji + 1}）`}</span>
                                <span className={`mt-0.5 block text-xs ${selected ? 'text-slate-300' : unset ? 'text-red-600' : 'text-slate-500'}`}>
                                  {target ? target.title || '（無題）' : jump.targetStepId === JUMP_END_TARGET ? 'ここで終了' : '進み先が未設定'}
                                </span>
                              </button>
                            );
                          })}
                          {step.jumpDefaultLabel && (
                            <button
                              type="button"
                              onClick={() => handleJumpSelect(step.id, DEFAULT_JUMP_VALUE, index)}
                              className={`rounded-lg border px-3 py-2 text-left transition ${selectedJumpTargets[step.id] === DEFAULT_JUMP_VALUE ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-white text-slate-800 hover:border-slate-400'}`}
                            >
                              <span className="block text-sm font-semibold">{step.jumpDefaultLabel}</span>
                              <span className={`mt-0.5 block text-xs ${selectedJumpTargets[step.id] === DEFAULT_JUMP_VALUE ? 'text-slate-300' : 'text-slate-500'}`}>通常の次に進む先</span>
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
            <p className={`mt-4 text-center text-sm font-medium ${waiting ? 'text-amber-700' : 'text-emerald-700'}`}>
              {route.length === 0 ? '表示できるステップがありません' : waiting ? '答えを選んでください' : `ここで終了（${route.length} ステップ）`}
            </p>
          </div>

          {/* 右: 流れ図 */}
          <div className="min-h-0 overflow-auto bg-[#fcfbf8] px-4 py-4 sm:px-6">
            {usesConditions ? (
              <div className="mx-auto max-w-md py-8 text-center">
                <p className="text-sm text-slate-600">この手順書は「条件グループ」方式で分岐を設定しているため、流れ図は表示できません。左の一覧で確認してください。</p>
                {conversion?.ok ? (
                  <>
                    <p className="mt-4 text-sm font-semibold text-slate-900">「図で分岐を組み立てる」方式に変換すると、流れ図で確認・編集できるようになります。</p>
                    <p className="mt-1 text-xs text-slate-500">条件の選び方 {conversion.combinations} 通りすべてで、変換前後の手順の流れが一致することを確認済みです。変換はこの編集画面の中だけで行われ、保存するまで手順書は変わりません。</p>
                    {onConvertRequest && (
                      <button type="button" onClick={onConvertRequest} className="mt-4 rounded-lg bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800">
                        図で組み立てる方式に変換する
                      </button>
                    )}
                  </>
                ) : conversion ? (
                  <p className="mt-4 text-xs leading-5 text-amber-700">図の方式には自動変換できません: {conversion.reason}</p>
                ) : null}
              </div>
            ) : (
              <>
                <FlowFigure steps={steps} selectedId={currentId} highlightIds={highlightIds} highlightEdges={highlightEdges} />
                <div className="mt-3"><FlowLegend /></div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
