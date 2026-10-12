import { parseTime } from '@/lib/videoFrames';

/**
 * 「動画から作成」の手順一覧（時刻つき JSON）の扱い。
 * 利用者が Gemini（ウェブ版）に動画と指示文を渡し、返ってきた JSON をアプリに貼る。
 * アプリ自身は動画も画像もどこにも送らない。
 */

export const GEMINI_WEB_URL = 'https://gemini.google.com/app';
export const GLOSSARY_STORAGE_KEY = 'video_prompt_glossary';

export interface VideoStep {
  /** 動画内の時刻（秒） */
  time: number;
  title: string;
  text: string;
}

export function loadGlossary(): string {
  try {
    return localStorage.getItem(GLOSSARY_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveGlossary(text: string): void {
  try {
    if (text.trim()) localStorage.setItem(GLOSSARY_STORAGE_KEY, text);
    else localStorage.removeItem(GLOSSARY_STORAGE_KEY);
  } catch {
    // localStorage が使えない環境では保存しない
  }
}

/** Gemini に貼り付ける指示文 */
export function buildPrompt(glossary?: string, durationSec?: number): string {
  const lines = [
    'あなたは業務マニュアルの作成者です。添付の動画はパソコンの画面操作を録画したものです。',
    'この動画を見て、作業手順書のステップ一覧を JSON 配列だけで出力してください。',
    '',
    '出力形式（この形の JSON 配列だけを出力し、前後に説明文を付けない）:',
    '[',
    '  { "time": 12.5, "title": "受注一覧を開く", "text": "メニューの「受注管理」から「受注一覧」を開く。" },',
    '  { "time": 20.0, "title": "品番を入力する", "text": "検索欄に品番を入力し、「検索」を押す。" }',
    ']',
    '',
    '決まり:',
    '- 1 つの操作（クリック・入力・画面の切り替わりなど）につき 1 ステップ。',
    '- time は秒の数値（例 83.5）。その操作の結果が画面に表示された直後の時刻にする。読み込み中やアニメーションの途中は避ける。',
    '- title は 20 文字以内の見出し（動詞止め）。',
    '- text は 1〜2 文で、どの画面で何をどう操作するかを具体的に書く（画面名・ボタン名・入力値の種類を含める）。',
    '- 同じ画面で何も変わっていない区間は 1 ステップにまとめる。',
    '- 手順は時刻順に並べる。',
  ];
  if (durationSec && Number.isFinite(durationSec)) lines.push(`- 動画の長さは ${Math.round(durationSec)} 秒。time はこの範囲内。`);
  const g = (glossary ?? '').trim();
  if (g) lines.push('', '社内用語集（画面名・略語はこの表記を使うこと）:', g);
  return lines.join('\n');
}

/** Gemini の回答や、利用者が貼り付けた JSON を VideoStep[] にする */
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
