'use client';

import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import type { ImageAnnotation } from '@/types/instruction';

type Annotation = ImageAnnotation;

type Tool = 'select' | 'arrow' | 'line' | 'circle' | 'rectangle' | 'highlight' | 'mosaic' | 'fill' | 'number' | 'text' | 'crop';
type RectAnn = Extract<Annotation, { type: 'rectangle' | 'highlight' | 'mosaic' | 'fill' }>;
type LineAnn = Extract<Annotation, { type: 'arrow' | 'line' }>;
type Rect = { x: number; y: number; width: number; height: number };

interface ImageAnnotationEditorProps {
  imageDataUrl: string;
  originalImageDataUrl?: string;
  initialAnnotations?: Annotation[];
  /** baseDataUrl は切り抜きで下地が変わったときだけ渡る */
  onSave: (annotatedDataUrl: string, annotations: Annotation[], baseDataUrl?: string) => void;
  onRestore: () => void;
  onClose: () => void;
}

const DEFAULT_ANNOTATION_COLOR = '#EF4444';
const OUTLINE_COLOR = '#FFFFFF';
const ANNOTATION_COLORS = ['#EF4444', '#2563EB', '#16A34A', '#F59E0B', '#111827'];
const DRAG_TOOLS: Tool[] = ['arrow', 'line', 'circle', 'rectangle', 'highlight', 'mosaic', 'fill', 'crop'];
const TOOL_KEYS: Record<string, Tool> = { '1': 'select', '2': 'arrow', '3': 'line', '4': 'circle', '5': 'rectangle', '6': 'highlight', '7': 'mosaic', '8': 'fill', '9': 'number', '0': 'text' };
const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'select', label: '選択・移動', hint: '1' },
  { id: 'arrow', label: '➜ 矢印', hint: '2' },
  { id: 'line', label: '─ 直線', hint: '3' },
  { id: 'circle', label: '○ 丸', hint: '4' },
  { id: 'rectangle', label: '□ 四角', hint: '5' },
  { id: 'highlight', label: '▮ ハイライト', hint: '6' },
  { id: 'mosaic', label: '▦ モザイク', hint: '7' },
  { id: 'fill', label: '■ 塗りつぶし', hint: '8' },
  { id: 'number', label: '① 番号', hint: '9' },
  { id: 'text', label: 'T 文字', hint: '0' },
  { id: 'crop', label: '⌗ 切り抜き', hint: '' },
];
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4];

function isRectAnn(a: Annotation): a is RectAnn {
  return a.type === 'rectangle' || a.type === 'highlight' || a.type === 'mosaic' || a.type === 'fill';
}
function isLineAnn(a: Annotation): a is LineAnn {
  return a.type === 'arrow' || a.type === 'line';
}
function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return `rgba(245,158,11,${alpha})`;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${alpha})`;
}
function normRect(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

export default function ImageAnnotationEditor({ imageDataUrl, originalImageDataUrl, initialAnnotations, onSave, onRestore, onClose }: ImageAnnotationEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [baseDataUrl, setBaseDataUrl] = useState(imageDataUrl);
  const baseChangedRef = useRef(false);
  const [tool, setTool] = useState<Tool>('circle');
  const [annotations, setAnnotations] = useState<Annotation[]>(initialAnnotations ?? []);
  const [numberMode, setNumberMode] = useState<'auto' | 'manual'>('auto');
  const [manualNumber, setManualNumber] = useState(1);
  const [size, setSize] = useState(100);
  const [textValue, setTextValue] = useState('');
  const [textBackground, setTextBackground] = useState(true);
  const [color, setColor] = useState(DEFAULT_ANNOTATION_COLOR);
  const [drawing, setDrawing] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [cropRect, setCropRect] = useState<Rect | null>(null);
  const [natural, setNatural] = useState({ w: 1, h: 1 });
  const [zoom, setZoom] = useState(1);
  const [fitMode, setFitMode] = useState(true);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  // 元に戻す／やり直し
  const historyRef = useRef<{ stack: Annotation[][]; index: number }>({ stack: [initialAnnotations ?? []], index: 0 });
  const [historyVersion, setHistoryVersion] = useState(0);
  const commit = useCallback((next: Annotation[]) => {
    const h = historyRef.current;
    h.stack = [...h.stack.slice(0, h.index + 1), next].slice(-100);
    h.index = h.stack.length - 1;
    setAnnotations(next);
    setHistoryVersion((v) => v + 1);
  }, []);
  const canUndo = historyRef.current.index > 0;
  const canRedo = historyRef.current.index < historyRef.current.stack.length - 1;
  const undo = useCallback(() => {
    const h = historyRef.current;
    if (h.index <= 0) return;
    h.index -= 1;
    setAnnotations(h.stack[h.index]);
    setSelectedIndex(null);
    setHistoryVersion((v) => v + 1);
  }, []);
  const redo = useCallback(() => {
    const h = historyRef.current;
    if (h.index >= h.stack.length - 1) return;
    h.index += 1;
    setAnnotations(h.stack[h.index]);
    setSelectedIndex(null);
    setHistoryVersion((v) => v + 1);
  }, []);
  void historyVersion;

  const nextNumber = useMemo(
    () => annotations.filter((a): a is Extract<Annotation, { type: 'number' }> => a.type === 'number' && a.mode !== 'manual').reduce((m, a) => Math.max(m, a.value), 0) + 1,
    [annotations],
  );

  /* ---- 座標 ---- */
  const toCanvasCoords = useCallback((e: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  }, []);

  const getAnnotationBounds = useCallback((annotation: Annotation, w: number, h: number) => {
    if (annotation.type === 'circle') {
      return { x: (annotation.cx - annotation.radiusX) * w, y: (annotation.cy - annotation.radiusY) * h, width: annotation.radiusX * 2 * w, height: annotation.radiusY * 2 * h };
    }
    if (isRectAnn(annotation)) {
      return { x: annotation.x * w, y: annotation.y * h, width: annotation.width * w, height: annotation.height * h };
    }
    if (isLineAnn(annotation)) {
      return { x: Math.min(annotation.x1, annotation.x2) * w, y: Math.min(annotation.y1, annotation.y2) * h, width: Math.abs(annotation.x2 - annotation.x1) * w, height: Math.abs(annotation.y2 - annotation.y1) * h };
    }
    if (annotation.type === 'number') {
      const radius = Math.min(w, h) * 0.025 * annotation.scale;
      return { x: annotation.x * w - radius, y: annotation.y * h - radius, width: radius * 2, height: radius * 2 };
    }
    const fontSize = Math.max(14, Math.round(Math.min(w, h) * 0.035 * annotation.scale));
    return { x: annotation.x * w, y: annotation.y * h - fontSize / 2, width: Math.max(fontSize, annotation.value.length * fontSize * 0.62), height: fontSize };
  }, []);

  const translateAnnotation = (annotation: Annotation, dx: number, dy: number): Annotation => {
    if (annotation.type === 'circle') return { ...annotation, cx: annotation.cx + dx, cy: annotation.cy + dy };
    if (isRectAnn(annotation)) return { ...annotation, x: annotation.x + dx, y: annotation.y + dy };
    if (isLineAnn(annotation)) return { ...annotation, x1: annotation.x1 + dx, y1: annotation.y1 + dy, x2: annotation.x2 + dx, y2: annotation.y2 + dy };
    return { ...annotation, x: annotation.x + dx, y: annotation.y + dy };
  };

  /* ---- 描画 ---- */
  const strokeTwice = (ctx: CanvasRenderingContext2D, path: () => void, lineWidth: number, colorValue: string) => {
    ctx.lineWidth = lineWidth + 3;
    ctx.strokeStyle = OUTLINE_COLOR;
    ctx.beginPath(); path(); ctx.stroke();
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = colorValue;
    ctx.beginPath(); path(); ctx.stroke();
  };

  const drawLineLike = useCallback((ctx: CanvasRenderingContext2D, a: LineAnn, w: number, h: number) => {
    const sx = a.x1 * w, sy = a.y1 * h, ex = a.x2 * w, ey = a.y2 * h;
    const lineWidth = Math.max(2, Math.min(w, h) * 0.004 * a.scale);
    ctx.lineCap = 'round';
    strokeTwice(ctx, () => { ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); }, lineWidth, a.color);
    if (a.type === 'arrow') {
      const headLen = Math.min(w, h) * 0.03 * a.scale;
      const angle = Math.atan2(ey - sy, ex - sx);
      ctx.fillStyle = a.color;
      ctx.strokeStyle = OUTLINE_COLOR;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - headLen * Math.cos(angle - Math.PI / 6), ey - headLen * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(ex - headLen * Math.cos(angle + Math.PI / 6), ey - headLen * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }, []);

  const drawCircle = useCallback((ctx: CanvasRenderingContext2D, cx: number, cy: number, radiusX: number, radiusY: number, w: number, h: number, colorValue: string) => {
    const px = cx * w, py = cy * h, rx = radiusX * w, ry = radiusY * h;
    strokeTwice(ctx, () => ctx.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2), Math.max(2, Math.min(w, h) * 0.004), colorValue);
  }, []);

  const drawRectangle = useCallback((ctx: CanvasRenderingContext2D, r: Rect, w: number, h: number, colorValue: string) => {
    strokeTwice(ctx, () => ctx.rect(r.x * w, r.y * h, r.width * w, r.height * h), Math.max(2, Math.min(w, h) * 0.004), colorValue);
  }, []);

  const drawHighlight = useCallback((ctx: CanvasRenderingContext2D, r: Rect, w: number, h: number, colorValue: string) => {
    ctx.fillStyle = hexToRgba(colorValue, 0.35);
    ctx.fillRect(r.x * w, r.y * h, r.width * w, r.height * h);
  }, []);

  const drawFill = useCallback((ctx: CanvasRenderingContext2D, r: Rect, w: number, h: number, colorValue: string) => {
    ctx.fillStyle = colorValue;
    ctx.fillRect(r.x * w, r.y * h, r.width * w, r.height * h);
  }, []);

  const drawMosaic = useCallback((ctx: CanvasRenderingContext2D, r: Rect, w: number, h: number) => {
    const img = imgRef.current;
    if (!img) return;
    const sx = Math.max(0, Math.floor(r.x * w)), sy = Math.max(0, Math.floor(r.y * h));
    const sw = Math.min(w - sx, Math.ceil(r.width * w)), sh = Math.min(h - sy, Math.ceil(r.height * h));
    if (sw < 2 || sh < 2) return;
    const block = Math.max(8, Math.round(Math.min(w, h) * 0.014));
    const tw = Math.max(1, Math.round(sw / block)), th = Math.max(1, Math.round(sh / block));
    const off = document.createElement('canvas');
    off.width = tw; off.height = th;
    const octx = off.getContext('2d');
    if (!octx) return;
    octx.imageSmoothingEnabled = true;
    octx.drawImage(img, sx, sy, sw, sh, 0, 0, tw, th);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, tw, th, sx, sy, sw, sh);
    ctx.restore();
  }, []);

  const drawNumber = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number, value: number, w: number, h: number, colorValue: string, scale = 1) => {
    const px = x * w, py = y * h;
    const r = Math.min(w, h) * 0.025 * scale;
    ctx.fillStyle = colorValue;
    ctx.strokeStyle = OUTLINE_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = OUTLINE_COLOR;
    ctx.font = `bold ${Math.round(r * 1.4)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(value), px, py + 1);
  }, []);

  const drawText = useCallback((ctx: CanvasRenderingContext2D, a: Extract<Annotation, { type: 'text' }>, w: number, h: number) => {
    const px = a.x * w, py = a.y * h;
    const fontSize = Math.max(14, Math.round(Math.min(w, h) * 0.035 * a.scale));
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    if (a.background) {
      const tw = ctx.measureText(a.value).width;
      const pad = fontSize * 0.35;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.strokeStyle = a.color;
      ctx.lineWidth = Math.max(1.5, fontSize * 0.06);
      ctx.beginPath();
      ctx.roundRect(px - pad, py - fontSize / 2 - pad * 0.6, tw + pad * 2, fontSize + pad * 1.2, fontSize * 0.25);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = a.color;
      ctx.fillText(a.value, px, py);
      return;
    }
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(3, fontSize * 0.16);
    ctx.strokeStyle = OUTLINE_COLOR;
    ctx.strokeText(a.value, px, py);
    ctx.fillStyle = a.color;
    ctx.fillText(a.value, px, py);
  }, []);

  const drawOne = useCallback((ctx: CanvasRenderingContext2D, a: Annotation, w: number, h: number) => {
    if (a.type === 'mosaic') drawMosaic(ctx, a, w, h);
    else if (a.type === 'fill') drawFill(ctx, a, w, h, a.color);
    else if (a.type === 'highlight') drawHighlight(ctx, a, w, h, a.color);
    else if (isLineAnn(a)) drawLineLike(ctx, a, w, h);
    else if (a.type === 'circle') drawCircle(ctx, a.cx, a.cy, a.radiusX, a.radiusY, w, h, a.color);
    else if (a.type === 'rectangle') drawRectangle(ctx, a, w, h, a.color);
    else if (a.type === 'number') drawNumber(ctx, a.x, a.y, a.value, w, h, a.color, a.scale);
    else if (a.type === 'text') drawText(ctx, a, w, h);
  }, [drawMosaic, drawFill, drawHighlight, drawLineLike, drawCircle, drawRectangle, drawNumber, drawText]);

  const redraw = useCallback((anns: Annotation[], preview?: Annotation | { type: 'crop'; rect: Rect }, showSelection = true, cropOverlay: Rect | null = null) => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    // 隠す（モザイク・塗りつぶし）→ 強調 → 線や文字 の順に描く
    const order = (a: Annotation) => (a.type === 'mosaic' || a.type === 'fill' ? 0 : a.type === 'highlight' ? 1 : 2);
    for (const a of [...anns].sort((x, y) => order(x) - order(y))) drawOne(ctx, a, w, h);
    if (preview && preview.type !== 'crop') drawOne(ctx, preview, w, h);

    const crop = preview && preview.type === 'crop' ? preview.rect : cropOverlay;
    if (crop) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.rect(crop.x * w, crop.y * h, crop.width * w, crop.height * h);
      ctx.fill('evenodd');
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(crop.x * w, crop.y * h, crop.width * w, crop.height * h);
      ctx.restore();
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
  }, [drawOne, getAnnotationBounds, selectedIndex]);

  /* ---- 画像の読み込み・表示倍率 ---- */
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const canvas = canvasRef.current;
      if (canvas) { canvas.width = img.naturalWidth; canvas.height = img.naturalHeight; }
      setNatural({ w: img.naturalWidth, h: img.naturalHeight });
      setLoaded(true);
    };
    img.src = baseDataUrl;
  }, [baseDataUrl]);

  const fitZoom = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return 1;
    const availW = vp.clientWidth - 32, availH = vp.clientHeight - 32;
    return Math.max(0.05, Math.min(availW / natural.w, availH / natural.h));
  }, [natural]);

  useEffect(() => {
    if (!fitMode) return;
    const apply = () => setZoom(fitZoom());
    apply();
    const vp = viewportRef.current;
    if (!vp || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(apply);
    ro.observe(vp);
    return () => ro.disconnect();
  }, [fitMode, fitZoom, loaded]);

  useEffect(() => {
    if (loaded) redraw(annotations, undefined, true, cropRect);
  }, [loaded, annotations, selectedIndex, redraw, cropRect]);

  const setZoomAround = useCallback((nextZoom: number, clientX?: number, clientY?: number) => {
    const vp = viewportRef.current;
    const z = Math.min(8, Math.max(0.05, nextZoom));
    setFitMode(false);
    if (vp && clientX !== undefined && clientY !== undefined) {
      const rect = vp.getBoundingClientRect();
      const mx = clientX - rect.left + vp.scrollLeft;
      const my = clientY - rect.top + vp.scrollTop;
      const ratio = z / zoom;
      requestAnimationFrame(() => {
        vp.scrollLeft = mx * ratio - (clientX - rect.left);
        vp.scrollTop = my * ratio - (clientY - rect.top);
      });
    }
    setZoom(z);
  }, [zoom]);
  const zoomIn = () => setZoomAround(ZOOM_STEPS.find((s) => s > zoom + 0.001) ?? zoom * 1.25);
  const zoomOut = () => setZoomAround([...ZOOM_STEPS].reverse().find((s) => s < zoom - 0.001) ?? zoom / 1.25);

  // Ctrl＋ホイールで拡大縮小（passive:false が必要なので addEventListener で登録）
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setZoomAround(zoom * factor, e.clientX, e.clientY);
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, [zoom, setZoomAround]);

  /* ---- 編集操作 ---- */
  const deleteSelected = useCallback(() => {
    if (selectedIndex === null) return;
    commit(annotations.filter((_, index) => index !== selectedIndex));
    setSelectedIndex(null);
  }, [annotations, commit, selectedIndex]);

  const applyCrop = useCallback(() => {
    const img = imgRef.current;
    if (!img || !cropRect || cropRect.width < 0.02 || cropRect.height < 0.02) return;
    const sx = Math.round(cropRect.x * img.naturalWidth), sy = Math.round(cropRect.y * img.naturalHeight);
    const sw = Math.round(cropRect.width * img.naturalWidth), sh = Math.round(cropRect.height * img.naturalHeight);
    const off = document.createElement('canvas');
    off.width = sw; off.height = sh;
    const octx = off.getContext('2d');
    if (!octx) return;
    octx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    const nextBase = off.toDataURL('image/jpeg', 0.92);
    const cx = cropRect.x, cy = cropRect.y, cw = cropRect.width, ch = cropRect.height;
    const mapX = (x: number) => (x - cx) / cw;
    const mapY = (y: number) => (y - cy) / ch;
    const moved = annotations.map((a): Annotation => {
      if (a.type === 'circle') return { ...a, cx: mapX(a.cx), cy: mapY(a.cy), radiusX: a.radiusX / cw, radiusY: a.radiusY / ch };
      if (isRectAnn(a)) return { ...a, x: mapX(a.x), y: mapY(a.y), width: a.width / cw, height: a.height / ch };
      if (isLineAnn(a)) return { ...a, x1: mapX(a.x1), y1: mapY(a.y1), x2: mapX(a.x2), y2: mapY(a.y2) };
      return { ...a, x: mapX(a.x), y: mapY(a.y) };
    });
    baseChangedRef.current = true;
    setLoaded(false);
    setBaseDataUrl(nextBase);
    setCropRect(null);
    setFitMode(true);
    setTool('select');
    commit(moved);
  }, [annotations, commit, cropRect]);

  // キーボード: Ctrl+Z / Ctrl+Y / Delete / Esc / 数字でツール / スペースで移動
  useEffect(() => {
    const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (mod && (e.key === '+' || e.key === '=' || e.key === ';')) { e.preventDefault(); zoomIn(); return; }
      if (mod && e.key === '-') { e.preventDefault(); zoomOut(); return; }
      if (mod && e.key === '0') { e.preventDefault(); setFitMode(true); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); return; }
      if (e.key === 'Escape') { if (cropRect) setCropRect(null); else setSelectedIndex(null); return; }
      if (e.key === ' ') { e.preventDefault(); setSpaceHeld(true); return; }
      if (e.key === 'Enter' && cropRect) { e.preventDefault(); applyCrop(); return; }
      const t = TOOL_KEYS[e.key];
      if (t && !mod) { setTool(t); setSelectedIndex(null); }
    };
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === ' ') setSpaceHeld(false); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undo, redo, deleteSelected, cropRect, applyCrop, zoom]);

  const buildDragAnnotation = (start: { x: number; y: number }, pt: { x: number; y: number }): Annotation | { type: 'crop'; rect: Rect } | null => {
    const r = normRect(start, pt);
    switch (tool) {
      case 'arrow': return { type: 'arrow', x1: start.x, y1: start.y, x2: pt.x, y2: pt.y, scale: size / 100, color };
      case 'line': return { type: 'line', x1: start.x, y1: start.y, x2: pt.x, y2: pt.y, scale: size / 100, color };
      case 'circle': return { type: 'circle', cx: start.x, cy: start.y, radiusX: Math.abs(pt.x - start.x), radiusY: Math.abs(pt.y - start.y), color };
      case 'rectangle': return { type: 'rectangle', ...r, color };
      case 'highlight': return { type: 'highlight', ...r, color: color === '#111827' ? '#F59E0B' : color };
      case 'mosaic': return { type: 'mosaic', ...r };
      case 'fill': return { type: 'fill', ...r, color: color === '#F59E0B' ? '#111827' : color };
      case 'crop': return { type: 'crop', rect: r };
      default: return null;
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // スペース＋ドラッグ、中ボタンで画面を移動
    if (spaceHeld || e.button === 1) {
      const vp = viewportRef.current;
      if (vp) { panRef.current = { x: e.clientX, y: e.clientY, left: vp.scrollLeft, top: vp.scrollTop }; (e.target as HTMLElement).setPointerCapture(e.pointerId); }
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    const pt = toCanvasCoords(e);
    if (!pt) return;
    const canvas = canvasRef.current;

    if (tool === 'select' && canvas) {
      const index = [...annotations].reverse().findIndex((annotation) => {
        const b = getAnnotationBounds(annotation, canvas.width, canvas.height);
        const pad = 12, px = pt.x * canvas.width, py = pt.y * canvas.height;
        return px >= b.x - pad && px <= b.x + b.width + pad && py >= b.y - pad && py <= b.y + b.height + pad;
      });
      const actualIndex = index === -1 ? null : annotations.length - 1 - index;
      setSelectedIndex(actualIndex);
      if (actualIndex !== null) { setDrawing(true); setDragStart(pt); (e.target as HTMLElement).setPointerCapture(e.pointerId); }
      return;
    }
    if (DRAG_TOOLS.includes(tool)) {
      setSelectedIndex(null);
      if (tool === 'crop') setCropRect(null);
      setDrawing(true);
      setDragStart(pt);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (panRef.current) {
      const vp = viewportRef.current;
      if (vp) { vp.scrollLeft = panRef.current.left - (e.clientX - panRef.current.x); vp.scrollTop = panRef.current.top - (e.clientY - panRef.current.y); }
      return;
    }
    if (!drawing || !dragStart) return;
    const pt = toCanvasCoords(e);
    if (!pt) return;
    if (tool === 'select' && selectedIndex !== null) {
      const dx = pt.x - dragStart.x, dy = pt.y - dragStart.y;
      setAnnotations((prev) => prev.map((a, i) => (i === selectedIndex ? translateAnnotation(a, dx, dy) : a)));
      setDragStart(pt);
      return;
    }
    const preview = buildDragAnnotation(dragStart, pt);
    if (preview) redraw(annotations, preview, false);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (panRef.current) { panRef.current = null; return; }
    const pt = toCanvasCoords(e);
    if (!pt) return;
    if (tool === 'select') {
      if (drawing && selectedIndex !== null) commit(annotations); // 移動の確定
      setDrawing(false);
      setDragStart(null);
      return;
    }
    if (DRAG_TOOLS.includes(tool) && drawing && dragStart) {
      const dist = Math.hypot(pt.x - dragStart.x, pt.y - dragStart.y);
      const s = size / 100;
      let created = buildDragAnnotation(dragStart, pt);
      // ほとんど動かさずに押した場合は、押した場所に標準サイズで置く
      if (dist < 0.01) {
        if (tool === 'circle') created = { type: 'circle', cx: pt.x, cy: pt.y, radiusX: 0.05 * s, radiusY: 0.05 * s, color };
        else if (tool === 'rectangle' || tool === 'highlight' || tool === 'mosaic' || tool === 'fill') {
          const r = { x: pt.x - 0.06 * s, y: pt.y - 0.04 * s, width: 0.12 * s, height: 0.08 * s };
          created = tool === 'mosaic' ? { type: 'mosaic', ...r } : tool === 'fill' ? { type: 'fill', ...r, color } : tool === 'highlight' ? { type: 'highlight', ...r, color } : { type: 'rectangle', ...r, color };
        } else created = null;
      }
      setDrawing(false);
      setDragStart(null);
      if (!created) { redraw(annotations, undefined, true, cropRect); return; }
      if (created.type === 'crop') { setCropRect(created.rect.width > 0.02 && created.rect.height > 0.02 ? created.rect : null); return; }
      commit([...annotations, created]);
      return;
    }
    if (tool === 'number') {
      setSelectedIndex(null);
      const value = numberMode === 'auto' ? nextNumber : manualNumber;
      commit([...annotations, { type: 'number', x: pt.x, y: pt.y, value, scale: size / 100, color, mode: numberMode }]);
      if (numberMode === 'manual') setManualNumber(value + 1);
    } else if (tool === 'text' && textValue.trim()) {
      setSelectedIndex(null);
      commit([...annotations, { type: 'text', x: pt.x, y: pt.y, value: textValue.trim(), scale: size / 100, color, background: textBackground }]);
    }
  };

  const handleClearAll = () => {
    if (annotations.length === 0) return;
    if (!confirm('注釈をすべて消しますか？（元に戻すで戻せます）')) return;
    commit([]);
    setSelectedIndex(null);
  };

  const handleSave = () => {
    if (annotations.length === 0 && !baseChangedRef.current && (!initialAnnotations || initialAnnotations.length === 0)) {
      onClose();
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    redraw(annotations, undefined, false, null);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    onSave(dataUrl, annotations, baseChangedRef.current ? baseDataUrl : undefined);
  };

  const cursor = spaceHeld || panRef.current ? 'grab' : tool === 'select' ? 'default' : 'crosshair';
  const toolBtn = (active: boolean) => `rounded-lg px-3 py-2 text-sm font-medium transition ${active ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800'}`;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* 上のバー */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-gray-900 px-4 py-2.5">
        <div className="flex items-center gap-1">
          <button onClick={handleClearAll} disabled={annotations.length === 0} className="rounded-lg px-3 py-1.5 text-sm text-gray-300 transition hover:bg-gray-800 hover:text-white disabled:opacity-30">注釈をすべて消す</button>
          {originalImageDataUrl && (
            <button
              onClick={() => { if (confirm('注釈をすべて削除して、注釈を付ける前の画像に戻しますか？')) onRestore(); }}
              className="rounded-lg px-3 py-1.5 text-sm text-amber-400 transition hover:bg-gray-800 hover:text-amber-300"
            >
              注釈前の画像に戻す
            </button>
          )}
        </div>
        <div className="flex items-center gap-1 text-sm text-gray-300">
          <span className="mr-2 text-gray-500">画像注釈</span>
          <button onClick={zoomOut} className="h-8 w-8 rounded-md border border-gray-700 hover:bg-gray-800" title="縮小（Ctrl＋−）">−</button>
          <span className="w-14 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
          <button onClick={zoomIn} className="h-8 w-8 rounded-md border border-gray-700 hover:bg-gray-800" title="拡大（Ctrl＋＋）">＋</button>
          <button onClick={() => setFitMode(true)} className={`ml-1 rounded-md border px-2.5 py-1 text-xs ${fitMode ? 'border-blue-500 text-blue-300' : 'border-gray-700 hover:bg-gray-800'}`} title="Ctrl＋0">画面に合わせる</button>
          <button onClick={() => setZoomAround(1)} className="rounded-md border border-gray-700 px-2.5 py-1 text-xs hover:bg-gray-800">100%</button>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="rounded-lg border border-gray-600 px-4 py-1.5 text-sm font-medium text-gray-200 transition hover:bg-gray-800 hover:text-white">編集せず戻る</button>
          <button onClick={handleSave} className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-bold text-white transition hover:bg-blue-700">保存して戻る</button>
        </div>
      </div>

      {/* 切り抜きの確認 */}
      {cropRect && (
        <div className="flex items-center justify-center gap-3 bg-amber-500/15 px-4 py-2 text-sm text-amber-200">
          <span>点線の範囲で切り抜きます（範囲の外は捨てられます）。</span>
          <button onClick={applyCrop} className="rounded-md bg-amber-500 px-3 py-1 text-xs font-bold text-black hover:bg-amber-400">この範囲で切り抜く（Enter）</button>
          <button onClick={() => setCropRect(null)} className="rounded-md border border-amber-500/50 px-3 py-1 text-xs hover:bg-amber-500/20">やめる（Esc）</button>
        </div>
      )}

      {/* 画像（拡大・移動できる） */}
      <div ref={viewportRef} className="relative flex-1 overflow-auto bg-gray-950">
        <div className="flex min-h-full min-w-full items-center justify-center p-4">
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={() => { panRef.current = null; setDrawing(false); setDragStart(null); }}
            onContextMenu={(e) => e.preventDefault()}
            className="block shadow-[0_0_0_1px_rgba(255,255,255,0.08)]"
            style={{ width: natural.w * zoom, height: natural.h * zoom, touchAction: 'none', userSelect: 'none', cursor }}
          />
        </div>
      </div>

      {/* 下のツールバー */}
      <div className="bg-gray-900 px-4 py-2.5">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button onClick={undo} disabled={!canUndo} className="rounded-lg px-3 py-2 text-sm text-gray-300 transition hover:bg-gray-800 hover:text-white disabled:opacity-30" title="元に戻す（Ctrl+Z）">↶ 元に戻す</button>
          <button onClick={redo} disabled={!canRedo} className="rounded-lg px-3 py-2 text-sm text-gray-300 transition hover:bg-gray-800 hover:text-white disabled:opacity-30" title="やり直し（Ctrl+Y）">↷ やり直し</button>
          <button onClick={deleteSelected} disabled={selectedIndex === null} className="rounded-lg px-3 py-2 text-sm text-red-300 transition hover:bg-gray-800 hover:text-red-100 disabled:opacity-30" title="選択中を削除（Delete）">削除</button>
          <div className="mx-1 h-6 w-px bg-gray-700" />
          {TOOLS.map((t) => (
            <button key={t.id} onClick={() => { setTool(t.id); setSelectedIndex(null); if (t.id !== 'crop') setCropRect(null); }} className={toolBtn(tool === t.id)} title={t.hint ? `キー ${t.hint}` : undefined}>
              {t.label}
            </button>
          ))}
          <div className="mx-1 h-6 w-px bg-gray-700" />
          <div className="flex items-center gap-2" aria-label="注釈の色">
            {ANNOTATION_COLORS.map((option) => (
              <button key={option} type="button" onClick={() => setColor(option)} aria-label={`色 ${option}`} className={`h-7 w-7 rounded-full border-2 transition ${color === option ? 'border-white ring-2 ring-blue-500' : 'border-gray-600 hover:border-gray-300'}`} style={{ backgroundColor: option }} />
            ))}
            <input type="color" value={color} onChange={(event) => setColor(event.target.value)} aria-label="自由に色を選択" className="h-8 w-8 cursor-pointer rounded border border-gray-600 bg-transparent p-0.5" />
          </div>
          <div className="mx-1 h-6 w-px bg-gray-700" />
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <span>サイズ</span>
            <input type="range" min={50} max={200} step={10} value={size} onChange={(event) => setSize(Number(event.target.value))} className="w-24 accent-blue-500" />
            <span className="w-10 text-right tabular-nums">{size}%</span>
          </label>
        </div>

        {/* ツールごとの設定とヒント */}
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3 text-xs text-gray-400">
          {tool === 'text' && (
            <>
              <input type="text" value={textValue} onChange={(event) => setTextValue(event.target.value)} placeholder="配置する文字を入力してから画像を押す" className="h-9 w-64 rounded-lg border border-gray-700 bg-gray-800 px-3 text-sm text-white outline-none placeholder:text-gray-500 focus:border-blue-500" />
              <label className="flex items-center gap-1.5 text-gray-300"><input type="checkbox" checked={textBackground} onChange={(e) => setTextBackground(e.target.checked)} className="accent-blue-500" />白い下地を付ける</label>
            </>
          )}
          {tool === 'number' && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5">
              <div className="flex overflow-hidden rounded-md border border-gray-700">
                {([['auto', '連番'], ['manual', '番号指定']] as const).map(([mode, label]) => (
                  <button key={mode} type="button" onClick={() => setNumberMode(mode)} className={`px-3 py-1.5 text-xs font-semibold transition ${numberMode === mode ? 'bg-blue-600 text-white' : 'bg-gray-900 text-gray-300 hover:bg-gray-700'}`}>{label}</button>
                ))}
              </div>
              {numberMode === 'auto' ? (
                <span className="px-2 text-gray-300">次: {nextNumber}</span>
              ) : (
                <label className="flex items-center gap-1.5 text-gray-300">
                  <span>番号</span>
                  <input type="number" min={1} max={999} value={manualNumber} onChange={(event) => { const v = Number(event.target.value); setManualNumber(Number.isFinite(v) && v > 0 ? v : 1); }} className="h-8 w-20 rounded-md border border-gray-700 bg-gray-900 px-2 text-sm text-white outline-none focus:border-blue-500" />
                </label>
              )}
            </div>
          )}
          {tool === 'mosaic' && <span>ドラッグした範囲をモザイクにします。名前や社員番号など、見せたくない部分に。</span>}
          {tool === 'fill' && <span>ドラッグした範囲を選んだ色で塗りつぶします。</span>}
          {tool === 'highlight' && <span>ドラッグした範囲を半透明の色で強調します。</span>}
          {tool === 'crop' && <span>残したい範囲をドラッグし、「この範囲で切り抜く」を押します。注釈は一緒に移動します。</span>}
          {tool === 'select' && <span>注釈を押して選び、ドラッグで移動。Delete で削除。</span>}
          <span className="text-gray-500">Ctrl+Z 元に戻す ／ Ctrl+Y やり直し ／ Ctrl＋ホイール 拡大縮小 ／ スペース＋ドラッグで移動 ／ 数字キーでツール切替</span>
        </div>
      </div>
    </div>
  );
}
