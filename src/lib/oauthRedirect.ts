/**
 * Google OAuth 2.0 のリダイレクト方式（ポップアップを使わない）。
 * ログイン時はページごと Google の画面へ移動し、承認後に各エディションのトップへ
 * `#access_token=...` 付きで戻ってくる。トップで受け取ったら元のページへ戻す。
 *
 * Google Cloud の OAuth クライアントに、各エディションのトップ URL
 * （例: https://horizon-jit.github.io/Manual-Management-System_v3/ と …/viewer/）を
 * 「承認済みのリダイレクト URI」として登録しておく必要がある。
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const STATE_KEY = 'google_oauth_redirect';

/** next.config の basePath（本番は /<repo> や /<repo>/viewer、開発時は空） */
const BASE_PATH = process.env.NODE_ENV === 'production'
  ? `/${process.env.NEXT_PUBLIC_REPO_NAME || 'FC'}${process.env.NEXT_PUBLIC_BASE_SUBPATH ? `/${process.env.NEXT_PUBLIC_BASE_SUBPATH}` : ''}`
  : '';

interface SavedState {
  state: string;
  returnTo: string;
  silent: boolean;
}

export type RedirectResult =
  | { kind: 'token'; accessToken: string; expiresIn: number }
  | { kind: 'error'; error: string; silent: boolean };

/** Google から戻ってくる URL。Google Cloud に登録したものと完全に一致させる */
export function redirectUri(): string {
  return `${window.location.origin}${BASE_PATH}/`;
}

/** アプリ内のパス（/instructions/...）を、basePath 付きの絶対パスにする */
export function appPath(path: string): string {
  return `${BASE_PATH}${path.startsWith('/') ? path : `/${path}`}`;
}

function randomState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Google のログイン画面へ移動する。戻ってきたら returnTo（省略時は今のページ）へ戻す。
 * silent=true は prompt=none（Google にログイン済みなら画面を出さずにすぐ戻る）。
 */
export function startRedirectLogin(options: {
  clientId: string;
  scope: string;
  loginHint?: string | null;
  silent?: boolean;
  selectAccount?: boolean;
  returnTo?: string | null;
}): void {
  const state = randomState();
  const saved: SavedState = {
    state,
    returnTo: options.returnTo || `${window.location.pathname}${window.location.search}${window.location.hash}`,
    silent: !!options.silent,
  };
  try {
    sessionStorage.setItem(STATE_KEY, JSON.stringify(saved));
  } catch {
    // 保存できなくても、戻ったときにトップを表示するだけ
  }
  const params = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: options.scope,
    include_granted_scopes: 'true',
    state,
  });
  if (options.loginHint) params.set('login_hint', options.loginHint);
  if (options.silent) params.set('prompt', 'none');
  else if (options.selectAccount) params.set('prompt', 'select_account');
  window.location.assign(`${AUTH_ENDPOINT}?${params.toString()}`);
}

/**
 * Google から戻ってきた直後なら、URL の結果を読み取って消す。
 * returnTo は戻るべき元のページ（今のページと同じなら null）。トークンを保存してから移動すること。
 */
export function consumeRedirectResult(): { result: RedirectResult | null; returnTo: string | null } {
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
  if (!hash || !/(^|&)(access_token|error)=/.test(hash)) return { result: null, returnTo: null };
  const params = new URLSearchParams(hash);
  const returnedState = params.get('state');
  let saved: SavedState | null = null;
  try {
    const raw = sessionStorage.getItem(STATE_KEY);
    saved = raw ? (JSON.parse(raw) as SavedState) : null;
    sessionStorage.removeItem(STATE_KEY);
  } catch {
    saved = null;
  }

  // URL からトークンを消す（履歴にも残さない）
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);

  // 自分が出した要求でなければ無視する
  if (!saved || !returnedState || saved.state !== returnedState) return { result: null, returnTo: null };

  let result: RedirectResult;
  const accessToken = params.get('access_token');
  if (accessToken) {
    result = { kind: 'token', accessToken, expiresIn: Number(params.get('expires_in')) || 3600 };
  } else {
    result = { kind: 'error', error: params.get('error') || 'unknown_error', silent: saved.silent };
  }

  const here = `${window.location.pathname}${window.location.search}`;
  return { result, returnTo: saved.returnTo && saved.returnTo !== here ? saved.returnTo : null };
}
