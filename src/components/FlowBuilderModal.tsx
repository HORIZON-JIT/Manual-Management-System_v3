'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Step, JUMP_END_TARGET } from '@/types/instruction';
import {
  buildFlowGraph,
  addStepAfter,
  addAnswerStep,
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
import { layoutFlow, FlowLayout, LayoutBox } from '@/lib/flowLayout';

interface FlowBuilderModalProps {
  steps: Step[];
  onChange: (steps: Step[]) => void;
  onClose: () => void;
  /** 「本文を編集」で閉じたあと、該当ステップへスクロールする */
  onEditStep?: (stepId: string) => void;
  /** 使えない理由（条件グループを使う手順書など）。指定時は図を出さず説明だけ出す。 */
  disabledReason?: string;
}

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-100';
const labelClass = 'mb-1.5 block text-xs font-semibold text-slate-500';
const actionClass =
  'w-full rounded-lg border px-3 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50';

function wrapText(text: string, max: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const ch of text) {
    cur += ch;
    if (cur.length >= max) { out.push(cur); cur = ''; }
  }
  if (cur) out.push(cur);
  if (out.length > 2) return [out[0], out[1].slice(0, max - 1) + '…'];
  return out;
}

export default function FlowBuilderModal({ steps, onChange, onClose, onEditStep, disabledReason }: FlowBuilderModalProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [layout, setLayout] = useState<FlowLayout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);
  const figureRef = useRef<HTMLDivElement>(null);
  const centredRef = useRef(false);

  const sorted = useMemo(() => sortSteps(steps), [steps]);
  const graph = useMemo(() => buildFlowGraph(sorted), [sorted]);

  useEffect(() => {
    if (disabledReason) return;
    const seq = ++seqRef.current;
    layoutFlow(graph)
      .then((result) => {
        if (seq !== seqRef.current) return;
        setLayout(result);
        setError(null);
      })
      .catch((e) => {
        if (seq !== seqRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
      });
  }, [graph, disabledReason]);

  useEffect(() => {
    if (!layout || centredRef.current) return;
    const fig = figureRef.current;
    if (fig && fig.scrollWidth > fig.clientWidth) fig.scrollLeft = (fig.scrollWidth - fig.clientWidth) / 2;
    centredRef.current = true;
  }, [layout]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const selectedNode = selectedId ? graph.nodes.find((n) => n.id === selectedId) ?? null : null;
  const selectedStep = selectedNode?.stepId ? sorted.find((s) => s.id === selectedNode.stepId) ?? null : null;

  const handleBoxClick = (box: LayoutBox) => {
    const node = box.node;
    if (node.kind === 'placeholder' && node.stepId !== undefined) {
      const result = addAnswerStep(sorted, node.stepId, node.jumpIndex ?? 0);
      onChange(result.steps);
      setSelectedId(result.newId);
      return;
    }
    if (node.kind === 'start' || node.kind === 'end') { setSelectedId(null); return; }
    setSelectedId(node.id);
  };

  const renderStepPanel = (step: Step) => {
    const succ = successorOf(sorted, step);
    const branched = hasBranch(step);
    const nextValue = succ.kind === 'end' ? JUMP_END_TARGET : succ.id;
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-bold text-slate-950">ステップ {sorted.indexOf(step) + 1}</h3>
          <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-500">ステップ</span>
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
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
            このステップの後は質問で分かれます。
            <button type="button" onClick={() => setSelectedId(questionNodeId(step.id))} className="ml-2 font-semibold underline">
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
              すでにある箱を選ぶと線がつながります（合流）。前の箱に戻す場合は青い点線「↩ 戻る」になります。
            </p>
          </div>
        )}
        <div className="space-y-2">
          {!branched && (
            <button
              type="button"
              onClick={() => { const r = addStepAfter(sorted, step.id); onChange(r.steps); setSelectedId(r.newId); }}
              className={`${actionClass} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}
            >
              ＋ 次に新しいステップを追加
            </button>
          )}
          {!branched && (
            <button
              type="button"
              onClick={() => { onChange(addBranch(sorted, step.id)); setSelectedId(questionNodeId(step.id)); }}
              className={`${actionClass} border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100`}
            >
              ？ ここで分岐（質問を入れる）
            </button>
          )}
          {onEditStep && (
            <button
              type="button"
              onClick={() => { onClose(); onEditStep(step.id); }}
              className={`${actionClass} border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100`}
            >
              本文・画像を編集する
            </button>
          )}
          <button
            type="button"
            disabled={sorted.length <= 1}
            onClick={() => { onChange(removeStep(sorted, step.id)); setSelectedId(null); }}
            className={`${actionClass} border-red-200 bg-white text-red-600 hover:bg-red-50`}
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
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">分岐</span>
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
      </div>
      <div>
        <label className={labelClass}>答えと進み先</label>
        <div className="space-y-2">
          {(step.jumps ?? []).map((jump, index) => (
            <div key={jump.id} className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
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
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-red-500 hover:bg-red-50"
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
        <button type="button" onClick={() => onChange(addAnswer(sorted, step.id))} className={`${actionClass} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}>
          ＋ 答えを増やす
        </button>
        <button type="button" onClick={() => setSelectedId(step.id)} className={`${actionClass} border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100`}>
          ステップ {sorted.indexOf(step) + 1} に戻る
        </button>
        <button
          type="button"
          onClick={() => { onChange(removeBranch(sorted, step.id)); setSelectedId(step.id); }}
          className={`${actionClass} border-red-200 bg-white text-red-600 hover:bg-red-50`}
        >
          この質問を削除（枝は切り離されます）
        </button>
      </div>
    </div>
  );

  const renderFigure = () => {
    if (error) return <p className="py-8 text-center text-sm text-red-600">図の計算に失敗しました: {error}</p>;
    if (!layout) return <p className="py-8 text-center text-sm text-slate-500">図を描いています…</p>;
    const { minX, width, height } = layout;
    return (
      <svg
        viewBox={`${minX} 0 ${width} ${height}`}
        width={width}
        height={height}
        className="mx-auto block max-w-none select-none"
        role="img"
        aria-label="手順の流れ図"
      >
        <defs>
          <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#64748b" />
          </marker>
        </defs>
        {layout.edges.map((e, i) => {
          const d = e.points.map((p, k) => (k ? 'L' : 'M') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
          return (
            <g key={i}>
              <path d={d} fill="none" stroke={e.loop ? '#2563eb' : '#64748b'} strokeWidth={1.6} strokeDasharray={e.loop ? '5 4' : undefined} markerEnd="url(#flow-arrow)" />
              {e.label && (
                <>
                  <rect x={e.label.x} y={e.label.y} width={e.label.w} height={e.label.h} rx={3} fill="#f8fafc" />
                  <text x={e.label.x + e.label.w / 2} y={e.label.y + e.label.h / 2 + 4} textAnchor="middle" fontSize={12} fill={e.loop ? '#2563eb' : '#b45309'}>
                    {e.label.text}
                  </text>
                </>
              )}
            </g>
          );
        })}
        {layout.boxes.map((b) => {
          const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
          const selected = b.id === selectedId;
          const common = { onClick: () => handleBoxClick(b), className: 'cursor-pointer' };
          if (b.kind === 'start' || b.kind === 'end') {
            return (
              <g key={b.id} {...common} style={{ cursor: 'default' }}>
                <circle cx={cx} cy={cy} r={b.w / 2 - 2} fill="#f0fdf4" stroke="#15803d" strokeWidth={1.6} />
                <text x={cx} y={cy + 4} textAnchor="middle" fontSize={11} fill="#166534">{b.label}</text>
              </g>
            );
          }
          if (b.kind === 'question') {
            const lines = wrapText(b.label, 11);
            return (
              <g key={b.id} {...common}>
                <polygon
                  points={`${cx},${b.y} ${b.x + b.w},${cy} ${cx},${b.y + b.h} ${b.x},${cy}`}
                  fill="#fffbeb"
                  stroke={selected ? '#2563eb' : '#d97706'}
                  strokeWidth={selected ? 2.4 : 1.6}
                />
                {lines.map((l, i) => (
                  <text key={i} x={cx} y={cy + 4 + (i - (lines.length - 1) / 2) * 14} textAnchor="middle" fontSize={12} fontWeight={600} fill="#1e293b">{l}</text>
                ))}
              </g>
            );
          }
          if (b.kind === 'placeholder') {
            return (
              <g key={b.id} {...common}>
                <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={8} fill="#eff6ff" stroke="#60a5fa" strokeWidth={1.4} strokeDasharray="4 3" />
                <text x={cx} y={cy + 4} textAnchor="middle" fontSize={12} fill="#1d4ed8">{b.label}</text>
              </g>
            );
          }
          const lines = wrapText(b.label, 12);
          return (
            <g key={b.id} {...common}>
              <rect
                x={b.x}
                y={b.y}
                width={b.w}
                height={b.h}
                rx={8}
                fill={selected ? '#dbeafe' : '#ffffff'}
                stroke={selected ? '#2563eb' : b.node.unreachable ? '#ef4444' : '#94a3b8'}
                strokeWidth={selected ? 2.4 : 1.4}
                strokeDasharray={b.node.unreachable ? '4 3' : undefined}
              />
              {lines.map((l, i) => (
                <text key={i} x={cx} y={cy + 4 + (i - (lines.length - 1) / 2) * 14} textAnchor="middle" fontSize={12} fontWeight={600} fill="#1e293b">{l}</text>
              ))}
            </g>
          );
        })}
      </svg>
    );
  };

  const unreachableCount = graph.nodes.filter((n) => n.kind === 'step' && n.unreachable).length;

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
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            閉じる
          </button>
        </div>

        {disabledReason ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <p className="max-w-md rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">{disabledReason}</p>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-rows-[1fr_auto] lg:grid-cols-[1fr_340px] lg:grid-rows-1">
            <div ref={figureRef} className="min-h-0 overflow-auto bg-slate-50 p-4">
              {unreachableCount > 0 && (
                <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  赤い点線の箱（{unreachableCount}件）はどこからもつながっていません。閲覧時には表示されません。
                </p>
              )}
              {renderFigure()}
              <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-4 rounded border border-slate-400 bg-white" />ステップ</span>
                <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rotate-45 border border-amber-600 bg-amber-50" />質問</span>
                <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0 w-5 border-t-2 border-dashed border-blue-600" />前に戻る（やり直し）</span>
              </div>
            </div>
            <div className="max-h-[45vh] overflow-auto border-t border-slate-200 p-4 lg:max-h-none lg:border-l lg:border-t-0">
              {selectedStep && selectedNode?.kind === 'question'
                ? renderQuestionPanel(selectedStep)
                : selectedStep
                  ? renderStepPanel(selectedStep)
                  : (
                    <div className="space-y-3 text-sm leading-6 text-slate-600">
                      <p className="font-semibold text-slate-800">図の箱を押すと操作が出ます。</p>
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
