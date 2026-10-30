import { compressImageSource } from '@/lib/compressImage';

/**
 * ブラウザ内で動画からフレーム（静止画）を切り出す。
 * 動画は <video> で復号し、指定時刻へシークして canvas に描く。外部へは何も送らない。
 */

export interface VideoInfo {
  durationSec: number;
  width: number;
  height: number;
}

/** Blob を <video> に読み込み、長さ・解像度を返す。復号できない形式は reject。 */
export function loadVideo(blob: Blob): Promise<{ video: HTMLVideoElement; info: VideoInfo; revoke: () => void }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    const revoke = () => URL.revokeObjectURL(url);
    const fail = (msg: string) => {
      revoke();
      reject(new Error(msg));
    };
    video.onerror = () => fail('この動画はブラウザで再生できない形式です（H.264 の mp4 か webm をお使いください）。');
    video.onloadedmetadata = () => {
      if (!video.videoWidth || !video.videoHeight) {
        fail('動画の解像度を取得できませんでした。');
        return;
      }
      if (Number.isFinite(video.duration) && video.duration > 0) {
        resolve({ video, info: { durationSec: video.duration, width: video.videoWidth, height: video.videoHeight }, revoke });
        return;
      }
      // MediaRecorder の webm は duration が Infinity になるので、末尾へシークして長さを確定させる
      const onDurationFixed = () => {
        video.removeEventListener('durationchange', onDurationFixed);
        if (Number.isFinite(video.duration) && video.duration > 0) {
          video.currentTime = 0;
          resolve({ video, info: { durationSec: video.duration, width: video.videoWidth, height: video.videoHeight }, revoke });
        }
      };
      video.addEventListener('durationchange', onDurationFixed);
      video.currentTime = 1e101;
    };
    video.src = url;
  });
}

/** 指定時刻へシークし、描画できる状態になるまで待つ */
export function seekTo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const duration = Number.isFinite(video.duration) ? video.duration : Number.MAX_SAFE_INTEGER;
    const target = Math.min(Math.max(timeSec, 0), Math.max(duration - 0.05, 0));
    if (Math.abs(video.currentTime - target) < 0.001 && video.readyState >= 2) {
      resolve();
      return;
    }
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('動画のシークに失敗しました。'));
    };
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    video.currentTime = target;
  });
}

/** 指定時刻のフレームを画像の data URL で返す（compressImageSource の規則） */
export async function captureFrameAt(video: HTMLVideoElement, timeSec: number): Promise<string> {
  await seekTo(video, timeSec);
  return compressImageSource(video, video.videoWidth, video.videoHeight);
}

/** 複数時刻のフレームを順に切り出す（進捗・中断に対応） */
export async function captureFrames(
  video: HTMLVideoElement,
  times: number[],
  options: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < times.length; i++) {
    if (options.signal?.aborted) throw new DOMException('中断しました', 'AbortError');
    out.push(await captureFrameAt(video, times[i]));
    options.onProgress?.(i + 1, times.length);
  }
  return out;
}

/** 秒を「m:ss.s」表記にする */
export function formatTime(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, '0')}`;
}

/** 「1:23」「83」「01:23.5」「1h2m3s」などの表記を秒に直す */
export function parseTime(input: string | number): number | null {
  if (typeof input === 'number') return Number.isFinite(input) && input >= 0 ? input : null;
  const s = String(input).trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const colon = s.match(/^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/);
  if (colon) {
    const h = colon[1] ? parseInt(colon[1], 10) : 0;
    return h * 3600 + parseInt(colon[2], 10) * 60 + parseFloat(colon[3]);
  }
  const hms = s.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/);
  if (hms && (hms[1] || hms[2] || hms[3])) {
    return (hms[1] ? parseInt(hms[1], 10) * 3600 : 0) + (hms[2] ? parseInt(hms[2], 10) * 60 : 0) + (hms[3] ? parseFloat(hms[3]) : 0);
  }
  return null;
}

/** 画面録画（getDisplayMedia + MediaRecorder）。stop() で Blob を返す。 */
export interface ScreenRecorder {
  stop: () => Promise<Blob>;
  mimeType: string;
  /** 共有を OS 側で止めたとき（ブラウザの「共有を停止」など）に呼ばれる */
  onEnded: (cb: () => void) => void;
}

export function pickRecordingMimeType(): string {
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  if (typeof MediaRecorder === 'undefined') return '';
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? '';
}

export async function startScreenRecording(): Promise<ScreenRecorder> {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('このブラウザは画面録画に対応していません。');
  const mimeType = pickRecordingMimeType();
  if (!mimeType) throw new Error('このブラウザは録画形式に対応していません。');
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  let endedCb: (() => void) | null = null;
  let stopped = false;
  const stopPromise = new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      resolve(new Blob(chunks, { type: mimeType.split(';')[0] }));
    };
  });
  const stop = () => {
    if (!stopped) {
      stopped = true;
      if (recorder.state !== 'inactive') recorder.stop();
    }
    return stopPromise;
  };
  stream.getVideoTracks()[0]?.addEventListener('ended', () => {
    endedCb?.();
  });
  recorder.start(1000);
  return { stop, mimeType, onEnded: (cb) => { endedCb = cb; } };
}
