'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { saveAs } from 'file-saver';

interface QrCodeModalProps {
  url: string;
  title: string;
  subtitle?: string;
  onClose: () => void;
}

const QR_PX = 320;

/** 手順書をビューアで開く QR コード。画面表示・PNG 保存・URL コピー・印刷ができる */
export default function QrCodeModal({ url, title, subtitle, onClose }: QrCodeModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    QRCode.toCanvas(canvas, url, { width: QR_PX, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#0a0a0a', light: '#ffffff' } })
      .then(() => setError(null))
      .catch((e) => setError(e instanceof Error ? e.message : 'QR コードを作成できませんでした。'));
  }, [url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 失敗しても URL は画面に出ているので手でコピーできる
    }
  };

  /** QR＋手順書名＋URL を 1 枚の PNG にして保存する（掲示物にそのまま使える） */
  const handleSavePng = async () => {
    const qr = canvasRef.current;
    if (!qr) return;
    const scale = 3; // 印刷しても粗くならないよう大きめに描く
    const pad = 32 * scale;
    const qrSize = QR_PX * scale;
    const titleSize = 22 * scale;
    const subSize = 13 * scale;
    const width = qrSize + pad * 2;
    const out = document.createElement('canvas');
    const ctx = out.getContext('2d');
    if (!ctx) return;
    ctx.font = `bold ${titleSize}px "Noto Sans JP", "Yu Gothic", "Meiryo", sans-serif`;
    const titleLines = wrapText(ctx, title, width - pad * 2);
    ctx.font = `${subSize}px sans-serif`;
    const urlLines = wrapText(ctx, url, width - pad * 2);
    const subLines = subtitle ? wrapText(ctx, subtitle, width - pad * 2) : [];
    const height = pad + qrSize + pad * 0.6 + titleLines.length * titleSize * 1.4 + subLines.length * subSize * 1.5 + urlLines.length * subSize * 1.5 + pad;
    out.width = width;
    out.height = Math.ceil(height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(qr, pad, pad, qrSize, qrSize);
    let y = pad + qrSize + pad * 0.6;
    ctx.fillStyle = '#0a0a0a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `bold ${titleSize}px "Noto Sans JP", "Yu Gothic", "Meiryo", sans-serif`;
    for (const line of titleLines) { ctx.fillText(line, width / 2, y); y += titleSize * 1.4; }
    ctx.fillStyle = '#525252';
    ctx.font = `${subSize}px "Noto Sans JP", "Yu Gothic", "Meiryo", sans-serif`;
    for (const line of subLines) { ctx.fillText(line, width / 2, y); y += subSize * 1.5; }
    ctx.fillStyle = '#737373';
    ctx.font = `${subSize}px sans-serif`;
    for (const line of urlLines) { ctx.fillText(line, width / 2, y); y += subSize * 1.5; }
    out.toBlob((blob) => {
      if (blob) saveAs(blob, `手順書QR_${title.replace(/[\\/:*?"<>|]/g, '_') || 'manual'}.png`);
    }, 'image/png');
  };

  const handlePrint = () => {
    const qr = canvasRef.current;
    if (!qr) return;
    const dataUrl = qr.toDataURL('image/png');
    const win = window.open('', '_blank', 'width=720,height=900');
    if (!win) {
      alert('印刷用のウィンドウを開けませんでした。ポップアップを許可するか、「PNG を保存」を使ってください。');
      return;
    }
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
    win.document.write(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${esc(title)} QR</title>
<style>body{margin:0;font-family:"Noto Sans JP","Yu Gothic","Meiryo",sans-serif;color:#0a0a0a;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{text-align:center;padding:24mm 16mm}img{width:90mm;height:90mm}h1{font-size:22pt;margin:10mm 0 4mm}p{margin:0;color:#525252;font-size:11pt}.url{margin-top:6mm;color:#737373;font-size:9pt;word-break:break-all}
@media print{@page{size:A4 portrait;margin:15mm}}</style></head><body><div class="card"><img src="${dataUrl}" alt="QR"><h1>${esc(title)}</h1>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}<p class="url">${esc(url)}</p><p style="margin-top:8mm">スマートフォンのカメラで読み取ると手順書が開きます</p></div>
<script>window.addEventListener('load',function(){setTimeout(function(){window.print();},200);});</script></body></html>`);
    win.document.close();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-slate-950">QR コード</h3>
            <p className="mt-0.5 text-xs text-slate-500">スマートフォンのカメラで読み取ると、閲覧専用ビューアで手順書が開きます。</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50">閉じる</button>
        </div>
        <div className="flex flex-col items-center rounded-xl border border-slate-200 bg-white p-4">
          <canvas ref={canvasRef} width={QR_PX} height={QR_PX} className="h-60 w-60" aria-label={`${title} の QR コード`} />
          <p className="mt-3 text-center text-sm font-semibold text-slate-900">{title}</p>
          {subtitle && <p className="mt-0.5 text-center text-xs text-slate-500">{subtitle}</p>}
          <p className="mt-2 w-full break-all rounded-md bg-slate-50 px-3 py-2 text-center font-mono text-[11px] text-slate-500">{url}</p>
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <button type="button" onClick={handleSavePng} className="rounded-lg bg-slate-950 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800">PNG を保存</button>
          <button type="button" onClick={handlePrint} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-50">印刷</button>
          <button type="button" onClick={handleCopy} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-50">{copied ? 'コピーしました' : 'URL をコピー'}</button>
        </div>
      </div>
    </div>
  );
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const ch of text) {
    if (ctx.measureText(cur + ch).width > maxWidth && cur) {
      lines.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}
