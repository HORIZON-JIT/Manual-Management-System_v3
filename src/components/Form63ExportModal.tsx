'use client';

import { useEffect, useMemo, useState } from 'react';
import { saveAs } from 'file-saver';
import { WorkInstruction } from '@/types/instruction';
import { buildForm63, form63FileName } from '@/lib/exportForm63';
import { exportTextForAI, exportTextBody, parseRewrittenText, summarizeRewritten, RewrittenText } from '@/lib/formalTextRoundTrip';

interface Props {
  instruction: WorkInstruction;
  onClose: () => void;
}

const GEMINI_URL = 'https://gemini.google.com/app';

const sectionLabel = 'text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400';
const neutralBtn = 'rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';
const accentBtn = 'brand-border brand-text rounded-lg border bg-white px-3 py-2.5 text-sm font-semibold transition hover:bg-[#faf7f1] disabled:cursor-not-allowed disabled:opacity-50';
const primaryBtn = 'rounded-lg bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(15,23,42,0.18)] transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50';

export default function Form63ExportModal({ instruction, onClose }: Props) {
  const [pasted, setPasted] = useState('');
  const [includeImages, setIncludeImages] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; kind: 'info' | 'error' } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rewritten: RewrittenText | null = useMemo(() => {
    if (!pasted.trim()) return null;
    return parseRewrittenText(pasted, instruction);
  }, [pasted, instruction]);
  const summary = rewritten ? summarizeRewritten(rewritten, instruction) : null;

  const copyText = async (withInstruction: boolean): Promise<boolean> => {
    const text = withInstruction ? exportTextForAI(instruction) : exportTextBody(instruction);
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // クリップボードが使えない環境: テキスト欄に出して手でコピーしてもらう
      setPasted('');
      setMessage({ text: 'クリップボードにコピーできませんでした。下の欄の文章を選択してコピーしてください。', kind: 'error' });
      setFallbackText(text);
      return false;
    }
  };
  const [fallbackText, setFallbackText] = useState('');

  const handleGemini = async () => {
    const win = window.open(GEMINI_URL, '_blank', 'noopener');
    const ok = await copyText(true);
    if (ok) setMessage({ text: 'Gemini を開きました。入力欄に貼り付け（Ctrl+V）て送信し、返ってきた文章を下の欄に貼り付けてください。', kind: 'info' });
    if (!win) setMessage({ text: 'Gemini のタブを開けませんでした（ポップアップがブロックされた可能性）。文章はコピー済みなので、Gemini を開いて貼り付けてください。', kind: 'info' });
  };

  const handleCopyOnly = async () => {
    const ok = await copyText(true);
    if (ok) setMessage({ text: '指示文と手順書の文章をコピーしました。お使いの AI に貼り付けてください。', kind: 'info' });
  };

  const handleExport = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const source = includeImages ? instruction : { ...instruction, steps: instruction.steps.map((s) => ({ ...s, imageDataUrl: undefined, imageDataUrls: undefined })) };
      const blob = await buildForm63(source, { rewritten });
      saveAs(blob, form63FileName(instruction));
      setMessage({ text: 'Word ファイルを作成しました。ダウンロード先を確認してください。', kind: 'info' });
    } catch (e) {
      setMessage({ text: `Word の作成に失敗しました: ${e instanceof Error ? e.message : String(e)}`, kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[calc(100vh-16px)] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-950">社内規定作業手順書（様式6-3号）で出力</h2>
            <p className="truncate text-xs text-slate-500">会社規定の作業手順書用紙に、画像つきで Word として書き出します。</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50">
            閉じる
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-auto px-4 py-5 sm:px-6">
          <section>
            <p className={sectionLabel}>1. 文章を堅い文体にする（任意）</p>
            <p className="mt-1.5 text-xs leading-5 text-slate-500">
              手順書の文章をそのまま載せる場合は飛ばせます。書き直す場合は、指示文つきの文章を AI に渡し、返ってきた文章を下の欄に貼り付けてください。画像はアプリ側で付けます。
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={handleGemini} className={accentBtn}>Gemini で文章を書き直す（コピーして開く）</button>
              <button type="button" onClick={handleCopyOnly} className={neutralBtn}>文章をコピーだけする</button>
            </div>
            {fallbackText && (
              <textarea readOnly value={fallbackText} className="mt-3 h-32 w-full rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-700" onFocus={(e) => e.currentTarget.select()} />
            )}
            <label className="mt-4 block">
              <span className="mb-1.5 block text-xs font-semibold text-slate-600">書き直した文章を貼り付け</span>
              <textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder="AI から返ってきた文章をそのまま貼り付けてください（「## [S1] …」の行が目印になります）"
                className="h-40 w-full rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
              />
            </label>
            {summary && (
              <p className={`mt-1.5 text-xs leading-5 ${summary.replaced === summary.total ? 'text-emerald-700' : 'text-amber-700'}`}>
                {summary.total} ステップ中 {summary.replaced} ステップの文章を置き換えます。
                {summary.missing.length > 0 && ` 見つからなかったステップは元の文章を使います: ${summary.missing.join('、')}`}
              </p>
            )}
          </section>

          <section>
            <p className={sectionLabel}>2. 含めるもの</p>
            <div className="mt-2 flex flex-wrap gap-4 text-sm text-slate-700">
              <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={includeImages} onChange={(e) => setIncludeImages(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />各ステップの画像</label>
            </div>
          </section>

          <section>
            <p className={sectionLabel}>3. 出力</p>
            <button type="button" onClick={handleExport} disabled={busy} className={`${primaryBtn} mt-2 w-full`}>
              {busy ? '作成中...' : 'Word を作成'}
            </button>
            <p className="mt-2 text-[11px] leading-5 text-slate-400">
              正式な雛形（様式6-3号）に内容を流し込みます。文書番号と承認・審査の欄は空欄、改訂履歴は更新履歴から入れます。
            </p>
            {message && (
              <p className={`mt-2 rounded-lg px-3 py-2 text-xs leading-5 ${message.kind === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{message.text}</p>
            )}
          </section>
        </div>

      </div>
    </div>
  );
}
