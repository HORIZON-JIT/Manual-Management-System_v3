'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Step } from '@/types/instruction';
import { buildFlowGraph, sortSteps, FlowGraph } from '@/lib/flowModel';
import { layoutFlow, FlowLayout, LayoutBox } from '@/lib/flowLayout';

/**
 * 手順の流れ図（ELK 自動配置の SVG）。
 * 「図で分岐を組み立てる」と「作成中のフローチャートを表示」で同じ見た目を共有する。
 */
interface FlowFigureProps {
  steps: Step[];
  /** 強調表示する箱（ステップID または質問ノードID） */
  selectedId?: string | null;
  /** 箱を押したとき。未指定なら閲覧専用（押せない） */
  onBoxClick?: (box: LayoutBox) => void;
  /** 図の計算が終わったときに呼ばれる（グラフと寸法を渡す） */
  onGraph?: (graph: FlowGraph) => void;
}

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

export function FlowLegend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
      <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-4 rounded border border-slate-400 bg-white" />ステップ</span>
      <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rotate-45 border border-amber-600 bg-amber-50" />質問</span>
      <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0 w-5 border-t-2 border-dashed border-blue-600" />前に戻る（やり直し）</span>
    </div>
  );
}

export default function FlowFigure({ steps, selectedId = null, onBoxClick, onGraph }: FlowFigureProps) {
  const [layout, setLayout] = useState<FlowLayout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);
  const interactive = !!onBoxClick;

  const sorted = useMemo(() => sortSteps(steps), [steps]);
  const graph = useMemo(() => buildFlowGraph(sorted), [sorted]);

  useEffect(() => {
    onGraph?.(graph);
  }, [graph, onGraph]);

  useEffect(() => {
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
  }, [graph]);

  if (error) return <p className="py-8 text-center text-sm text-red-600">図の計算に失敗しました: {error}</p>;
  if (!layout) return <p className="py-8 text-center text-sm text-slate-500">図を描いています…</p>;
  const { minX, width, height } = layout;
  const placeholderLabel = interactive ? '＋ 次を追加' : '（未設定）';
  return (
    <svg
      viewBox={`${minX} 0 ${width} ${height}`}
      width={width}
      height={height}
      className="mx-auto block max-w-none select-none"
      role="img"
      aria-label="手順の流れ図"
      xmlns="http://www.w3.org/2000/svg"
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
        const clickable = interactive && b.kind !== 'start' && b.kind !== 'end';
        const common = { onClick: clickable ? () => onBoxClick?.(b) : undefined, className: clickable ? 'cursor-pointer' : undefined };
        if (b.kind === 'start' || b.kind === 'end') {
          return (
            <g key={b.id} {...common}>
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
                stroke={selected ? '#2563eb' : b.node.unreachable ? '#ef4444' : '#d97706'}
                strokeWidth={selected ? 2.4 : 1.6}
                strokeDasharray={b.node.unreachable ? '4 3' : undefined}
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
              <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={8} fill={interactive ? '#eff6ff' : '#f8fafc'} stroke={interactive ? '#60a5fa' : '#cbd5e1'} strokeWidth={1.4} strokeDasharray="4 3" />
              <text x={cx} y={cy + 4} textAnchor="middle" fontSize={12} fill={interactive ? '#1d4ed8' : '#64748b'}>{placeholderLabel}</text>
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
}
