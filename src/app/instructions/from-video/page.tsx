'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { v4 as uuidv4 } from 'uuid';
import EditorOnlyNotice from '@/components/EditorOnlyNotice';
import { VIEWER_ONLY } from '@/lib/appMode';
import { setTempData } from '@/lib/tempStorage';
import { TEMPLATE_TEMP_KEY } from '@/lib/templateCopy';
import { WorkInstruction, Step } from '@/types/instruction';
import { AiSettings, DEFAULT_GEMINI_MODEL, loadAiSettings, maskApiKey, saveAiSettings } from '@/lib/aiSettings';
import { analyzeVideo, AnalyzeStage, parseStepsJson, normalizeSteps, VideoStep, INLINE_LIMIT_BYTES } from '@/lib/geminiVideo';
import { captureFrameAt, formatTime, loadVideo, ScreenRecorder, startScreenRecording, VideoInfo } from '@/lib/videoFrames';

const MAX_DURATION_WARN_SEC = 15 * 60;
const MAX_SIZE_WARN_BYTES = 200 * 1024 * 1024;

interface FrameStep extends VideoStep {
  id: string;
  image?: string;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'recording'; startedAt: number }
  | { kind: 'loading' }
  | { kind: 'analyzing'; stage: AnalyzeStage; detail?: string }
  | { kind: 'capturing'; done: number; total: number }
  | { kind: 'error'; message: string };

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

const STAGE_LABEL: Record<AnalyzeStage, string> = {
  upload: '動画を送信中',
  processing: 'Gemini 側で動画を処理中',
  analyze: '手順を解析中',
  done: '完了',
};

export default function FromVideoPage() {
  if (VIEWER_ONLY) return <EditorOnlyNotice />;
  return <FromVideoContent />;
}

function FromVideoContent() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [elapsed, setElapsed] = useState(0);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [videoName, setVideoName] = useState('');
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [settings, setSettings] = useState<AiSettings>({ apiKey: '', model: DEFAULT_GEMINI_MODEL, glossary: '' });
  const [keyInput, setKeyInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showJsonPaste, setShowJsonPaste] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [steps, setSteps] = useState<FrameStep[]>([]);
  const [previewTime, setPreviewTime] = useState(0);
  const [building, setBuilding] = useState(false);
  const [showFullImage, setShowFullImage] = useState<string | null>(null);

  const captureVideoRef = useRef<HTMLVideoElement | null>(null);
  const revokeRef = useRef<() => void>(() => {});
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const recorderRef = useRef<ScreenRecorder | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const s = loadAiSettings();
    queueMicrotask(() => {
      setSettings(s);
      setShowSettings(!s.apiKey);
    });
  }, []);

  // 録画中の経過時間
  useEffect(() => {
    if (phase.kind !== 'recording') return;
    const startedAt = phase.startedAt;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(t);
  }, [phase]);

  // 後片付け
  useEffect(() => {
    return () => {
      revokeRef.current();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetVideo = useCallback(() => {
    revokeRef.current();
    revokeRef.current = () => {};
    captureVideoRef.current = null;
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    setVideoBlob(null);
    setVideoInfo(null);
    setVideoName('');
    setSteps([]);
    setPreviewTime(0);
  }, []);

  const acceptVideo = useCallback(async (blob: Blob, name: string) => {
    resetVideo();
    setPhase({ kind: 'loading' });
    try {
      const { video, info, revoke } = await loadVideo(blob);
      captureVideoRef.current = video;
      revokeRef.current = revoke;
      setVideoBlob(blob);
      setVideoName(name);
      setVideoInfo(info);
      setPreviewUrl(URL.createObjectURL(blob));
      setPhase({ kind: 'idle' });
    } catch (err) {
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : '動画を読み込めませんでした。' });
    }
  }, [resetVideo]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    void acceptVideo(file, file.name);
  };

  const handleStartRecording = async () => {
    try {
      const rec = await startScreenRecording();
      recorderRef.current = rec;
      setElapsed(0);
      setPhase({ kind: 'recording', startedAt: Date.now() });
      rec.onEnded(() => {
        void handleStopRecording();
      });
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name === 'NotAllowedError' || name === 'AbortError') return; // ユーザーがキャンセル
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : '録画を開始できませんでした。' });
    }
  };

  const handleStopRecording = async () => {
    const rec = recorderRef.current;
    if (!rec) return;
    recorderRef.current = null;
    const blob = await rec.stop();
    const stamp = new Date();
    const name = `録画_${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, '0')}${String(stamp.getDate()).padStart(2, '0')}_${String(stamp.getHours()).padStart(2, '0')}${String(stamp.getMinutes()).padStart(2, '0')}.webm`;
    await acceptVideo(blob, name);
  };

  const persistSettings = (next: AiSettings) => {
    setSettings(next);
    saveAiSettings(next);
  };

  const handleSaveKey = () => {
    const key = keyInput.trim();
    if (!key) return;
    persistSettings({ ...settings, apiKey: key });
    setKeyInput('');
  };

  const handleClearKey = () => {
    persistSettings({ ...settings, apiKey: '' });
  };

  /** 手順一覧を受け取り、各時刻のフレームを切り出して一覧に入れる */
  const applySteps = useCallback(async (list: VideoStep[]) => {
    const video = captureVideoRef.current;
    if (!video) return;
    const normalized = normalizeSteps(list, videoInfo?.durationSec);
    const withIds: FrameStep[] = normalized.map((s) => ({ ...s, id: uuidv4() }));
    setSteps(withIds);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      for (let i = 0; i < withIds.length; i++) {
        if (controller.signal.aborted) return;
        setPhase({ kind: 'capturing', done: i, total: withIds.length });
        const image = await captureFrameAt(video, withIds[i].time);
        const id = withIds[i].id;
        setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, image } : s)));
      }
      setPhase({ kind: 'idle' });
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') {
        setPhase({ kind: 'idle' });
        return;
      }
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : 'フレームの切り出しに失敗しました。' });
    } finally {
      abortRef.current = null;
    }
  }, [videoInfo?.durationSec]);

  const handleAnalyze = async () => {
    if (!videoBlob) return;
    if (!settings.apiKey) {
      setShowSettings(true);
      setPhase({ kind: 'error', message: 'API キーを設定してください。' });
      return;
    }
    if (steps.length > 0 && !confirm('いまの手順一覧を捨てて、AI の解析結果で置き換えます。よろしいですか？')) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase({ kind: 'analyzing', stage: 'upload' });
    try {
      const result = await analyzeVideo(videoBlob, {
        apiKey: settings.apiKey,
        model: settings.model,
        glossary: settings.glossary,
        durationSec: videoInfo?.durationSec,
        signal: controller.signal,
        onProgress: (stage, detail) => setPhase({ kind: 'analyzing', stage, detail }),
      });
      abortRef.current = null;
      await applySteps(result);
    } catch (err) {
      abortRef.current = null;
      if ((err as { name?: string })?.name === 'AbortError') {
        setPhase({ kind: 'idle' });
        return;
      }
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : '解析に失敗しました。' });
    }
  };

  const handleApplyJson = async () => {
    try {
      const list = parseStepsJson(jsonText);
      if (steps.length > 0 && !confirm('いまの手順一覧を捨てて、貼り付けた JSON で置き換えます。よろしいですか？')) return;
      setShowJsonPaste(false);
      await applySteps(list);
    } catch (err) {
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : 'JSON を読めませんでした。' });
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  const updateStep = (id: string, patch: Partial<FrameStep>) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const moveStep = (index: number, dir: -1 | 1) => {
    setSteps((prev) => {
      const next = [...prev];
      const j = index + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  };

  const removeStep = (id: string) => {
    setSteps((prev) => prev.filter((s) => s.id !== id));
  };

  const recaptureStep = async (id: string, time: number) => {
    const video = captureVideoRef.current;
    if (!video) return;
    const max = videoInfo ? Math.max(videoInfo.durationSec - 0.1, 0) : time;
    const t = Math.min(Math.max(time, 0), max);
    updateStep(id, { time: t, image: undefined });
    try {
      const image = await captureFrameAt(video, t);
      updateStep(id, { image });
    } catch {
      setPhase({ kind: 'error', message: 'フレームの切り出しに失敗しました。' });
    }
  };

  const addStepAtPreview = async () => {
    const video = captureVideoRef.current;
    if (!video) return;
    const time = previewRef.current?.currentTime ?? previewTime;
    const id = uuidv4();
    const insertIndex = steps.findIndex((s) => s.time > time);
    const newStep: FrameStep = { id, time, title: '', text: '' };
    setSteps((prev) => {
      const next = [...prev];
      if (insertIndex < 0) next.push(newStep);
      else next.splice(insertIndex, 0, newStep);
      return next.map((s, i) => (s.id === id ? { ...s, title: `手順 ${i + 1}` } : s));
    });
    try {
      const image = await captureFrameAt(video, time);
      updateStep(id, { image });
    } catch {
      setPhase({ kind: 'error', message: 'フレームの切り出しに失敗しました。' });
    }
  };

  const seekPreview = (time: number) => {
    const p = previewRef.current;
    if (!p) return;
    p.currentTime = time;
    setPreviewTime(time);
  };

  const handleBuild = async () => {
    const ready = steps.filter((s) => s.image);
    if (ready.length === 0) return;
    setBuilding(true);
    try {
      const now = new Date().toISOString();
      const instSteps: Step[] = ready.map((s, i) => ({
        id: uuidv4(),
        orderIndex: i,
        title: s.title.trim() || `手順 ${i + 1}`,
        description: s.text.trim(),
        imageDataUrls: [s.image!],
        imageCaptions: [''],
      }));
      const inst: WorkInstruction = {
        id: uuidv4(),
        title: videoName ? videoName.replace(/\.[^.]+$/, '') : '',
        category: '事務作業',
        description: '',
        steps: instSteps,
        createdAt: now,
        updatedAt: now,
        status: 'draft',
      };
      await setTempData(TEMPLATE_TEMP_KEY, JSON.stringify(inst));
      router.push('/instructions/new?source=template');
    } catch (err) {
      setBuilding(false);
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : '手順書の作成に失敗しました。' });
    }
  };

  const busy = phase.kind === 'loading' || phase.kind === 'analyzing' || phase.kind === 'capturing';
  const readyCount = useMemo(() => steps.filter((s) => s.image).length, [steps]);
  const sizeWarn = videoBlob && videoBlob.size > MAX_SIZE_WARN_BYTES;
  const durationWarn = videoInfo && videoInfo.durationSec > MAX_DURATION_WARN_SEC;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <input ref={fileInputRef} type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.mkv" className="hidden" onChange={handleFile} />

      <div className="mb-6 border-b border-slate-200 pb-5">
        <Link href="/" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-500 transition hover:text-slate-900">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          ホームへ戻る
        </Link>
        <h1 className="text-3xl font-bold tracking-tight text-slate-950">動画から作成</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          パソコン操作の録画を AI（Gemini）に読ませ、手順の区切りと説明文の下書きを作ります。
          結果の各時刻で動画から画像を切り出し、いつもの新規作成画面に渡します。
        </p>
      </div>

      {/* 1. 動画を用意 */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">1</span>
          動画を用意する
        </h2>
        <p className="mt-1 text-xs text-slate-500">操作ごとに 1〜2 秒手を止めると、区切りと画像がきれいに取れます。目安は 15 分以内。</p>

        {phase.kind === 'recording' ? (
          <div className="mt-4 flex flex-wrap items-center gap-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <span className="flex items-center gap-2 text-sm font-semibold text-red-700">
              <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-red-600" />
              録画中 {formatTime(elapsed).replace(/\.\d$/, '')}
            </span>
            <span className="text-xs text-red-700">録画したい画面を操作してください。終わったら「録画を停止」か、ブラウザの「共有を停止」を押します。</span>
            <button type="button" onClick={handleStopRecording} className="ml-auto rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700">
              録画を停止
            </button>
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={handleStartRecording} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
              画面を録画
            </button>
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
              動画ファイルを読み込む（mp4 / webm）
            </button>
            {videoBlob && (
              <button type="button" onClick={resetVideo} disabled={busy} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 disabled:opacity-50">
                動画を外す
              </button>
            )}
          </div>
        )}

        {phase.kind === 'loading' && <p className="mt-3 text-sm text-slate-500">動画を読み込み中...</p>}

        {videoBlob && videoInfo && previewUrl && (
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div>
              <video
                ref={previewRef}
                src={previewUrl}
                controls
                muted
                playsInline
                className="w-full rounded-lg border border-slate-200 bg-black"
                onTimeUpdate={(e) => setPreviewTime((e.target as HTMLVideoElement).currentTime)}
              />
            </div>
            <div className="text-sm text-slate-600">
              <p className="font-semibold text-slate-900">{videoName || '動画'}</p>
              <ul className="mt-2 space-y-1 text-xs text-slate-500">
                <li>長さ: {formatTime(videoInfo.durationSec)}</li>
                <li>解像度: {videoInfo.width} × {videoInfo.height}</li>
                <li>サイズ: {formatBytes(videoBlob.size)}{videoBlob.size > INLINE_LIMIT_BYTES && '（20MB 超のため Files API 経由で送信）'}</li>
              </ul>
              {(sizeWarn || durationWarn) && (
                <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {durationWarn && '15 分を超える動画は解析に時間がかかり、手順が粗くなります。'}
                  {sizeWarn && ' 200MB を超えるとアップロードに失敗することがあります。'}
                  短く分けて録画することをおすすめします。
                </p>
              )}
              {steps.length > 0 && (
                <div className="mt-3">
                  <button type="button" onClick={addStepAtPreview} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 disabled:opacity-50">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                    再生位置（{formatTime(previewTime)}）を手順として追加
                  </button>
                  <p className="mt-1 text-[11px] text-slate-400">AI が拾わなかった画面は、動画をその位置で止めてから追加できます。</p>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* 2. AI で解析 */}
      <section className="mt-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">2</span>
            AI で手順を作る
          </h2>
          <div className="flex items-center gap-2 text-xs">
            <button type="button" onClick={() => setShowSettings((v) => !v)} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-600 transition hover:bg-slate-50">
              AI 設定 {settings.apiKey ? `（キー ${maskApiKey(settings.apiKey)}）` : '（キー未設定）'}
            </button>
            <button type="button" onClick={() => setShowJsonPaste((v) => !v)} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-600 transition hover:bg-slate-50">
              JSON を貼り付ける
            </button>
          </div>
        </div>

        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
          <p className="font-semibold">送信先と送る内容</p>
          <p>「解析する」を押すと、この動画と下の用語集が Google の Gemini API（generativelanguage.googleapis.com）へ送られます。送信前に黒塗りはできません。取引先名・単価・個人情報が映る動画は、社内ルールに従って扱ってください。動画は解析後に Gemini 側から削除します（20MB 超の場合）。手順書の画像は、保存前に注釈画面の「モザイク」「塗りつぶし」で隠せます。</p>
        </div>

        {showSettings && (
          <div className="mt-4 grid gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-slate-700">Gemini API キー</label>
              <p className="mt-0.5 text-[11px] text-slate-500">Google AI Studio で発行した自分のキーを入れてください。この端末のブラウザにだけ保存され、コードや Drive、手順書には入りません。共有パソコンでは使い終わったら削除してください。</p>
              {settings.apiKey ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 font-mono text-emerald-800">{maskApiKey(settings.apiKey)}</span>
                  <span className="text-xs text-emerald-700">保存済み</span>
                  <button type="button" onClick={handleClearKey} className="rounded-md px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50">キーを削除</button>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    type="password"
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    placeholder="AIza..."
                    autoComplete="off"
                    className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm font-mono focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                  <button type="button" onClick={handleSaveKey} disabled={!keyInput.trim()} className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-40">この端末に保存</button>
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700">モデル</label>
              <input
                type="text"
                value={settings.model}
                onChange={(e) => setSettings({ ...settings, model: e.target.value })}
                onBlur={() => persistSettings({ ...settings, model: settings.model.trim() || DEFAULT_GEMINI_MODEL })}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
              <p className="mt-1 text-[11px] text-slate-500">既定は {DEFAULT_GEMINI_MODEL}。精度を上げたいときは pro 系に変えられます（費用が上がります）。</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700">社内用語集（任意）</label>
              <textarea
                value={settings.glossary}
                onChange={(e) => setSettings({ ...settings, glossary: e.target.value })}
                onBlur={() => persistSettings(settings)}
                rows={4}
                placeholder={'例:\n受注一覧 = 業務システムの「受注照会」画面\nPO = 発注書'}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
              <p className="mt-1 text-[11px] text-slate-500">画面名や略語の正しい表記を書いておくと、説明文に反映されます。動画と一緒に送られます。</p>
            </div>
          </div>
        )}

        {showJsonPaste && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold text-slate-700">時刻つき JSON を貼り付ける（API キーなしでも使えます）</p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Gemini のウェブ版などで作った <code className="rounded bg-white px-1">[{'{'}&quot;time&quot;: 12.5, &quot;title&quot;: &quot;…&quot;, &quot;text&quot;: &quot;…&quot;{'}'}, …]</code> の形の JSON を貼ると、各時刻の画像を切り出します。time は秒または「1:23」の形。
            </p>
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              rows={6}
              className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={handleApplyJson} disabled={!videoBlob || !jsonText.trim() || busy} className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-40">この JSON で画像を切り出す</button>
              {!videoBlob && <span className="self-center text-xs text-slate-500">先に動画を用意してください。</span>}
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {phase.kind === 'analyzing' || phase.kind === 'capturing' ? (
            <>
              <span className="inline-flex items-center gap-2 text-sm text-slate-700">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" />
                {phase.kind === 'analyzing'
                  ? `${STAGE_LABEL[phase.stage]}${phase.detail ? `（${phase.detail}）` : ''}...`
                  : `画像を切り出し中 ${phase.done} / ${phase.total}`}
              </span>
              <button type="button" onClick={handleCancel} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50">中断</button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={!videoBlob || busy}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-40"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" /></svg>
              Gemini に送って解析する
            </button>
          )}
          {!videoBlob && phase.kind === 'idle' && <span className="text-xs text-slate-500">先に動画を用意してください。</span>}
        </div>

        {phase.kind === 'error' && (
          <div className="mt-3 flex items-start justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <span>{phase.message}</span>
            <button type="button" onClick={() => setPhase({ kind: 'idle' })} className="shrink-0 text-xs font-medium text-red-600 underline">閉じる</button>
          </div>
        )}
      </section>

      {/* 3. 手順を整える */}
      {steps.length > 0 && (
        <section className="mt-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">3</span>
              手順を整える
              <span className="ml-1 text-xs font-normal text-slate-500">{steps.length} 件</span>
            </h2>
            <p className="text-xs text-slate-500">赤枠・矢印・黒塗りは、手順書にしたあと各ステップの「注釈」で付けられます。</p>
          </div>

          <ol className="mt-4 space-y-3">
            {steps.map((s, i) => (
              <li key={s.id} className="grid gap-3 rounded-lg border border-slate-200 p-3 md:grid-cols-[220px_minmax(0,1fr)_auto]">
                <div>
                  <button type="button" onClick={() => s.image && setShowFullImage(s.image)} className="block w-full overflow-hidden rounded-md border border-slate-200 bg-slate-100">
                    {s.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.image} alt={`手順 ${i + 1}`} className="aspect-video w-full object-contain" />
                    ) : (
                      <div className="flex aspect-video items-center justify-center text-xs text-slate-400">切り出し中...</div>
                    )}
                  </button>
                  <div className="mt-2 flex items-center justify-between gap-1 text-[11px] text-slate-500">
                    <button type="button" onClick={() => recaptureStep(s.id, s.time - 0.5)} className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-medium hover:bg-slate-50" title="0.5 秒前の画像にする">−0.5s</button>
                    <button type="button" onClick={() => seekPreview(s.time)} className="font-mono text-slate-600 hover:underline" title="動画をこの位置に合わせる">{formatTime(s.time)}</button>
                    <button type="button" onClick={() => recaptureStep(s.id, s.time + 0.5)} className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-medium hover:bg-slate-50" title="0.5 秒後の画像にする">+0.5s</button>
                  </div>
                  <button type="button" onClick={() => recaptureStep(s.id, previewRef.current?.currentTime ?? s.time)} className="mt-1 w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50" title="上の動画の再生位置の画像に差し替える">
                    再生位置の画像に差し替え
                  </button>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-700">{i + 1}</span>
                    <input
                      type="text"
                      value={s.title}
                      onChange={(e) => updateStep(s.id, { title: e.target.value })}
                      placeholder="手順の見出し"
                      className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  </div>
                  <textarea
                    value={s.text}
                    onChange={(e) => updateStep(s.id, { text: e.target.value })}
                    rows={3}
                    placeholder="操作の説明"
                    className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                <div className="flex flex-row gap-1 md:flex-col">
                  <button type="button" onClick={() => moveStep(i, -1)} disabled={i === 0} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-30" title="上へ">↑</button>
                  <button type="button" onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-30" title="下へ">↓</button>
                  <button type="button" onClick={() => removeStep(s.id)} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-red-600 hover:bg-red-50" title="削除">削除</button>
                </div>
              </li>
            ))}
          </ol>

          {/* 4. 手順書にする */}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
            <p className="text-xs text-slate-500">
              「手順書にする」で新規作成画面に移ります。タイトル・部署・保存先はそこで設定し、個人情報は保存前に注釈画面で黒塗りしてください。
            </p>
            <button
              type="button"
              onClick={handleBuild}
              disabled={readyCount === 0 || busy || building}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-40"
            >
              {building ? '作成中...' : `手順書にする（${readyCount} ステップ）`}
            </button>
          </div>
        </section>
      )}

      {showFullImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={() => setShowFullImage(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={showFullImage} alt="" className="max-h-full max-w-full rounded-md bg-white shadow-xl" />
        </div>
      )}
    </div>
  );
}
