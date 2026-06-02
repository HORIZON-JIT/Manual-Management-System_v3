'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import type { ImageAnnotation } from '@/types/instruction';

type Annotation = ImageAnnotation;

type Tool = 'select' | 'arrow' | 'circle' | 'rectangle' | 'number' | 'text';

interface ImageAnnotationEditorProps {
  imageDataUrl: string;
  originalImageDataUrl?: string;
  initialAnnotations?: Annotation[];
  onSave: (annotatedDataUrl: string, annotations: Annotation[]) => void;
  onRestore: () => void;
  onClose: () => void;
}

const DEFAULT_ANNOTATION_COLOR = '#EF4444';
const OUTLINE_COLOR = '#FFFFFF';
const ANNOTATION_COLORS = ['#EF4444', '#2563EB', '#16A34A', '#F59E0B', '#111827'];

export default function ImageAnnotationEditor({ imageDataUrl, originalImageDataUrl, initialAnnotations, onSave, onRestore, onClose }: ImageAnnotationEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [tool, setTool] = useState<Tool>('circle');
  const [annotations, setAnnotations] = useState<Annotation[]>(initialAnnotations ?? []);
  const [nextNumber, setNextNumber] = useState(() => {
    const maxNum = (initialAnnotations ?? [])
      .filter((a): a is Extract<Annotation, { type: 'number' }> => a.type === 'number')
      .reduce((m, a) => Math.max(m, a.value), 0);
    return maxNum + 1;
  });
  const [size, setSize] = useState(100);
  const [textValue, setTextValue] = useState('');
  const [color, setColor] = useState(DEFAULT_ANNOTATION_COLOR);
  const [drawing, setDrawing] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  const toCanvasCoords = useCallback((e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    return { x, y };
  }, []);

  const getAnnotationBounds = useCallback((annotation: Annotation, w: number, h: number) => {
    if (annotation.type === 'circle') {
      return {
        x: (annotation.cx - annotation.radiusX) * w,
        y: (annotation.cy - annotation.radiusY) * h,
        width: annotation.radiusX * 2 * w,
        height: annotation.radiusY * 2 * h,
      };
    }
    if (annotation.type === 'rectangle') {
      return { x: annotation.x * w, y: annotation.y * h, width: annotation.width * w, height: annotation.height * h };
    }
    if (annotation.type === 'arrow') {
      return {
        x: Math.min(annotation.x1, annotation.x2) * w,
        y: Math.min(annotation.y1, annotation.y2) * h,
        width: Math.abs(annotation.x2 - annotation.x1) * w,
        height: Math.abs(annotation.y2 - annotation.y1) * h,
      };
    }
    if (annotation.type === 'number') {
      const radius = Math.min(w, h) * 0.025 * annotation.scale;
      return { x: annotation.x * w - radius, y: annotation.y * h - radius, width: radius * 2, height: radius * 2 };
    }
    const fontSize = Math.max(14, Math.round(Math.min(w, h) * 0.035 * annotation.scale));
    return {
      x: annotation.x * w,
      y: annotation.y * h - fontSize / 2,
      width: Math.max(fontSize, annotation.value.length * fontSize * 0.62),
      height: fontSize,
    };
  }, []);

  const translateAnnotation = (annotation: Annotation, dx: number, dy: number): Annotation => {
    if (annotation.type === 'circle') return { ...annotation, cx: annotation.cx + dx, cy: annotation.cy + dy };
    if (annotation.type === 'rectangle') return { ...annotation, x: annotation.x + dx, y: annotation.y + dy };
    if (annotation.type === 'arrow') {
      return { ...annotation, x1: annotation.x1 + dx, y1: annotation.y1 + dy, x2: annotation.x2 + dx, y2: annotation.y2 + dy };
    }
    return { ...annotation, x: annotation.x + dx, y: annotation.y + dy };
  };

  const drawArrow = useCallback((ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, w: number, h: number, colorValue: string, scale = 1) => {
    const sx = x1 * w, sy = y1 * h, ex = x2 * w, ey = y2 * h;
    const headLen = Math.min(w, h) * 0.03 * scale;
    const angle = Math.atan2(ey - sy, ex - sx);
    const lineWidth = Math.max(2, Math.min(w, h) * 0.004 * scale);

    ctx.lineWidth = lineWidth + 3;
    ctx.strokeStyle = OUTLINE_COLOR;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();

    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = colorValue;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();

    ctx.fillStyle = colorValue;
    ctx.strokeStyle = OUTLINE_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - headLen * Math.cos(angle - Math.PI / 6), ey - headLen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(ex - headLen * Math.cos(angle + Math.PI / 6), ey - headLen * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }, []);

  const drawCircle = useCallback((ctx: CanvasRenderingContext2D, cx: number, cy: number, radiusX: number, radiusY: number, w: number, h: number, colorValue: string) => {
    const px = cx * w, py = cy * h, rx = radiusX * w, ry = radiusY * h;
    const lineWidth = Math.max(2, Math.min(w, h) * 0.004);

    ctx.lineWidth = lineWidth + 3;
    ctx.strokeStyle = OUTLINE_COLOR;
    ctx.beginPath();
    ctx.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = colorValue;
    ctx.beginPath();
    ctx.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  }, []);

  const drawRectangle = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, w: number, h: number, colorValue: string) => {
    const px = x * w, py = y * h, pw = width * w, ph = height * h;
    const lineWidth = Math.max(2, Math.min(w, h) * 0.004);

    ctx.lineWidth = lineWidth + 3;
    ctx.strokeStyle = OUTLINE_COLOR;
    ctx.strokeRect(px, py, pw, ph);

    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = colorValue;
    ctx.strokeRect(px, py, pw, ph);
  }, []);

  const drawNumber = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number, value: number, w: number, h: number, colorValue: string, scale = 1) => {
    const px = x * w, py = y * h;
    const r = Math.min(w, h) * 0.025 * scale;
    const fontSize = Math.round(r * 1.4);

    ctx.fillStyle = colorValue;
    ctx.strokeStyle = OUTLINE_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = OUTLINE_COLOR;
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(value), px, py + 1);
  }, []);

  const drawText = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number, value: string, w: number, h: number, colorValue: string, scale = 1) => {
    const px = x * w, py = y * h;
    const fontSize = Math.max(14, Math.round(Math.min(w, h) * 0.035 * scale));

    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(3, fontSize * 0.16);
    ctx.strokeStyle = OUTLINE_COLOR;
    ctx.strokeText(value, px, py);
    ctx.fillStyle = colorValue;
    ctx.fillText(value, px, py);
  }, []);

  const redraw = useCallback((anns: Annotation[], preview?: Annotation, showSelection = true) => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    for (const a of anns) {
      if (a.type === 'arrow') drawArrow(ctx, a.x1, a.y1, a.x2, a.y2, w, h, a.color, a.scale);
      else if (a.type === 'circle') drawCircle(ctx, a.cx, a.cy, a.radiusX, a.radiusY, w, h, a.color);
      else if (a.type === 'rectangle') drawRectangle(ctx, a.x, a.y, a.width, a.height, w, h, a.color);
      else if (a.type === 'number') drawNumber(ctx, a.x, a.y, a.value, w, h, a.color, a.scale);
      else if (a.type === 'text') drawText(ctx, a.x, a.y, a.value, w, h, a.color, a.scale);
    }

    if (preview?.type === 'arrow') {
      drawArrow(ctx, preview.x1, preview.y1, preview.x2, preview.y2, w, h, preview.color, preview.scale);
    } else if (preview?.type === 'circle') {
      drawCircle(ctx, preview.cx, preview.cy, preview.radiusX, preview.radiusY, w, h, preview.color);
    } else if (preview?.type === 'rectangle') {
      drawRectangle(ctx, preview.x, preview.y, preview.width, preview.height, w, h, preview.color);
    }

    if (showSelection && selectedIndex !== null && anns[selectedIndex] && !preview) {
      const bounds = getAnnotationBounds(anns[selectedIndex], w, h);
      ctx.save();
      ctx.strokeStyle = '#2563EB';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(bounds.x - 7, bounds.y - 7, bounds.width + 14, bounds.height + 14);
      ctx.restore();
    }
  }, [drawArrow, drawCircle, drawRectangle, drawNumber, drawText, getAnnotationBounds, selectedIndex]);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
      }
      setLoaded(true);
    };
    img.src = imageDataUrl;
  }, [imageDataUrl]);

  useEffect(() => {
    if (loaded) redraw(annotations);
  }, [loaded, annotations, selectedIndex, redraw]);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pt = toCanvasCoords(e);
    if (!pt) return;
    const canvas = canvasRef.current;

    if (tool === 'select' && canvas) {
      const index = [...annotations].reverse().findIndex((annotation) => {
        const bounds = getAnnotationBounds(annotation, canvas.width, canvas.height);
        const padding = 12;
        const px = pt.x * canvas.width;
        const py = pt.y * canvas.height;
        return (
          px >= bounds.x - padding &&
          px <= bounds.x + bounds.width + padding &&
          py >= bounds.y - padding &&
          py <= bounds.y + bounds.height + padding
        );
      });
      const actualIndex = index === -1 ? null : annotations.length - 1 - index;
      setSelectedIndex(actualIndex);
      if (actualIndex !== null) {
        setDrawing(true);
        setDragStart(pt);
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }
      return;
    }

    if (tool === 'arrow' || tool === 'circle' || tool === 'rectangle') {
      setSelectedIndex(null);
      setDrawing(true);
      setDragStart(pt);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing || !dragStart) return;
    const pt = toCanvasCoords(e);
    if (!pt) return;

    if (tool === 'select' && selectedIndex !== null) {
      const dx = pt.x - dragStart.x;
      const dy = pt.y - dragStart.y;
      setAnnotations((previous) =>
        previous.map((annotation, index) =>
          index === selectedIndex ? translateAnnotation(annotation, dx, dy) : annotation,
        ),
      );
      setDragStart(pt);
      return;
    }

    const canvas = canvasRef.current;
    if (tool === 'arrow') {
      redraw(annotations, { type: 'arrow', x1: dragStart.x, y1: dragStart.y, x2: pt.x, y2: pt.y, scale: size / 100, color });
    } else if (tool === 'circle' && canvas) {
      redraw(annotations, {
        type: 'circle',
        cx: dragStart.x,
        cy: dragStart.y,
        radiusX: Math.abs(pt.x - dragStart.x),
        radiusY: Math.abs(pt.y - dragStart.y),
        color,
      });
    } else if (tool === 'rectangle') {
      redraw(annotations, {
        type: 'rectangle',
        x: Math.min(dragStart.x, pt.x),
        y: Math.min(dragStart.y, pt.y),
        width: Math.abs(pt.x - dragStart.x),
        height: Math.abs(pt.y - dragStart.y),
        color,
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pt = toCanvasCoords(e);
    if (!pt) return;

    if (tool === 'select') {
      setDrawing(false);
      setDragStart(null);
    } else if (tool === 'arrow' && drawing && dragStart) {
      const dx = pt.x - dragStart.x, dy = pt.y - dragStart.y;
      if (Math.sqrt(dx * dx + dy * dy) > 0.02) {
        setAnnotations(prev => [...prev, { type: 'arrow', x1: dragStart.x, y1: dragStart.y, x2: pt.x, y2: pt.y, scale: size / 100, color }]);
      }
      setDrawing(false);
      setDragStart(null);
    } else if (tool === 'circle' && drawing && dragStart) {
      const radiusX = Math.abs(pt.x - dragStart.x);
      const radiusY = Math.abs(pt.y - dragStart.y);
      setAnnotations(prev => [...prev, {
        type: 'circle',
        cx: dragStart.x,
        cy: dragStart.y,
        radiusX: radiusX > 0.01 ? radiusX : 0.05 * (size / 100),
        radiusY: radiusY > 0.01 ? radiusY : 0.05 * (size / 100),
        color,
      }]);
      setDrawing(false);
      setDragStart(null);
    } else if (tool === 'rectangle' && drawing && dragStart) {
      const width = Math.abs(pt.x - dragStart.x);
      const height = Math.abs(pt.y - dragStart.y);
      setAnnotations(prev => [...prev, {
        type: 'rectangle',
        x: width > 0.01 ? Math.min(dragStart.x, pt.x) : pt.x - 0.06 * (size / 100),
        y: height > 0.01 ? Math.min(dragStart.y, pt.y) : pt.y - 0.04 * (size / 100),
        width: width > 0.01 ? width : 0.12 * (size / 100),
        height: height > 0.01 ? height : 0.08 * (size / 100),
        color,
      }]);
      setDrawing(false);
      setDragStart(null);
    } else if (tool === 'number') {
      setSelectedIndex(null);
      setAnnotations(prev => [...prev, { type: 'number', x: pt.x, y: pt.y, value: nextNumber, scale: size / 100, color }]);
      setNextNumber(n => n + 1);
    } else if (tool === 'text' && textValue.trim()) {
      setSelectedIndex(null);
      setAnnotations(prev => [...prev, { type: 'text', x: pt.x, y: pt.y, value: textValue.trim(), scale: size / 100, color }]);
    }
  };

  const handleUndo = () => {
    if (annotations.length === 0) return;
    const removed = annotations[annotations.length - 1];
    setAnnotations(prev => prev.slice(0, -1));
    setSelectedIndex(null);
    if (removed.type === 'number') {
      setNextNumber(removed.value);
    }
  };

  const handleReset = () => {
    setAnnotations([]);
    setNextNumber(1);
    setSelectedIndex(null);
  };

  const handleDeleteSelected = () => {
    if (selectedIndex === null) return;
    const removed = annotations[selectedIndex];
    setAnnotations((previous) => previous.filter((_, index) => index !== selectedIndex));
    if (removed?.type === 'number') setNextNumber(removed.value);
    setSelectedIndex(null);
  };

  const handleSave = () => {
    if (annotations.length === 0) {
      // 元々注釈が無く、何も描いていなければ変更なしで閉じる
      if (!initialAnnotations || initialAnnotations.length === 0) {
        onClose();
        return;
      }
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    redraw(annotations, undefined, false);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    onSave(dataUrl, annotations);
  };

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900">
        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            className="px-3 py-1.5 text-sm text-gray-300 hover:text-white transition"
          >
            リセット
          </button>
          {originalImageDataUrl && (
            <button
              onClick={() => {
                if (confirm('注釈を全て削除して元画像に戻しますか？')) onRestore();
              }}
              className="px-3 py-1.5 text-sm text-amber-400 hover:text-amber-300 transition"
            >
              元画像に戻す
            </button>
          )}
        </div>
        <span className="text-sm text-gray-400">画像注釈</span>
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm font-medium text-gray-200 border border-gray-600 rounded-lg transition hover:bg-gray-800 hover:text-white"
          >
            編集せず戻る
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-1.5 text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
          >
            完了
          </button>
        </div>
      </div>

      {/* Canvas area */}
      <div className="flex-1 flex items-center justify-center overflow-hidden bg-gray-950 px-2">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="max-w-full max-h-full object-contain"
          style={{ touchAction: 'none', userSelect: 'none' }}
        />
      </div>

      {/* Bottom toolbar */}
      <div className="flex flex-wrap items-center justify-center gap-3 px-4 py-3 bg-gray-900">
        <button
          onClick={handleUndo}
          disabled={annotations.length === 0}
          className="px-3 py-2 text-sm text-gray-300 hover:text-white disabled:opacity-30 transition"
        >
          ↩ 戻す
        </button>
        <button
          onClick={handleDeleteSelected}
          disabled={selectedIndex === null}
          className="px-3 py-2 text-sm text-red-300 transition hover:text-red-100 disabled:opacity-30"
        >
          削除
        </button>
        <div className="w-px h-6 bg-gray-700" />
        <button
          onClick={() => setTool('select')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            tool === 'select'
              ? 'bg-blue-600 text-white'
              : 'text-gray-300 hover:bg-gray-800'
          }`}
        >
          選択・移動
        </button>
        {([
          ['arrow', '➜ 矢印'],
          ['circle', '○ 丸'],
          ['rectangle', '□ 四角'],
          ['number', '① 番号'],
          ['text', 'T 文字'],
        ] as [Tool, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => {
              setTool(t);
              setSelectedIndex(null);
            }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              tool === t
                ? 'bg-blue-600 text-white'
                : 'text-gray-300 hover:bg-gray-800'
            }`}
          >
            {label}
          </button>
        ))}
        {tool === 'text' && (
          <input
            type="text"
            value={textValue}
            onChange={(event) => setTextValue(event.target.value)}
            placeholder="配置する文字を入力"
            className="h-10 w-56 rounded-lg border border-gray-700 bg-gray-800 px-3 text-sm text-white outline-none placeholder:text-gray-500 focus:border-blue-500"
          />
        )}
        <div className="mx-2 h-6 w-px bg-gray-700" />
        <div className="flex items-center gap-2" aria-label="注釈の色">
          {ANNOTATION_COLORS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setColor(option)}
              aria-label={`色 ${option}`}
              className={`h-7 w-7 rounded-full border-2 transition ${
                color === option ? 'border-white ring-2 ring-blue-500' : 'border-gray-600 hover:border-gray-300'
              }`}
              style={{ backgroundColor: option }}
            />
          ))}
          <input
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            aria-label="自由に色を選択"
            className="h-8 w-8 cursor-pointer rounded border border-gray-600 bg-transparent p-0.5"
          />
        </div>
        <div className="mx-2 h-6 w-px bg-gray-700" />
        <label className="flex items-center gap-3 text-sm text-gray-300">
          <span>サイズ</span>
          <input
            type="range"
            min={50}
            max={200}
            step={10}
            value={size}
            onChange={(event) => setSize(Number(event.target.value))}
            className="w-28 accent-blue-500"
          />
          <span className="w-10 text-right tabular-nums">{size}%</span>
        </label>
      </div>
    </div>
  );
}
