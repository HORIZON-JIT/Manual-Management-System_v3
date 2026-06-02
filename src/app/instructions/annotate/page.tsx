'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import ImageAnnotationEditor from '@/components/ImageAnnotationEditor';
import EditorOnlyNotice from '@/components/EditorOnlyNotice';
import { getTempData, setTempData } from '@/lib/tempStorage';
import { VIEWER_ONLY } from '@/lib/appMode';
import type { ImageAnnotation } from '@/types/instruction';

const CHANNEL = 'mms-annotate';

type Src = { imageDataUrl: string; originalImageDataUrl?: string; initialAnnotations?: ImageAnnotation[] };

function AnnotatePageContent() {
  const params = useSearchParams();
  const token = params.get('key');
  const [src, setSrc] = useState<Src | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading');
  const resultWritten = useRef(false);

  useEffect(() => {
    if (!token) {
      setStatus('missing');
      return;
    }
    getTempData('annotate_src_' + token)
      .then((raw) => {
        if (!raw) {
          setStatus('missing');
          return;
        }
        try {
          setSrc(JSON.parse(raw) as Src);
          setStatus('ready');
        } catch {
          setStatus('missing');
        }
      })
      .catch(() => setStatus('missing'));
  }, [token]);

  // OS でウィンドウを閉じられた場合に、開いた側が待ち続けないようキャンセルを通知
  useEffect(() => {
    if (!token) return;
    const onBeforeUnload = () => {
      if (resultWritten.current) return;
      try {
        const ch = new BroadcastChannel(CHANNEL);
        ch.postMessage({ token, fallbackCancel: true });
        ch.close();
      } catch {
        // ignore
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [token]);

  const finishAnnotation = async (
    action: 'save' | 'restore' | 'cancel',
    url?: string,
    annotations?: ImageAnnotation[],
  ) => {
    if (!token) {
      window.close();
      return;
    }
    try {
      await setTempData(
        'annotate_res_' + token,
        JSON.stringify(url ? { action, url, annotations } : { action }),
      );
      resultWritten.current = true;
    } catch {
      // 結果保存に失敗してもキャンセル扱いで通知する
    }
    try {
      const ch = new BroadcastChannel(CHANNEL);
      ch.postMessage({ token });
      ch.close();
    } catch {
      // ignore
    }
    window.close();
  };

  if (status === 'loading') {
    return <div className="flex min-h-screen items-center justify-center bg-black text-sm text-gray-400">読み込み中...</div>;
  }

  if (status === 'missing' || !src) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-black px-6 text-center">
        <p className="text-sm text-gray-300">編集対象の画像が見つかりませんでした。</p>
        <button
          type="button"
          onClick={() => window.close()}
          className="rounded-lg bg-gray-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-600"
        >
          このウィンドウを閉じる
        </button>
      </div>
    );
  }

  return (
    <ImageAnnotationEditor
      imageDataUrl={src.imageDataUrl}
      originalImageDataUrl={src.originalImageDataUrl}
      initialAnnotations={src.initialAnnotations}
      onSave={(url, annotations) => finishAnnotation('save', url, annotations)}
      onRestore={() => finishAnnotation('restore')}
      onClose={() => finishAnnotation('cancel')}
    />
  );
}

export default function AnnotatePage() {
  if (VIEWER_ONLY) return <EditorOnlyNotice />;
  return (
    <Suspense fallback={null}>
      <AnnotatePageContent />
    </Suspense>
  );
}
