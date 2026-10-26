import { appPath, consumeRedirectResult, startRedirectLogin } from '@/lib/oauthRedirect';

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
const SCOPES =
  'openid email profile https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets';

const STORAGE_TOKEN_KEY = 'google_auth_token';
const STORAGE_EXPIRY_KEY = 'google_auth_expiry';
const STORAGE_USER_KEY = 'google_auth_user';
/** 起動時の自動再ログイン（prompt=none）をこのタブで試したか。失敗したときに移動を繰り返さないため */
const AUTO_RELOGIN_KEY = 'google_auth_auto_relogin_tried';

// トークンの余裕（これより残りが短ければ切れたものとして扱う）
const TOKEN_MARGIN_MS = 60 * 1000;

export interface GoogleAuthState {
  isInitialized: boolean;
  /** アカウントが分かっている（サインアウトしていない）状態 */
  isSignedIn: boolean;
  /** トークンが失効し、自動更新もできなかった。ユーザー操作で再ログインが必要 */
  needsReauth: boolean;
  accessToken: string | null;
  userName: string | null;
  userEmail: string | null;
  userPhoto: string | null;
}

export type AuthListener = (state: GoogleAuthState) => void;

/** Google の認証が必要（失効・未ログイン・再ログイン拒否）なときに投げる */
export class AuthRequiredError extends Error {
  constructor(message = 'Google ログインの有効期限が切れました。再ログインしてください。') {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

/** 認証切れに起因するエラーか（AuthRequiredError・HTTP 401・gapi の 401 レスポンス） */
export function isAuthRequiredError(error: unknown): boolean {
  if (error instanceof AuthRequiredError) return true;
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: string; status?: number; result?: { error?: { code?: number; status?: string } }; message?: string };
  if (e.name === 'AuthRequiredError') return true;
  if (e.status === 401) return true;
  if (e.result?.error?.code === 401 || e.result?.error?.status === 'UNAUTHENTICATED') return true;
  if (typeof e.message === 'string' && /(^|\s)401(\b|:)|invalid_credentials|UNAUTHENTICATED|Invalid Credentials/.test(e.message)) return true;
  return false;
}

/** fetch の応答が失敗なら、401 は AuthRequiredError、それ以外は通常の Error を投げる */
export async function throwForResponse(res: Response, label: string): Promise<never> {
  const text = await res.text().catch(() => '');
  if (res.status === 401) throw new AuthRequiredError();
  throw new Error(`${label} ${res.status}${text ? `: ${text}` : ''}`);
}

const authState: GoogleAuthState = {
  isInitialized: false,
  isSignedIn: false,
  needsReauth: false,
  accessToken: null,
  userName: null,
  userEmail: null,
  userPhoto: null,
};

const listeners: Set<AuthListener> = new Set();

let initPromise: Promise<void> | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;
let tokenExpiry = 0; // アクセストークンの失効時刻(epoch ms)
let redirecting = false;


function notifyListeners() {
  listeners.forEach((fn) => fn({ ...authState }));
}

export function isGoogleConfigured(): boolean {
  return CLIENT_ID.length > 0;
}

export function getAuthState(): GoogleAuthState {
  return { ...authState };
}

export function addAuthListener(listener: AuthListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 有効期限内のトークンを持っているか（余裕 margin ms） */
function hasValidToken(marginMs = 0): boolean {
  return !!authState.accessToken && tokenExpiry > 0 && Date.now() < tokenExpiry - marginMs;
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

/* ---- localStorage ---- */

function saveCachedUserInfo() {
  const user = { name: authState.userName, email: authState.userEmail, photo: authState.userPhoto };
  try {
    localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(user));
  } catch {
    // 容量超過などは無視
  }
}

function loadCachedUserInfo(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_USER_KEY);
    if (!raw) return false;
    const user = JSON.parse(raw);
    authState.userName = user.name || null;
    authState.userEmail = user.email || null;
    authState.userPhoto = user.photo || null;
    return !!(authState.userEmail || authState.userName);
  } catch {
    return false;
  }
}

async function fetchUserInfo(accessToken: string): Promise<boolean> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      const data = await res.json();
      authState.userName = data.name || null;
      authState.userEmail = data.email || null;
      authState.userPhoto = data.picture || null;
      saveCachedUserInfo();
      return !!authState.userEmail;
    }
  } catch {
    // 取得できなくても致命的ではない
  }
  return false;
}

function saveToken(accessToken: string, expiresIn: number) {
  tokenExpiry = Date.now() + expiresIn * 1000;
  try {
    localStorage.setItem(STORAGE_TOKEN_KEY, accessToken);
    localStorage.setItem(STORAGE_EXPIRY_KEY, String(tokenExpiry));
  } catch {
    // 無視
  }
}

/** トークンだけ消す。アカウント情報（次回のサイレント再ログインに使う）は残す */
function clearToken() {
  tokenExpiry = 0;
  authState.accessToken = null;
  try {
    localStorage.removeItem(STORAGE_TOKEN_KEY);
    localStorage.removeItem(STORAGE_EXPIRY_KEY);
  } catch {
    // 無視
  }
}

function clearSession() {
  clearToken();
  try {
    localStorage.removeItem(STORAGE_USER_KEY);
  } catch {
    // 無視
  }
}

/**
 * 保存されたセッションを復元する。
 * - アカウント情報があれば isSignedIn=true（トークンが切れていても「以前ログインした人」として扱う）
 * - トークンが有効ならそのまま使う。切れていれば needsReauth=true にして、呼び出し側でサイレント再ログインを試す
 */
function restoreSession(): { hasAccount: boolean; tokenValid: boolean } {
  const hasAccount = loadCachedUserInfo();
  let tokenValid = false;
  try {
    const token = localStorage.getItem(STORAGE_TOKEN_KEY);
    const expiry = Number(localStorage.getItem(STORAGE_EXPIRY_KEY) || '0');
    if (token && expiry && Date.now() < expiry - 60_000) {
      authState.accessToken = token;
      tokenExpiry = expiry;
      tokenValid = true;
    } else if (token) {
      clearToken();
    }
  } catch {
    // 無視
  }
  authState.isSignedIn = hasAccount || tokenValid;
  authState.needsReauth = authState.isSignedIn && !tokenValid;
  return { hasAccount, tokenValid };
}

/* ---- タイマー ---- */

function clearTimers() {
  if (expiryTimer) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
}

/**
 * 失効時刻に needsReauth を立てる（「再ログイン」を表示）。
 * ページ移動を伴うため、使用中に自動で再ログインはしない。
 */
function scheduleTimers() {
  clearTimers();
  if (!tokenExpiry) return;
  const expiryDelay = Math.max(tokenExpiry - TOKEN_MARGIN_MS - Date.now(), 0);
  expiryTimer = setTimeout(() => {
    if (!hasValidToken(TOKEN_MARGIN_MS) && authState.isSignedIn && !authState.needsReauth) {
      authState.needsReauth = true;
      notifyListeners();
    }
  }, expiryDelay + 500);
}

/* ---- ページ移動によるログイン ---- */

/**
 * Google へ移動する直前に実行する処理（編集中の内容を下書きに保存するなど）。
 * 戻り値にアプリ内のパスを返すと、ログイン後はそのページへ戻る。
 */
type BeforeRedirectHook = () => Promise<string | null | void>;
const beforeRedirectHooks: Set<BeforeRedirectHook> = new Set();

export function addBeforeRedirectHook(hook: BeforeRedirectHook): () => void {
  beforeRedirectHooks.add(hook);
  return () => beforeRedirectHooks.delete(hook);
}

/** Google のログイン画面へ移動する。移動するのでこの Promise は解決しない */
async function redirectToLogin(options: { silent?: boolean } = {}): Promise<never> {
  if (!redirecting) {
    redirecting = true;
    let returnTo: string | null = null;
    for (const hook of beforeRedirectHooks) {
      try {
        const path = await hook();
        if (path) returnTo = appPath(path);
      } catch {
        // 保存に失敗しても、ログインは続ける
      }
    }
    startRedirectLogin({
      clientId: CLIENT_ID,
      scope: SCOPES,
      loginHint: authState.userEmail,
      silent: options.silent,
      selectAccount: !options.silent && !authState.userEmail,
      returnTo,
    });
  }
  return new Promise<never>(() => {});
}

/**
 * 有効なアクセストークンを返す。Drive/Sheets の呼び出し前に必ず使う。
 * - 期限内ならそのまま返す
 * - 切れていて interactive=true なら、Google のログイン画面へ移動する（ユーザー操作から呼ぶこと）
 * - 切れていて interactive=false なら AuthRequiredError（画面に「再ログイン」を出す）
 */
export async function ensureAccessToken(options: { interactive?: boolean; force?: boolean } = {}): Promise<string> {
  if (!isGoogleConfigured()) throw new AuthRequiredError('Google 連携が設定されていません。');
  await initGoogleAuth();
  if (!options.force && hasValidToken(TOKEN_MARGIN_MS)) return authState.accessToken as string;

  if (authState.isSignedIn && !authState.needsReauth) {
    authState.needsReauth = true;
    notifyListeners();
  }
  if (!options.interactive) throw new AuthRequiredError();
  return redirectToLogin();
}

/**
 * Drive/Sheets の呼び出しを認証つきで実行する。
 * 事前に有効なトークンを確保し、それでも 401 が返ったら再ログインを求める。
 */
export async function withGoogleAuth<T>(fn: (token: string) => Promise<T>, options: { interactive?: boolean } = {}): Promise<T> {
  const token = await ensureAccessToken(options);
  try {
    return await fn(token);
  } catch (e) {
    if (!isAuthRequiredError(e)) throw e;
    // トークンが取り消された・権限が変わったなど
    clearToken();
    const fresh = await ensureAccessToken({ ...options, force: true });
    try {
      return await fn(fresh);
    } catch (e2) {
      if (isAuthRequiredError(e2)) throw new AuthRequiredError();
      throw e2;
    }
  }
}

/* ---- 初期化 ---- */

/** 直前の signIn が失敗した理由（画面に出す文言）。成功・未実行なら null */
let lastSignInError: string | null = null;

export function getLastSignInError(): string | null {
  return lastSignInError;
}

function signInErrorMessage(error: string): string {
  if (/access_denied/i.test(error)) return 'ログインが完了しませんでした（Google の画面でキャンセルされました）。もう一度押してください。';
  return `ログインできませんでした（${error}）。もう一度押してください。`;
}

function markAutoReloginTried(tried: boolean) {
  try {
    if (tried) sessionStorage.setItem(AUTO_RELOGIN_KEY, '1');
    else sessionStorage.removeItem(AUTO_RELOGIN_KEY);
  } catch {
    // 無視
  }
}

function autoReloginTried(): boolean {
  try {
    return sessionStorage.getItem(AUTO_RELOGIN_KEY) === '1';
  } catch {
    return true; // 記録できない環境では、移動を繰り返さないよう試さない
  }
}

export function initGoogleAuth(): Promise<void> {
  if (!isGoogleConfigured()) return Promise.resolve();
  if (initPromise) return initPromise;
  initPromise = (async () => {
    // Google のログイン画面から戻ってきた直後なら、結果を受け取る（URL からはすぐ消す）
    const { result, returnTo } = consumeRedirectResult();
    if (result?.kind === 'token') {
      markAutoReloginTried(false);
      saveToken(result.accessToken, result.expiresIn);
      // 元のページへ戻る。トークンは保存済みなので、移動先でそのまま使える
      if (returnTo) {
        window.location.replace(returnTo);
        return new Promise<void>(() => {});
      }
    } else if (result?.kind === 'error' && !result.silent) {
      lastSignInError = signInErrorMessage(result.error);
    }

    await loadScript('https://apis.google.com/js/api.js');
    await new Promise<void>((resolve) => gapi.load('client', () => resolve()));
    await gapi.client.init({});

    const { hasAccount, tokenValid } = restoreSession();
    if (tokenValid) {
      gapi.client.setToken({ access_token: authState.accessToken as string });
      scheduleTimers();
      if (result?.kind === 'token' || !hasAccount) await fetchUserInfo(authState.accessToken as string);
      else fetchUserInfo(authState.accessToken as string).then(() => notifyListeners());
    } else if (hasAccount && !autoReloginTried() && !(result?.kind === 'error')) {
      // 以前ログインした端末でトークンが切れている: 1タブ1回だけ、画面を出さない再ログイン（prompt=none）へ移動する。
      // Google にログイン済みなら一瞬で戻ってくる。だめなら「再ログイン」を表示する。
      markAutoReloginTried(true);
      return redirectToLogin({ silent: true });
    }

    // 使用中に期限が切れていたら（スリープ復帰など）、「再ログイン」を表示する
    const onWake = () => {
      if (document.hidden || !authState.isSignedIn || authState.needsReauth) return;
      if (!hasValidToken(TOKEN_MARGIN_MS)) {
        authState.needsReauth = true;
        notifyListeners();
      }
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);

    authState.isInitialized = true;
    notifyListeners();
  })().catch((e) => {
    initPromise = null;
    throw e;
  });
  return initPromise;
}

/**
 * ログインボタン・「再ログイン」から呼ぶ。Google のログイン画面へページごと移動する
 * （ポップアップは使わないので、ブラウザにブロックされない）。
 * すでに有効なトークンがあれば移動せずに true を返す。
 */
export async function signIn(): Promise<boolean> {
  lastSignInError = null;
  if (!isGoogleConfigured()) {
    lastSignInError = 'Google 連携が設定されていません。管理者に連絡してください。';
    return false;
  }
  try {
    await initGoogleAuth();
  } catch {
    lastSignInError = 'Google の読み込みに失敗しました。通信環境を確認して、もう一度押してください。';
    notifyListeners();
    return false;
  }
  if (authState.isSignedIn && !authState.needsReauth && hasValidToken(TOKEN_MARGIN_MS)) return true;
  return redirectToLogin();
}

/** 承認などでユーザーのメールが必要なときに、必要ならログインさせて状態を返す */
export async function ensureGoogleUserInfo(): Promise<GoogleAuthState> {
  if (!isGoogleConfigured()) return getAuthState();
  try {
    const token = await ensureAccessToken({ interactive: true });
    if (!authState.userEmail) {
      await fetchUserInfo(token);
      notifyListeners();
    }
  } catch {
    // 呼び出し側が isSignedIn / userEmail を見て判断する
  }
  return getAuthState();
}

export function signOut(): void {
  const token = authState.accessToken;
  if (token) {
    // トークンを取り消す（結果は待たない）
    fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }).catch(() => {});
    try {
      gapi.client.setToken(null);
    } catch {
      // 無視
    }
  }
  clearTimers();
  markAutoReloginTried(false);
  authState.isSignedIn = false;
  authState.needsReauth = false;
  authState.accessToken = null;
  authState.userName = null;
  authState.userEmail = null;
  authState.userPhoto = null;
  clearSession();
  notifyListeners();
}
