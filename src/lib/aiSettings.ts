/**
 * 「動画から作成」の AI（Gemini）設定。
 * API キーは利用者が自分で入力し、この端末の localStorage にだけ保存する。
 * コード・Drive・手順書データには一切入れない。
 */

export const AI_SETTINGS_KEY = 'video_ai_settings';
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

export interface AiSettings {
  apiKey: string;
  model: string;
  /** 社内用語集（画面名・略語など）。プロンプトに含める */
  glossary: string;
}

const DEFAULTS: AiSettings = { apiKey: '', model: DEFAULT_GEMINI_MODEL, glossary: '' };

export function loadAiSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(AI_SETTINGS_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<AiSettings>;
    return {
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      model: typeof parsed.model === 'string' && parsed.model.trim() ? parsed.model.trim() : DEFAULT_GEMINI_MODEL,
      glossary: typeof parsed.glossary === 'string' ? parsed.glossary : '',
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveAiSettings(settings: AiSettings): void {
  try {
    const value: AiSettings = {
      apiKey: settings.apiKey.trim(),
      model: settings.model.trim() || DEFAULT_GEMINI_MODEL,
      glossary: settings.glossary,
    };
    if (!value.apiKey && value.model === DEFAULT_GEMINI_MODEL && !value.glossary) {
      localStorage.removeItem(AI_SETTINGS_KEY);
    } else {
      localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(value));
    }
  } catch {
    // localStorage が使えない環境では保存しない
  }
}

export function clearAiApiKey(): void {
  const current = loadAiSettings();
  saveAiSettings({ ...current, apiKey: '' });
}

/** 画面表示用: 末尾 4 桁だけ見せる */
export function maskApiKey(key: string): string {
  const k = key.trim();
  if (!k) return '';
  if (k.length <= 4) return '••••';
  return `••••••••${k.slice(-4)}`;
}
