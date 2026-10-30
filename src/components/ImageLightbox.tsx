'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface LightboxImage {
  src: string;
  alt: string;
  caption?: string;
}

interface Props {
  images: LightboxImage[];
  index: number;
  /** 見出し（例: 「ステップ3」） */
  title?: string;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

interface View {
  scale: number;
  x: number;
  y: number;
}

const ZOOM_STEP = 1.25;

/**
 * 画像を画面いっぱいに表示し、拡大・移動できるビューア。
 * ホイール・ピンチ・＋/－ボタンで拡大縮小、ドラッグで移動、ダブルクリックで拡大／全体表示を切り替える。
 */
export default function ImageLightbox({ images, index, title, onIndexChange, onClose }: Props) {
  const image = images[index];
  const stageRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [stage, setStage] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ startDist: number; startScale: number; lastX: number; lastY: number; moved: boolean } | null>(null);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const fitScale = natural && stage.w && stage.h ? Math.min(stage.w / natural.w, stage.h / natural.h, 3) : 1;
  const minScale = fitScale;
  const maxScale = Math.max(4, fitScale * 4);

  const centered = useCallback(
    (scale: number): View => {
      if (!natural) return { scale, x: 0, y: 0 };
      return { scale, x: (stage.w - natural.w * scale) / 2, y: (stage.h - natural.h * scale) / 2 };
    },
    [natural, stage.w, stage.h],
  );

  /** 画像が画面より小さい方向は中央に、大きい方向ははみ出しすぎないように位置を整える */
  const clamp = useCallback(
    (v: View): View => {
      if (!natural) return v;
      const scale = Math.min(Math.max(v.scale, minScale), maxScale);
      const w = natural.w * scale;
      const h = natural.h * scale;
      const x = w <= stage.w ? (stage.w - w) / 2 : Math.min(0, Math.max(stage.w - w, v.x));
      const y = h <= stage.h ? (stage.h - h) / 2 : Math.min(0, Math.max(stage.h - h, v.y));
      return { scale, x, y };
    },
    [natural, stage.w, stage.h, minScale, maxScale],
  );

  /** 画面上の点 (px, py) を動かさずに倍率を変える */
  const zoomAt = useCallback(
    (nextScale: number, px: number, py: number) => {
      const cur = viewRef.current;
      const scale = Math.min(Math.max(nextScale, minScale), maxScale);
      const k = scale / cur.scale;
      setView(clamp({ scale, x: px - (px - cur.x) * k, y: py - (py - cur.y) * k }));
    },
    [clamp, minScale, maxScale],
  );

  // 表示領域の大きさを追う
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => setStage({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 画像が変わったら読み込み直して全体表示に戻す
  useEffect(() => {
    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (alive) setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.src = image.src;
    return () => {
      alive = false;
    };
  }, [image.src]);

  useEffect(() => {
    if (natural) setView(centered(fitScale));
    // 画像の切り替え・画面の大きさが変わったときだけ全体表示に戻す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [natural, stage.w, stage.h]);

  // 背面のスクロールを止める
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const go = useCallback(
    (delta: number) => {
      const next = index + delta;
      if (next < 0 || next >= images.length) return;
      setNatural(null);
      onIndexChange(next);
    },
    [index, images.length, onIndexChange],
  );

  const zoomCenter = useCallback(
    (factor: number) => zoomAt(viewRef.current.scale * factor, stage.w / 2, stage.h / 2),
    [zoomAt, stage.w, stage.h],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === '+' || e.key === '=' || e.key === ';') zoomCenter(ZOOM_STEP);
      else if (e.key === '-') zoomCenter(1 / ZOOM_STEP);
      else if (e.key === '0') setView(centered(fitScale));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, go, zoomCenter, centered, fitScale]);

  // ホイールで拡大縮小（passive: false で画面のスクロールを止める）
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
      zoomAt(viewRef.current.scale * factor, e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const local = (e: React.PointerEvent) => {
    const rect = stageRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    stageRef.current?.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    const pts = [...pointers.current.values()];
    if (pts.length === 1) {
      gesture.current = { startDist: 0, startScale: viewRef.current.scale, lastX: pts[0].x, lastY: pts[0].y, moved: false };
    } else if (pts.length === 2) {
      const [a, b] = pts;
      gesture.current = {
        startDist: Math.hypot(a.x - b.x, a.y - b.y),
        startScale: viewRef.current.scale,
        lastX: (a.x + b.x) / 2,
        lastY: (a.y + b.y) / 2,
        moved: true,
      };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, local(e));
    const pts = [...pointers.current.values()];
    const g = gesture.current;
    if (pts.length >= 2) {
      const [a, b] = pts;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const cur = viewRef.current;
      // 2 本指の移動分だけずらしてから、中点を基準に拡大縮小する
      const moved = { ...cur, x: cur.x + (mx - g.lastX), y: cur.y + (my - g.lastY) };
      const scale = Math.min(Math.max(g.startScale * (dist / (g.startDist || dist)), minScale), maxScale);
      const k = scale / moved.scale;
      setView(clamp({ scale, x: mx - (mx - moved.x) * k, y: my - (my - moved.y) * k }));
      g.lastX = mx;
      g.lastY = my;
    } else {
      const p = pts[0];
      const dx = p.x - g.lastX;
      const dy = p.y - g.lastY;
      if (Math.abs(dx) + Math.abs(dy) > 2) g.moved = true;
      const cur = viewRef.current;
      setView(clamp({ ...cur, x: cur.x + dx, y: cur.y + dy }));
      g.lastX = p.x;
      g.lastY = p.y;
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const wasDrag = gesture.current?.moved ?? false;
    const onImage = (e.target as HTMLElement).tagName === 'IMG';
    pointers.current.delete(e.pointerId);
    const pts = [...pointers.current.values()];
    if (pts.length === 1 && gesture.current) {
      // ピンチの片方の指を離したら、残った指でのドラッグに切り替える
      gesture.current = { ...gesture.current, lastX: pts[0].x, lastY: pts[0].y, startScale: viewRef.current.scale };
    } else if (pts.length === 0) {
      gesture.current = null;
      // 画像の外を（ドラッグせずに）押したら閉じる
      if (!wasDrag && !onImage && e.pointerType === 'mouse') onClose();
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const rect = stageRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    if (viewRef.current.scale > fitScale * 1.05) setView(centered(fitScale));
    else zoomAt(Math.max(fitScale * 2.5, 1), px, py);
  };

  const percent = natural ? Math.round(view.scale * 100) : 0;
  const btn = 'flex h-10 min-w-10 items-center justify-center rounded-lg bg-white/10 px-3 text-sm font-semibold text-white transition hover:bg-white/20 disabled:opacity-30';

  return (
    <div className="fixed inset-0 z-[70] flex flex-col no-print" style={{ backgroundColor: 'rgb(10 10 12 / 0.97)' }} role="dialog" aria-modal="true" aria-label="画像の拡大表示">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-white" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <div className="min-w-0 text-sm">
          <span className="font-semibold">{title}</span>
          {images.length > 1 && <span className="ml-2 text-white/60">画像 {index + 1} / {images.length}</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" className={btn} onClick={() => zoomCenter(1 / ZOOM_STEP)} disabled={view.scale <= minScale + 1e-6} aria-label="縮小">－</button>
          <span className="w-14 text-center text-xs tabular-nums text-white/80">{percent}%</span>
          <button type="button" className={btn} onClick={() => zoomCenter(ZOOM_STEP)} disabled={view.scale >= maxScale - 1e-6} aria-label="拡大">＋</button>
          <button type="button" className={btn} onClick={() => setView(centered(fitScale))}>全体</button>
          <button type="button" className={`${btn} hidden sm:flex`} onClick={() => zoomAt(1, stage.w / 2, stage.h / 2)}>等倍</button>
          <button type="button" className={`${btn} ml-2 bg-white/20`} onClick={onClose} aria-label="閉じる">✕ 閉じる</button>
        </div>
      </div>

      <div
        ref={stageRef}
        className="relative min-h-0 flex-1 cursor-grab touch-none select-none overflow-hidden active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        {natural && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image.src}
            alt={image.alt}
            draggable={false}
            className="absolute left-0 top-0 max-w-none origin-top-left"
            style={{ width: natural.w, height: natural.h, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
          />
        )}
        {images.length > 1 && (
          <>
            <button type="button" className={`${btn} absolute left-3 top-1/2 h-14 -translate-y-1/2 bg-black/50 text-xl`} onClick={() => go(-1)} disabled={index === 0} aria-label="前の画像">‹</button>
            <button type="button" className={`${btn} absolute right-3 top-1/2 h-14 -translate-y-1/2 bg-black/50 text-xl`} onClick={() => go(1)} disabled={index === images.length - 1} aria-label="次の画像">›</button>
          </>
        )}
      </div>

      <div className="px-4 py-3 text-center text-white" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        {image.caption && <p className="mb-1 text-sm">{image.caption}</p>}
        <p className="hidden text-xs text-white/50 sm:block">ホイールで拡大縮小／ドラッグで移動／ダブルクリックで拡大・全体表示／← → で前後の画像／Esc で閉じる</p>
        <p className="text-xs text-white/50 sm:hidden">2本指で拡大縮小／ドラッグで移動</p>
      </div>
    </div>
  );
}
