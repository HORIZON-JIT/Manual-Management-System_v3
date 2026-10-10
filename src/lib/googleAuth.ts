const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
const SCOPES =
  'openid email profile https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/script.projects';

const STORAGE_TOKEN_KEY = 'google_auth_token';
const STORAGE_EXPIRY_KEY = 'google_auth_expiry';
const STORAGE_USER_KEY = 'google_auth_user';

// トークン更新の調整値
const REFRESH_LEAD_MS = 5 * 60 * 1000; // 失効の5分前から更新対象にする
const MIN_REFRESH_DELAY_MS = 20 * 1000; // 次回更新までの最短間隔
const SILENT_RETRY_MS = 60 * 1000; // サイレント更新に失敗したときの再試行間隔
const SILENT_TIMEOUT_MS = 8 * 1000; // サイレント更新の応答を待つ上限
const INIT_SILENT_WAIT_MS = 4 * 1000; // 起動時にサイレント再ログインの結果を待つ上限

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

let tokenClient: google.accounts.oauth2.TokenClient | null = null;
const listeners: Set<AuthListener> = new Set();

let initPromise: Promise<void> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;
let tokenExpiry = 0; // アクセストークンの失効時刻(epoch ms)

// requestAccessToken は callback で結果が返るので、Promise に包んで 1 件ずつ処理する
interface PendingTokenRequest {
  resolve: (response: google.accounts.oauth2.TokenResponse) => void;
  reject: (error: Error) => void;
  silent: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}
let pending: PendingTokenRequest | null = null;
let pendingPromise: Promise<google.accounts.oauth2.TokenResponse> | null = null;

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
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  if (expiryTimer) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
}

/** 失効の少し前にサイレント更新し、失効時刻には needsReauth を立てる */
function scheduleTimers() {
  clearTimers();
  if (!tokenExpiry) return;
  const refreshDelay = Math.max(tokenExpiry - Date.now() - REFRESH_LEAD_MS, MIN_REFRESH_DELAY_MS);
  refreshTimer = setTimeout(() => {
    silentRefresh().catch(() => {});
  }, refreshDelay);
  const expiryDelay = Math.max(tokenExpiry - Date.now(), 0);
  expiryTimer = setTimeout(() => {
    if (!hasValidToken() && authState.isSignedIn && !authState.needsReauth) {
      authState.needsReauth = true;
      notifyListeners();
    }
  }, expiryDelay + 500);
}

/* ---- トークン取得（Promise 化） ---- */

function settlePending(response: google.accounts.oauth2.TokenResponse | null, error?: Error) {
  const p = pending;
  if (!p) return;
  pending = null;
  pendingPromise = null;
  if (p.timer) clearTimeout(p.timer);
  if (response && !response.error) p.resolve(response);
  else p.reject(error ?? new Error(response?.error || 'token request failed'));
}

/**
 * GIS にトークンを要求する。同時に複数呼ばれたら同じ要求を共有する。
 * silent=true は UI を出さない（prompt:''）。ブラウザや Cookie 設定によっては失敗する。
 */
function requestToken(options: { silent: boolean; prompt?: string }): Promise<google.accounts.oauth2.TokenResponse> {
  if (!tokenClient) return Promise.reject(new AuthRequiredError('Google 認証の準備ができていません。'));
  if (pendingPromise) return pendingPromise;
  const client = tokenClient;
  pendingPromise = new Promise((resolve, reject) => {
    pending = { resolve, reject, silent: options.silent, timer: null };
    if (options.silent) {
      pending.timer = setTimeout(() => settlePending(null, new Error('silent token request timed out')), SILENT_TIMEOUT_MS);
    }
    try {
      const config: { prompt?: string; hint?: string } = { prompt: options.silent ? '' : (options.prompt ?? '') };
      if (authState.userEmail) config.hint = authState.userEmail;
      client.requestAccessToken(config);
    } catch (e) {
      settlePending(null, e instanceof Error ? e : new Error(String(e)));
    }
  });
  return pendingPromise;
}

async function applyToken(response: google.accounts.oauth2.TokenResponse, silent: boolean) {
  authState.isSignedIn = true;
  authState.needsReauth = false;
  authState.accessToken = response.access_token;
  gapi.client.setToken({ access_token: response.access_token });
  saveToken(response.access_token, response.expires_in ?? 3600);
  // ユーザー情報は初回・対話ログイン時のみ取得（自動更新では変わらない）
  if (!silent || !authState.userEmail) {
    await fetchUserInfo(response.access_token);
  } else {
    saveCachedUserInfo();
  }
  scheduleTimers();
  notifyListeners();
}

/** UI を出さずにトークンを更新する。失敗したら needsReauth を立てて例外を投げる */
async function silentRefresh(): Promise<string> {
  if (!authState.isSignedIn) throw new AuthRequiredError();
  try {
    const response = await requestToken({ silent: true });
    await applyToken(response, true);
    return response.access_token;
  } catch (e) {
    if (hasValidToken(60_000)) {
      // まだ有効なら後で再試行するだけ
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        silentRefresh().catch(() => {});
      }, SILENT_RETRY_MS);
      return authState.accessToken as string;
    }
    if (!authState.needsReauth) {
      authState.needsReauth = true;
      notifyListeners();
    }
    throw e instanceof AuthRequiredError ? e : new AuthRequiredError();
  }
}

/**
 * 有効なアクセストークンを返す。Drive/Sheets の呼び出し前に必ず使う。
 * - 期限に余裕があればそのまま返す
 * - 近い／切れていればサイレント更新
 * - interactive=true なら、サイレント更新に失敗したときポップアップで再ログインを求める（ユーザー操作の直後に呼ぶこと）
 */
export async function ensureAccessToken(options: { interactive?: boolean; force?: boolean } = {}): Promise<string> {
  if (!isGoogleConfigured()) throw new AuthRequiredError('Google 連携が設定されていません。');
  await initGoogleAuth();
  if (!options.force && hasValidToken(REFRESH_LEAD_MS)) return authState.accessToken as string;

  if (authState.isSignedIn || authState.userEmail) {
    try {
      return await silentRefresh();
    } catch {
      // 対話にフォールバック
    }
  }
  if (!options.interactive) throw new AuthRequiredError();

  const response = await requestToken({ silent: false, prompt: authState.userEmail ? '' : 'select_account' }).catch(() => {
    throw new AuthRequiredError('Google ログインがキャンセルされました。');
  });
  await applyToken(response, false);
  return response.access_token;
}

/**
 * Drive/Sheets の呼び出しを認証つきで実行する。
 * 事前に有効なトークンを確保し、それでも 401 が返ったら強制更新して 1 回だけやり直す。
 */
export async function withGoogleAuth<T>(fn: (token: string) => Promise<T>, options: { interactive?: boolean } = {}): Promise<T> {
  const token = await ensureAccessToken(options);
  try {
    return await fn(token);
  } catch (e) {
    if (!isAuthRequiredError(e)) throw e;
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

export function initGoogleAuth(): Promise<void> {
  if (!isGoogleConfigured()) return Promise.resolve();
  if (initPromise) return initPromise;
  initPromise = (async () => {
    await loadScript('https://accounts.google.com/gsi/client');
    await loadScript('https://apis.google.com/js/api.js');
    await new Promise<void>((resolve) => gapi.load('client', () => resolve()));
    await gapi.client.init({});

    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: (response) => settlePending(response),
      error_callback: (error) => settlePending(null, new Error(error?.message || error?.type || 'token request failed')),
    });

    const { tokenValid } = restoreSession();
    if (tokenValid) {
      gapi.client.setToken({ access_token: authState.accessToken as string });
      scheduleTimers();
      fetchUserInfo(authState.accessToken as string).then(() => notifyListeners());
    } else if (authState.isSignedIn) {
      // 以前ログインした端末: 画面を「未ログイン」にせず、まずサイレント再ログインを試す（最大数秒待つ）
      await Promise.race([
        silentRefresh().catch(() => {}),
        new Promise<void>((resolve) => setTimeout(resolve, INIT_SILENT_WAIT_MS)),
      ]);
    }

    // スリープ復帰・タブ再表示・ウィンドウ復帰時に、失効が近ければ静かに更新する
    const onWake = () => {
      if (document.hidden || !authState.isSignedIn) return;
      if (authState.needsReauth || !hasValidToken(REFRESH_LEAD_MS)) {
        silentRefresh().catch(() => {});
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

/** ヘッダーの「Google Drive」「再ログイン」ボタン。ユーザー操作から呼ぶ */
export async function signIn(): Promise<boolean> {
  try {
    await ensureAccessToken({ interactive: true, force: true });
    return true;
  } catch {
    return false;
  }
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
    try {
      google.accounts.oauth2.revoke(token);
      gapi.client.setToken(null);
    } catch {
      // 無視
    }
  }
  clearTimers();
  settlePending(null, new AuthRequiredError('サインアウトしました。'));
  authState.isSignedIn = false;
  authState.needsReauth = false;
  authState.accessToken = null;
  authState.userName = null;
  authState.userEmail = null;
  authState.userPhoto = null;
  clearSession();
  notifyListeners();
}
