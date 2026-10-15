'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Step, JUMP_END_TARGET } from '@/types/instruction';
import {
  buildFlowGraph,
  addStepAfter,
  addStepBefore,
  addAnswerStep,
  addAnswerQuestion,
  isQuestionOnlyStep,
  addBranch,
  removeBranch,
  setBranchQuestion,
  setAnswer,
  addAnswer,
  removeAnswer,
  removeAnswerWithBranch,
  orphanedByRemovingAnswer,
  MIN_ANSWERS,
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
const linkBtn = 'brand-text shrink-0 rounded-md px-2 py-1 text-xs font-semibold underline decoration-dotted underline-offset-2 transition hover:bg-[#faf7f1]';
const toolBtn = 'rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40';
const popoverBtn = 'block w-full rounded-md px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100';

const HISTORY_LIMIT = 100;
const TEXT_MERGE_MS = 1000;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;
const POPOVER_WIDTH = 236;

type Linking = { kind: 'next'; stepId: string } | { kind: 'answer'; stepId: string; jumpIndex: number };
interface Popover { box: LayoutBox; rect: DOMRect }
interface PopoverItem { label: string; onClick: () => void; accent?: boolean }
interface PendingRemoval { stepId: string; jumpIndex: number; orphans: Step[] }

const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));

export default function FlowBuilderModal({ steps, onChange, onClose, onEditStep, disabledReason, conversion, onConvert }: FlowBuilderModalProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [popover, setPopover] = useState<Popover | null>(null);
  const [linking, setLinking] = useState<Linking | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);
  const [zoom, setZoom] = useState(1);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [history, setHistory] = useState({ undo: 0, redo: 0 });
  const sorted = useMemo(() => sortSteps(steps), [steps]);
  const graph = useMemo(() => buildFlowGraph(sorted), [sorted]);

  const figureRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const stepsRef = useRef(steps);
  useEffect(() => {
    stepsRef.current = steps;
  }, [steps]);
  const undoRef = useRef<Step[][]>([]);
  const redoRef = useRef<Step[][]>([]);
  const lastTextKeyRef = useRef<{ key: string; at: number } | null>(null);

  /* ---- 変更はすべてここを通す（元に戻す／やり直すのため） ---- */
  const apply = useCallback((next: Step[], textKey?: string) => {
    const now = Date.now();
    const merge = !!textKey && !!lastTextKeyRef.current && lastTextKeyRef.current.key === textKey && now - lastTextKeyRef.current.at < TEXT_MERGE_MS;
    if (!merge) {
      undoRef.current.push(stepsRef.current);
      if (undoRef.current.length > HISTORY_LIMIT) undoRef.current.shift();
      redoRef.current = [];
    }
    lastTextKeyRef.current = textKey ? { key: textKey, at: now } : null;
    setPopover(null);
    setPendingRemoval(null);
    setHistory({ undo: undoRef.current.length, redo: redoRef.current.length });
    onChange(next);
  }, [onChange]);

  const undo = useCallback(() => {
    const prev = undoRef.current.pop();
    if (!prev) return;
    redoRef.current.push(stepsRef.current);
    lastTextKeyRef.current = null;
    setPopover(null);
    setPendingRemoval(null);
    setLinking(null);
    setHistory({ undo: undoRef.current.length, redo: redoRef.current.length });
    onChange(prev);
  }, [onChange]);

  const redo = useCallback(() => {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(stepsRef.current);
    lastTextKeyRef.current = null;
    setPopover(null);
    setPendingRemoval(null);
    setLinking(null);
    setHistory({ undo: undoRef.current.length, redo: redoRef.current.length });
    onChange(next);
  }, [onChange]);

  const canUndo = history.undo > 0;
  const canRedo = history.redo > 0;

  /* ---- キー操作: Esc（ポップオーバー → つなぐモード → 閉じる）、Ctrl+Z / Ctrl+Y ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (popover) { setPopover(null); return; }
        if (linking) { setLinking(null); return; }
        if (pendingRemoval) { setPendingRemoval(null); return; }
        onClose();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
        else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, popover, linking, pendingRemoval, undo, redo]);

  /* ---- ポップオーバーは外側を押したら閉じる ---- */
  useEffect(() => {
    if (!popover) return;
    const onDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setPopover(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [popover]);

  /* ---- Ctrl＋ホイールで拡大縮小（カーソル位置を中心に） ---- */
  const setZoomAround = useCallback((nextZoom: number, clientX?: number, clientY?: number) => {
    const vp = figureRef.current;
    const z = clampZoom(nextZoom);
    setZoom((current) => {
      if (vp && clientX !== undefined && clientY !== undefined && z !== current) {
        const rect = vp.getBoundingClientRect();
        const mx = clientX - rect.left + vp.scrollLeft;
        const my = clientY - rect.top + vp.scrollTop;
        const ratio = z / current;
        requestAnimationFrame(() => {
          vp.scrollLeft = mx * ratio - (clientX - rect.left);
          vp.scrollTop = my * ratio - (clientY - rect.top);
        });
      }
      return z;
    });
    setPopover(null);
  }, []);

  useEffect(() => {
    const vp = figureRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((current) => {
        const z = clampZoom(current * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
        if (z !== current) {
          const rect = vp.getBoundingClientRect();
          const mx = e.clientX - rect.left + vp.scrollLeft;
          const my = e.clientY - rect.top + vp.scrollTop;
          const ratio = z / current;
          requestAnimationFrame(() => {
            vp.scrollLeft = mx * ratio - (e.clientX - rect.left);
            vp.scrollTop = my * ratio - (e.clientY - rect.top);
          });
        }
        return z;
      });
      setPopover(null);
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, [disabledReason]);

  const fitToView = () => {
    const vp = figureRef.current;
    if (!vp || !naturalSize) return;
    // 余白（p-4）と凡例の高さぶんを引く
    const z = Math.min((vp.clientWidth - 40) / naturalSize.w, (vp.clientHeight - 80) / naturalSize.h, 1);
    setZoomAround(z);
    requestAnimationFrame(() => { vp.scrollTop = 0; vp.scrollLeft = 0; });
  };

  const selectedNode = selectedId ? graph.nodes.find((n) => n.id === selectedId) ?? null : null;
  const selectedStep = selectedNode?.stepId ? sorted.find((s) => s.id === selectedNode.stepId) ?? null : null;

  /* ---- 図の箱を押したとき ---- */
  const handleBoxClick = (box: LayoutBox, anchor: DOMRect) => {
    const node = box.node;
    if (linking) {
      let target: string | null = null;
      if (node.kind === 'end') target = JUMP_END_TARGET;
      else if ((node.kind === 'step' || node.kind === 'question') && node.stepId && node.stepId !== linking.stepId) target = node.stepId;
      if (!target) return;
      if (linking.kind === 'next') apply(setNext(sorted, linking.stepId, target));
      else apply(setAnswer(sorted, linking.stepId, linking.jumpIndex, { targetStepId: target }));
      setLinking(null);
      return;
    }
    if (node.kind === 'start' || node.kind === 'end') { setSelectedId(null); setPopover(null); return; }
    setSelectedId(node.id);
    setPendingRemoval(null);
    if (node.kind === 'placeholder' || node.kind === 'step') setPopover({ box, rect: anchor });
    else setPopover(null);
  };

  const selectStepAfterCreate = (r: { steps: Step[]; newId: string }, asQuestion = false) => {
    apply(r.steps);
    setSelectedId(asQuestion ? questionNodeId(r.newId) : r.newId);
  };

  /* ---- 答えを消す（先の手順が孤立するなら確認する） ---- */
  const requestRemoveAnswer = (step: Step, jumpIndex: number) => {
    if ((step.jumps?.length ?? 0) <= MIN_ANSWERS) return;
    const orphans = orphanedByRemovingAnswer(sorted, step.id, jumpIndex);
    if (orphans.length === 0) { apply(removeAnswer(sorted, step.id, jumpIndex)); return; }
    setPendingRemoval({ stepId: step.id, jumpIndex, orphans });
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
          <button type="button" onClick={() => selectStepAfterCreate(addAnswerStep(sorted, step.id, jumpIndex))} className={neutralBtn}>
            ＋ ステップを追加
          </button>
          <button type="button" onClick={() => selectStepAfterCreate(addAnswerQuestion(sorted, step.id, jumpIndex), true)} className={accentBtn}>
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
    const linkingThis = linking?.kind === 'next' && linking.stepId === step.id;
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
            onChange={(e) => apply(setStepTitle(sorted, step.id, e.target.value), `title:${step.id}`)}
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
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label className={`${labelClass} mb-0`}>次はどこ？</label>
              <button
                type="button"
                onClick={() => setLinking(linkingThis ? null : { kind: 'next', stepId: step.id })}
                className={linkBtn}
                aria-pressed={linkingThis}
              >
                {linkingThis ? '選ぶのをやめる' : '図の箱を押して選ぶ'}
              </button>
            </div>
            <select value={nextValue} onChange={(e) => apply(setNext(sorted, step.id, e.target.value))} className={inputClass}>
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
            <button type="button" onClick={() => selectStepAfterCreate(addStepAfter(sorted, step.id))} className={neutralBtn}>
              ＋ 次に新しいステップを追加
            </button>
          )}
          <button type="button" onClick={() => selectStepAfterCreate(addStepBefore(sorted, step.id))} className={neutralBtn}>
            ＋ この前にステップを挿入
          </button>
          {!branched && (
            <button
              type="button"
              onClick={() => { apply(addBranch(sorted, step.id)); setSelectedId(questionNodeId(step.id)); }}
              className={accentBtn}
            >
              ？ ここで分岐（質問を入れる）
            </button>
          )}
          {onEditStep && (
            <button type="button" onClick={() => { onClose(); onEditStep(step.id); }} className={ghostBtn}>
              本文・画像を編集する
            </button>
          )}
          <button
            type="button"
            disabled={sorted.length <= 1}
            onClick={() => { apply(removeStep(sorted, step.id)); setSelectedId(null); }}
            className={dangerBtn}
          >
            このステップを削除
          </button>
        </div>
      </div>
    );
  };

  const renderQuestionPanel = (step: Step) => {
    const jumps = step.jumps ?? [];
    const atMin = jumps.length <= MIN_ANSWERS;
    const removal = pendingRemoval?.stepId === step.id ? pendingRemoval : null;
    return (
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
            onChange={(e) => apply(setBranchQuestion(sorted, step.id, e.target.value), `question:${step.id}`)}
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
            {jumps.map((jump, index) => {
              const linkingThis = linking?.kind === 'answer' && linking.stepId === step.id && linking.jumpIndex === index;
              return (
                <div key={jump.id} className="space-y-2 rounded-lg border border-slate-200/80 bg-slate-50/70 p-2.5">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={jump.label}
                      onChange={(e) => apply(setAnswer(sorted, step.id, index, { label: e.target.value }), `answer:${step.id}:${index}`)}
                      className={inputClass}
                      placeholder={`答え${index + 1}（例: はい）`}
                    />
                    <button
                      type="button"
                      onClick={() => requestRemoveAnswer(step, index)}
                      disabled={atMin}
                      title={atMin ? `答えは ${MIN_ANSWERS} つ以上必要です` : 'この答えを削除'}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                      aria-label="この答えを削除"
                    >
                      ×
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={jump.targetStepId}
                      onChange={(e) => apply(setAnswer(sorted, step.id, index, { targetStepId: e.target.value }))}
                      className={inputClass}
                    >
                      <option value="">（未設定：図の「＋ 次を追加」を押す）</option>
                      <option value={JUMP_END_TARGET}>終了</option>
                      {sorted.filter((s) => s.id !== step.id).map((s) => (
                        <option key={s.id} value={s.id}>{stepLabel(sorted, s)} へ</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setLinking(linkingThis ? null : { kind: 'answer', stepId: step.id, jumpIndex: index })}
                      className={linkBtn}
                      aria-pressed={linkingThis}
                      title="図の箱を押して進み先を選ぶ"
                    >
                      {linkingThis ? 'やめる' : '図で選ぶ'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {removal && (
            <div className="mt-2 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-semibold">答え「{jumps[removal.jumpIndex]?.label || `答え${removal.jumpIndex + 1}`}」を消します。</p>
              <p className="text-xs leading-5">
                先の {removal.orphans.length} ステップはどこからもつながらなくなります:{' '}
                {removal.orphans.map((s) => stepLabel(sorted, s)).join('、')}
              </p>
              <div className="grid gap-1.5">
                <button type="button" onClick={() => apply(removeAnswerWithBranch(sorted, step.id, removal.jumpIndex))} className={`${actionClass} border-transparent bg-red-600 text-white hover:bg-red-700`}>
                  先の手順も削除する
                </button>
                <button type="button" onClick={() => apply(removeAnswer(sorted, step.id, removal.jumpIndex))} className={neutralBtn}>
                  答えだけ消す（手順は残す）
                </button>
                <button type="button" onClick={() => setPendingRemoval(null)} className={ghostBtn}>
                  キャンセル
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => apply(addAnswer(sorted, step.id))} className={neutralBtn}>
              ＋ 答えを増やす
            </button>
            <button
              type="button"
              onClick={() => requestRemoveAnswer(step, jumps.length - 1)}
              disabled={atMin}
              title={atMin ? `答えは ${MIN_ANSWERS} つ以上必要です` : '最後の答えを消す'}
              className={neutralBtn}
            >
              － 答えを減らす
            </button>
          </div>
          <button type="button" onClick={() => selectStepAfterCreate(addStepBefore(sorted, step.id))} className={neutralBtn}>
            ＋ この前にステップを挿入
          </button>
          {!isQuestionOnlyStep(step) && (
            <button type="button" onClick={() => setSelectedId(step.id)} className={ghostBtn}>
              ステップ {sorted.indexOf(step) + 1} に戻る
            </button>
          )}
          {isQuestionOnlyStep(step) ? (
            <button
              type="button"
              disabled={sorted.length <= 1}
              onClick={() => { apply(removeStep(sorted, step.id)); setSelectedId(null); }}
              className={dangerBtn}
            >
              この質問を削除（枝は切り離されます）
            </button>
          ) : (
            <button
              type="button"
              onClick={() => { apply(removeBranch(sorted, step.id)); setSelectedId(step.id); }}
              className={dangerBtn}
            >
              この質問を削除（枝は切り離されます）
            </button>
          )}
        </div>
      </div>
    );
  };

  /* ---- 箱の直下に出す小さなメニュー（項目はここで組み立て、描画は FlowPopover） ---- */
  const popoverItems = (() => {
    if (!popover) return null;
    const { box } = popover;
    const step = box.node.stepId ? sorted.find((s) => s.id === box.node.stepId) : null;
    if (!step) return null;
    const jumpIndex = box.node.jumpIndex ?? 0;
    const items: PopoverItem[] =
      box.kind === 'placeholder'
        ? [
            { label: '＋ ステップを追加', onClick: () => selectStepAfterCreate(addAnswerStep(sorted, step.id, jumpIndex)) },
            { label: '？ 質問を追加（続けて分岐）', onClick: () => selectStepAfterCreate(addAnswerQuestion(sorted, step.id, jumpIndex), true), accent: true },
          ]
        : [
            ...(hasBranch(step)
              ? []
              : [
                  { label: '＋ 次にステップを追加', onClick: () => selectStepAfterCreate(addStepAfter(sorted, step.id)) },
                  { label: '？ ここで分岐', onClick: () => { apply(addBranch(sorted, step.id)); setSelectedId(questionNodeId(step.id)); }, accent: true },
                ]),
            { label: '＋ この前にステップを挿入', onClick: () => selectStepAfterCreate(addStepBefore(sorted, step.id)) },
          ];
    const title = box.kind === 'placeholder' ? `「${step.jumps?.[box.node.jumpIndex ?? 0]?.label || `答え${(box.node.jumpIndex ?? 0) + 1}`}」の先に` : stepLabel(sorted, step);
    return { title, items };
  })();

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
            <p className="truncate text-xs text-slate-500">箱を押すとその場と右（スマホでは下）に操作が出ます。並びは自動で整います。変更はすぐ手順ステップに反映されます。</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!disabledReason && (
              <div className="flex items-center gap-1">
                <button type="button" onClick={undo} disabled={!canUndo} className={toolBtn} title="元に戻す（Ctrl+Z）" aria-label="元に戻す">↶ 元に戻す</button>
                <button type="button" onClick={redo} disabled={!canRedo} className={toolBtn} title="やり直す（Ctrl+Y）" aria-label="やり直す">↷ やり直す</button>
              </div>
            )}
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50">
              閉じる
            </button>
          </div>
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
            <div className="relative min-h-0">
              {/* 拡大縮小 */}
              <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-lg border border-slate-200 bg-white/95 p-1 shadow-sm" data-flow-zoom>
                <button type="button" onClick={() => setZoomAround(zoom - ZOOM_STEP)} disabled={zoom <= ZOOM_MIN + 0.001} className={toolBtn} title="縮小" aria-label="縮小">－</button>
                <button type="button" onClick={() => setZoomAround(1)} className={`${toolBtn} min-w-[3.5rem] tabular-nums`} title="等倍に戻す">{Math.round(zoom * 100)}%</button>
                <button type="button" onClick={() => setZoomAround(zoom + ZOOM_STEP)} disabled={zoom >= ZOOM_MAX - 0.001} className={toolBtn} title="拡大" aria-label="拡大">＋</button>
                <button type="button" onClick={fitToView} disabled={!naturalSize} className={toolBtn} title="図全体が収まる大きさにする">全体を表示</button>
              </div>
              {linking && (
                <div className="brand-border brand-surface absolute left-3 right-3 top-3 z-10 mr-[17rem] flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs font-semibold text-slate-800 shadow-sm" role="status">
                  <span>進み先にする箱を押してください（「終了」の丸も選べます）。</span>
                  <button type="button" onClick={() => setLinking(null)} className="shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                    中止（Esc）
                  </button>
                </div>
              )}
              <div
                ref={figureRef}
                onScroll={() => setPopover(null)}
                className={`brand-panel h-full min-h-0 overflow-auto p-4 ${linking ? 'cursor-crosshair' : ''}`}
                data-flow-figure
              >
                {unreachableCount > 0 && (
                  <p className="mb-3 mr-[17rem] rounded-lg border border-red-200/80 bg-red-50 px-3 py-2 text-xs text-red-700">
                    赤い点線の箱（{unreachableCount}件）はどこからもつながっていません。閲覧時には表示されません。
                  </p>
                )}
                <div className={linking ? 'mt-10' : ''}>
                  <FlowFigure
                    steps={sorted}
                    selectedId={selectedId}
                    onBoxClick={handleBoxClick}
                    endClickable={!!linking}
                    zoom={zoom}
                    onLayoutSize={(w, h) => setNaturalSize({ w, h })}
                  />
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <FlowLegend />
                  <span className="text-[11px] text-slate-400">Ctrl＋ホイールで拡大縮小</span>
                </div>
              </div>
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
                        <li>ステップの箱：次を追加、ここで分岐、前に挿入、進み先の変更、削除</li>
                        <li>菱形（質問）：質問文と答え（2 つ以上）、各答えの進み先</li>
                        <li>「＋ 次を追加」：押すとその場で「ステップ／質問」を選べます</li>
                        <li>進み先は「図の箱を押して選ぶ」で、図の箱を直接押してつなげます</li>
                        <li>間違えたら Ctrl+Z（元に戻す）、Ctrl+Y（やり直す）</li>
                        <li>図が大きいときは右上の「－／＋」「全体を表示」か Ctrl＋ホイール</li>
                      </ul>
                      <p className="text-xs text-slate-500">開始・終了の丸は押せません（進み先を選ぶときだけ「終了」を押せます）。</p>
                    </div>
                  )}
            </div>
          </div>
        )}
      </div>
      {popover && popoverItems && <FlowPopover ref={popoverRef} rect={popover.rect} title={popoverItems.title} items={popoverItems.items} />}
    </div>
  );
}

/** 箱の直下（入らなければ直上）に固定表示する小さなメニュー */
function FlowPopover({ rect, title, items, ref }: { rect: DOMRect; title: string; items: PopoverItem[]; ref: React.Ref<HTMLDivElement> }) {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const left = Math.max(8, Math.min(rect.left + rect.width / 2 - POPOVER_WIDTH / 2, vw - POPOVER_WIDTH - 8));
  const below = rect.bottom + 160 < vh;
  const style: React.CSSProperties = below
    ? { left, top: rect.bottom + 6, width: POPOVER_WIDTH }
    : { left, top: rect.top - 6, width: POPOVER_WIDTH, transform: 'translateY(-100%)' };
  return (
    <div ref={ref} style={style} className="fixed z-[60] rounded-lg border border-slate-200 bg-white p-1.5 shadow-[0_12px_32px_rgba(15,23,42,0.18)]" role="menu" data-flow-popover>
      <p className="truncate px-3 pb-1 pt-1.5 text-[11px] font-semibold text-slate-400">{title}</p>
      {items.map((item) => (
        <button key={item.label} type="button" onClick={item.onClick} className={`${popoverBtn} ${item.accent ? 'brand-text' : ''}`} role="menuitem">
          {item.label}
        </button>
      ))}
    </div>
  );
}
