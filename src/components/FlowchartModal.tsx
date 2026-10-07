'use client';

import { WorkInstruction } from '@/types/instruction';
import { useEffect, useRef, useState } from 'react';
import { buildFlowchartDefinition } from '@/lib/buildFlowchart';
import FlowFigure, { FlowLegend } from './FlowFigure';

interface Props {
  instruction: WorkInstruction;
  onClose: () => void;
}

export default function FlowchartModal({ instruction, onClose }: Props) {
  // 条件グループを使わない手順書は「図で分岐を組み立てる」と同じ図（ELK）で表示する。
  // 条件グループを使う手順書は従来どおり Mermaid で描く。
  const useFlowFigure = (instruction.conditions?.length ?? 0) === 0;
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const svgRef = useRef<string>('');
  const mermaidRef = useRef<string>('');
  const [mermaidCopied, setMermaidCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (useFlowFigure) {
      setLoading(false);
      return;
    }

    async function render() {
      try {
        const mermaidModule = await import('mermaid');
        const mermaid = mermaidModule.default;

        mermaid.initialize({
          startOnLoad: false,
          theme: 'base',
          themeVariables: {
            fontFamily: 'Inter, "Noto Sans JP", "Yu Gothic UI", sans-serif',
            lineColor: '#6b7280',
            primaryTextColor: '#111827',
            clusterBkg: '#ffffff',
            clusterBorder: '#e5e7eb',
          },
          themeCSS: `
            .edgeLabel rect { fill: #ffffff !important; opacity: 0.96; }
            .edgeLabel span, .edgeLabel p, .edgeLabel text { color: #374151 !important; font-size: 14px !important; }
            .label text, .nodeLabel, .edgeLabel { letter-spacing: 0 !important; }
            svg { max-width: none !important; height: auto !important; }
          `,
          flowchart: {
            useMaxWidth: false,
            htmlLabels: false,
            curve: 'linear',
            padding: 24,
            nodeSpacing: 64,
            rankSpacing: 84,
          },
        });

        const definition = buildFlowchartDefinition(instruction);
        mermaidRef.current = definition;
        const { svg } = await mermaid.render(`fc-${Date.now()}`, definition);

        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          svgRef.current = containerRef.current.innerHTML;
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e ?? 'フロー図の生成に失敗しました'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    render();
    return () => {
      cancelled = true;
    };
  }, [instruction, useFlowFigure]);

  const downloadSvg = () => {
    const svgText = useFlowFigure ? containerRef.current?.querySelector('svg')?.outerHTML ?? '' : svgRef.current;
    if (!svgText) return;
    const blob = new Blob([svgText], { type: 'image/svg+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${instruction.title}_フロー図.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const copyMermaid = () => {
    navigator.clipboard.writeText(mermaidRef.current);
    setMermaidCopied(true);
    setTimeout(() => setMermaidCopied(false), 2000);
  };

  const downloadMermaid = () => {
    const blob = new Blob([mermaidRef.current], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${instruction.title}_フロー図.mmd`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[calc(100vh-24px)] w-[calc(100vw-24px)] max-w-none flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-950">フロー図</h2>
            <p className="truncate text-xs text-slate-500">{instruction.title || '（無題）'}</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            閉じる
          </button>
        </div>

        <div className={`flex-1 overflow-auto ${useFlowFigure ? 'bg-slate-50 p-4' : 'p-6'}`}>
          {loading && <p className="py-8 text-center text-sm text-gray-500">読み込み中...</p>}
          {error && <p className="py-8 text-center text-sm text-red-600">{error}</p>}
          {useFlowFigure ? (
            <div ref={containerRef}>
              <FlowFigure steps={instruction.steps} />
              <div className="mt-4"><FlowLegend /></div>
            </div>
          ) : (
            <div ref={containerRef} className="flex min-w-max justify-center overflow-visible" />
          )}
        </div>

        {!loading && !error && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-6 py-3">
            {!useFlowFigure && (
            <button
              onClick={copyMermaid}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100"
            >
              {mermaidCopied ? 'コピー済み' : 'Mermaidをコピー'}
            </button>
            )}
            {!useFlowFigure && (
            <button
              onClick={downloadMermaid}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100"
            >
              Mermaidを保存
            </button>
            )}
            <button
              onClick={downloadSvg}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100"
            >
              SVGを保存
            </button>
            <button
              onClick={onClose}
              className="rounded-lg bg-slate-600 px-3 py-1.5 text-sm text-white transition hover:bg-slate-700"
            >
              閉じる
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
