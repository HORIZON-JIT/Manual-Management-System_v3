'use client';

import { WorkInstruction } from '@/types/instruction';
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildFlowchart } from '@/lib/buildFlowchart';

interface Props {
  instruction: WorkInstruction;
  /** ノード（ステップ）をクリックしたときに呼ばれる。引数は step.id。 */
  onNodeClick?: (stepId: string) => void;
}

/**
 * 編集中に常時表示するライブのフロー図。
 * - steps/conditions の変更に応じて自動更新（デバウンス）。
 * - ノードをクリックすると onNodeClick(step.id) を呼び、該当ステップへ移動できる。
 */
export default function FlowPreview({ instruction, onNodeClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { definition, nodeStepIds } = useMemo(() => buildFlowchart(instruction), [instruction]);

  // ハンドラと対応表は最新を ref で参照（再描画ループを避ける）
  const onNodeClickRef = useRef(onNodeClick);
  onNodeClickRef.current = onNodeClick;
  const nodeStepIdsRef = useRef(nodeStepIds);
  nodeStepIdsRef.current = nodeStepIds;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const timer = window.setTimeout(async () => {
      try {
        const mermaid = (await import('mermaid')).default;
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
            .edgeLabel span, .edgeLabel p, .edgeLabel text { color: #374151 !important; font-size: 13px !important; }
            .label text, .nodeLabel, .edgeLabel { letter-spacing: 0 !important; }
            svg { max-width: none !important; height: auto !important; }
          `,
          flowchart: {
            useMaxWidth: false,
            htmlLabels: false,
            curve: 'linear',
            padding: 16,
            nodeSpacing: 44,
            rankSpacing: 56,
          },
        });

        const { svg } = await mermaid.render(`fcp-${Date.now()}`, definition);
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = svg;
        setError(null);

        // レンダリング後にノードへクリックハンドラを付与（mermaid の click 指定は使わない）
        const map = nodeStepIdsRef.current;
        containerRef.current.querySelectorAll('g.node').forEach((node) => {
          const rawId = node.getAttribute('id') ?? '';
          const matched = rawId.match(/(?:^|-)(s\d+)(?:-|$)/);
          const stepId = matched ? map[matched[1]] : undefined;
          if (!stepId) return;
          (node as SVGGElement).style.cursor = 'pointer';
          node.addEventListener('click', () => onNodeClickRef.current?.(stepId));
        });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'フロー図の生成に失敗しました');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 400);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [definition]);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <p className="text-[11px] text-slate-400">クリックで該当ステップへ移動</p>
        {loading && <span className="text-[11px] text-slate-400">更新中...</span>}
      </div>
      <div className="max-h-[55vh] overflow-auto rounded-md bg-slate-50/60">
        {error ? (
          <p className="py-6 text-center text-xs text-red-600">{error}</p>
        ) : (
          <div ref={containerRef} className="flex min-w-max justify-center p-2 [&_svg]:h-auto" />
        )}
      </div>
    </div>
  );
}
