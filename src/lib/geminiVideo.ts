import { parseTime } from '@/lib/videoFrames';

/**
 * 動画を Gemini API に送り、「時刻つきの手順一覧（JSON）」を受け取る。
 * - 20MB 以下: generateContent に inline（base64）で添付
 * - 20MB 超: Files API（resumable upload）にいったん上げ、処理完了を待ってから参照
 * どちらもブラウザから generativelanguage.googleapis.com へ直接 fetch する。
 * 送るのは動画と用語集（プロンプト）だけ。API キーは利用者の端末にしか無い。
 */

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com';
export const INLINE_LIMIT_BYTES = 20 * 1024 * 1024;

export interface VideoStep {
  /** 動画内の時刻（秒） */
  time: number;
  title: string;
  text: string;
}

export type AnalyzeStage = 'upload' | 'processing' | 'analyze' | 'done';

export interface AnalyzeOptions {
  apiKey: string;
  model: string;
  glossary?: string;
  mimeType?: string;
  durationSec?: number;
  signal?: AbortSignal;
  onProgress?: (stage: AnalyzeStage, detail?: string) => void;
  /** テスト用: fetch の差し替え */
  fetchImpl?: typeof fetch;
  /** テスト用: ポーリング間隔 */
  pollIntervalMs?: number;
}

export class GeminiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
  }
}

const RESPONSE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      time: { type: 'NUMBER', description: '画面が切り替わった直後の時刻（秒、小数可）' },
      title: { type: 'STRING', description: '手順の見出し（動詞止め、20文字以内）' },
      text: { type: 'STRING', description: '操作の説明（1〜2文）' },
    },
    required: ['time', 'title', 'text'],
  },
};

export function buildPrompt(glossary?: string, durationSec?: number): string {
  const lines = [
    'あなたは業務マニュアルの作成者です。添付の動画はパソコンの画面操作を録画したものです。',
    'この動画を見て、作業手順書のステップ一覧を JSON 配列で出力してください。',
    '',
    '出力の決まり:',
    '- 1 つの操作（クリック・入力・画面の切り替わりなど）につき 1 ステップ。',
    '- time は、その操作の結果が画面に表示された直後の時刻（秒）。読み込み中やアニメーションの途中は避ける。',
    '- title は 20 文字以内の見出し（例「受注一覧を開く」「品番を入力する」）。',
    '- text は 1〜2 文で、どの画面で何をどう操作するかを具体的に書く（画面名・ボタン名・入力値の種類を含める）。',
    '- 同じ画面で何も変わっていない区間は 1 ステップにまとめる。',
    '- 手順は時刻順に並べる。',
    '- JSON 以外の文章は出力しない。',
  ];
  if (durationSec && Number.isFinite(durationSec)) lines.push(`- 動画の長さは ${Math.round(durationSec)} 秒。time はこの範囲内。`);
  const g = (glossary ?? '').trim();
  if (g) {
    lines.push('', '社内用語集（画面名・略語はこの表記を使うこと）:', g);
  }
  return lines.join('\n');
}

/** Gemini の応答テキストや、利用者が貼り付けた JSON を VideoStep[] にする */
export function parseStepsJson(text: string): VideoStep[] {
  let body = text.trim();
  // ```json ... ``` で囲まれていたら中身だけ使う
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) body = fence[1].trim();
  // 先頭が [ でなければ最初の [ から最後の ] までを使う
  if (!body.startsWith('[') && !body.startsWith('{')) {
    const start = body.indexOf('[');
    const end = body.lastIndexOf(']');
    if (start >= 0 && end > start) body = body.slice(start, end + 1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('JSON として読めませんでした。[ { "time": 秒, "title": "…", "text": "…" }, … ] の形にしてください。');
  }
  let list: unknown[];
  if (Array.isArray(parsed)) list = parsed;
  else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { steps?: unknown }).steps)) list = (parsed as { steps: unknown[] }).steps;
  else throw new Error('手順の配列が見つかりません。');
  const out: VideoStep[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const rawTime = o.time ?? o.timestamp ?? o.sec ?? o.seconds ?? o.start;
    const time = rawTime === undefined || rawTime === null ? null : parseTime(rawTime as string | number);
    if (time === null) continue;
    const title = String(o.title ?? o.heading ?? '').trim();
    const text = String(o.text ?? o.description ?? o.body ?? '').trim();
    out.push({ time, title, text });
  }
  if (out.length === 0) throw new Error('time を持つ手順が 1 件もありません。');
  return out;
}

/** 時刻順に並べ、動画の長さに収め、近すぎる重複を捨てる */
export function normalizeSteps(steps: VideoStep[], durationSec?: number, minGapSec = 0.5): VideoStep[] {
  const max = durationSec && Number.isFinite(durationSec) ? Math.max(durationSec - 0.1, 0) : Infinity;
  const sorted = steps
    .map((s) => ({ ...s, time: Math.min(Math.max(s.time, 0), max) }))
    .sort((a, b) => a.time - b.time);
  const out: VideoStep[] = [];
  for (const s of sorted) {
    const prev = out[out.length - 1];
    if (prev && s.time - prev.time < minGapSec) {
      // 近すぎるものは説明文を後ろへ足して 1 つにまとめる
      if (s.text && !prev.text.includes(s.text)) prev.text = prev.text ? `${prev.text} ${s.text}` : s.text;
      if (!prev.title && s.title) prev.title = s.title;
      continue;
    }
    out.push({ ...s });
  }
  return out.map((s, i) => ({ ...s, title: s.title || `手順 ${i + 1}` }));
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('動画の読み込みに失敗しました。'));
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
}

async function readError(res: Response): Promise<GeminiError> {
  let message = `${res.status} ${res.statusText}`;
  try {
    const body = await res.json();
    const m = body?.error?.message;
    if (typeof m === 'string' && m) message = m;
  } catch {
    // 本文が JSON でない
  }
  if (res.status === 400 && /API key/i.test(message)) message = 'API キーが正しくありません。設定を確認してください。';
  if (res.status === 403) message = `API キーに権限がありません（${message}）。`;
  if (res.status === 429) message = `利用上限に達しました。しばらく待ってから再実行してください（${message}）。`;
  return new GeminiError(message, res.status);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('中断しました', 'AbortError'));
    }, { once: true });
  });
}

function normalizeMime(type: string | undefined, fallback = 'video/webm'): string {
  const t = (type || '').split(';')[0].trim().toLowerCase();
  if (!t) return fallback;
  if (t === 'video/x-matroska') return 'video/webm';
  if (t === 'video/quicktime') return 'video/mov';
  return t;
}

/** Files API に resumable upload し、ACTIVE になるまで待って file の uri / name を返す */
export async function uploadVideoFile(
  blob: Blob,
  opts: { apiKey: string; mimeType: string; signal?: AbortSignal; onProgress?: (stage: AnalyzeStage, detail?: string) => void; fetchImpl?: typeof fetch; pollIntervalMs?: number },
): Promise<{ name: string; uri: string }> {
  const f = opts.fetchImpl ?? fetch;
  opts.onProgress?.('upload');
  const start = await f(`${GEMINI_BASE}/upload/v1beta/files`, {
    method: 'POST',
    signal: opts.signal,
    headers: {
      'x-goog-api-key': opts.apiKey,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(blob.size),
      'X-Goog-Upload-Header-Content-Type': opts.mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: `manual-video-${Date.now()}` } }),
  });
  if (!start.ok) throw await readError(start);
  const uploadUrl = start.headers.get('x-goog-upload-url') || start.headers.get('X-Goog-Upload-URL');
  if (!uploadUrl) throw new GeminiError('アップロード先 URL を取得できませんでした。', start.status);

  const up = await f(uploadUrl, {
    method: 'POST',
    signal: opts.signal,
    headers: {
      'x-goog-api-key': opts.apiKey,
      'Content-Length': String(blob.size),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: blob,
  });
  if (!up.ok) throw await readError(up);
  const upJson = await up.json();
  const file = upJson?.file as { name?: string; uri?: string; state?: string } | undefined;
  if (!file?.name || !file.uri) throw new GeminiError('アップロード結果に file が含まれていません。', up.status);

  let state = file.state ?? 'PROCESSING';
  const interval = opts.pollIntervalMs ?? 2000;
  let waited = 0;
  while (state === 'PROCESSING') {
    opts.onProgress?.('processing', `${Math.round(waited / 1000)} 秒`);
    await sleep(interval, opts.signal);
    waited += interval;
    const st = await f(`${GEMINI_BASE}/v1beta/${file.name}`, { headers: { 'x-goog-api-key': opts.apiKey }, signal: opts.signal });
    if (!st.ok) throw await readError(st);
    const stJson = await st.json();
    state = stJson?.state ?? 'PROCESSING';
    if (waited > 10 * 60 * 1000) throw new GeminiError('動画の処理が 10 分以内に終わりませんでした。', 504);
  }
  if (state !== 'ACTIVE') throw new GeminiError(`動画の処理に失敗しました（state: ${state}）。`, 500);
  return { name: file.name, uri: file.uri };
}

export async function deleteUploadedFile(name: string, apiKey: string, fetchImpl?: typeof fetch): Promise<void> {
  const f = fetchImpl ?? fetch;
  try {
    await f(`${GEMINI_BASE}/v1beta/${name}`, { method: 'DELETE', headers: { 'x-goog-api-key': apiKey } });
  } catch {
    // 削除失敗は無視（48 時間で自動削除される）
  }
}

/** 動画を解析して手順一覧を返す */
export async function analyzeVideo(blob: Blob, options: AnalyzeOptions): Promise<VideoStep[]> {
  const f = options.fetchImpl ?? fetch;
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new GeminiError('API キーが設定されていません。', 0);
  const model = options.model.trim();
  const mimeType = normalizeMime(options.mimeType || blob.type);
  const prompt = buildPrompt(options.glossary, options.durationSec);

  let videoPart: Record<string, unknown>;
  let uploadedName: string | null = null;
  if (blob.size <= INLINE_LIMIT_BYTES) {
    options.onProgress?.('upload');
    const data = await blobToBase64(blob);
    videoPart = { inline_data: { mime_type: mimeType, data } };
  } else {
    const uploaded = await uploadVideoFile(blob, { apiKey, mimeType, signal: options.signal, onProgress: options.onProgress, fetchImpl: f, pollIntervalMs: options.pollIntervalMs });
    uploadedName = uploaded.name;
    videoPart = { file_data: { mime_type: mimeType, file_uri: uploaded.uri } };
  }

  try {
    options.onProgress?.('analyze');
    const res = await f(`${GEMINI_BASE}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      signal: options.signal,
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [videoPart, { text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    });
    if (!res.ok) throw await readError(res);
    const json = await res.json();
    const candidate = json?.candidates?.[0];
    const text: string = (candidate?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('');
    if (!text.trim()) {
      const reason = candidate?.finishReason || json?.promptFeedback?.blockReason || '応答が空でした';
      throw new GeminiError(`AI から手順を取得できませんでした（${reason}）。`, 200);
    }
    const steps = parseStepsJson(text);
    options.onProgress?.('done');
    return normalizeSteps(steps, options.durationSec);
  } finally {
    if (uploadedName) void deleteUploadedFile(uploadedName, apiKey, f);
  }
}
