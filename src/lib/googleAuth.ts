const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
const SCOPES = 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/script.projects';

const STORAGE_TOKEN_KEY = 'google_auth_token';
const STORAGE_EXPIRY_KEY = 'google_auth_expiry';
const STORAGE_USER_KEY = 'google_auth_user';

// サイレント再ログイン（自動延長）の調整値
const REFRESH_LEAD_MS = 5 * 60 * 1000; // 失効の5分前に静かに更新する
const MIN_REFRESH_DELAY_MS = 20 * 1000; // 次回更新までの最短間隔
const SILENT_RETRY_MS = 60 * 1000; // 静かな更新に失敗したときの再試行間隔

export interface GoogleAuthState {
  isInitialized: boolean;
  isSignedIn: boolean;
  accessToken: string | null;
  userName: string | null;
  userEmail: string | null;
  userPhoto: string | null;
}

export type AuthListener = (state: GoogleAuthState) => void;

const authState: GoogleAuthState = {
  isInitialized: false,
  isSignedIn: false,
  accessToken: null,
  userName: null,
  userEmail: null,
  userPhoto: null,
};

let tokenClient: google.accounts.oauth2.TokenClient | null = null;
const listeners: Set<AuthListener> = new Set();

// サイレント再ログイン用の内部状態
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let tokenExpiry = 0; // アクセストークンの失効時刻(epoch ms)
let silentMode = false; // 直近の requestAccessToken がUIなしの自動更新だったか

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

async function fetchUserInfo(accessToken: string) {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      const data = await res.json();
      authState.userName = data.name || null;
      authState.userEmail = data.email || null;
      authState.userPhoto = data.picture || null;
    }
  } catch {
    // Non-critical, ignore
  }
}

/** Save token + user info to localStorage for session persistence */
function saveSession(accessToken: string, expiresIn: number) {
  tokenExpiry = Date.now() + expiresIn * 1000;
  localStorage.setItem(STORAGE_TOKEN_KEY, accessToken);
  localStorage.setItem(STORAGE_EXPIRY_KEY, String(tokenExpiry));
  const user = {
    name: authState.userName,
    email: authState.userEmail,
    photo: authState.userPhoto,
  };
  localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(user));
}

/** Clear saved session from localStorage */
function clearSession() {
  tokenExpiry = 0;
  localStorage.removeItem(STORAGE_TOKEN_KEY);
  localStorage.removeItem(STORAGE_EXPIRY_KEY);
  localStorage.removeItem(STORAGE_USER_KEY);
}

/** Try to restore a saved session from localStorage. Returns true if successful. */
function tryRestoreSession(): boolean {
  const token = localStorage.getItem(STORAGE_TOKEN_KEY);
  const expiryStr = localStorage.getItem(STORAGE_EXPIRY_KEY);
  if (!token || !expiryStr) return false;

  const expiry = Number(expiryStr);
  // Require at least 2 minutes remaining to avoid using nearly-expired tokens
  if (Date.now() > expiry - 120_000) {
    clearSession();
    return false;
  }

  authState.isSignedIn = true;
  authState.accessToken = token;
  tokenExpiry = expiry;

  // Restore cached user info immediately (will be refreshed in background)
  try {
    const user = JSON.parse(localStorage.getItem(STORAGE_USER_KEY) || '{}');
    authState.userName = user.name || null;
    authState.userEmail = user.email || null;
    authState.userPhoto = user.photo || null;
  } catch {
    // ignore parse errors
  }

  return true;
}

/* ---- サイレント再ログイン（自動延長） ---- */

function clearRefreshTimer() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

/** 失効の少し前に、UIを出さずトークンを更新するタイマーを仕掛ける。 */
function scheduleSilentRefresh() {
  clearRefreshTimer();
  if (!tokenExpiry) return;
  const delay = Math.max(tokenExpiry - Date.now() - REFRESH_LEAD_MS, MIN_REFRESH_DELAY_MS);
  refreshTimer = setTimeout(silentRefresh, delay);
}

/** ログイン中のトークンをUIなしで更新する。 */
function silentRefresh() {
  if (!tokenClient || !authState.isSignedIn) return;
  silentMode = true;
  try {
    tokenClient.requestAccessToken({ prompt: '' });
  } catch {
    silentMode = false;
  }
}

/** 以前サインインした端末で、UIを出さず自動的にサインインを試みる。 */
function trySilentSignIn() {
  if (!tokenClient) return;
  silentMode = true;
  try {
    tokenClient.requestAccessToken({ prompt: '' });
  } catch {
    silentMode = false;
  }
}

export async function initGoogleAuth(): Promise<void> {
  if (!isGoogleConfigured()) return;
  if (authState.isInitialized) return;

  await loadScript('https://accounts.google.com/gsi/client');
  await loadScript('https://apis.google.com/js/api.js');

  await new Promise<void>((resolve) => {
    gapi.load('client', () => resolve());
  });

  await gapi.client.init({});

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: async (response) => {
      const wasSilent = silentMode;
      silentMode = false;

      if (response.error) {
        // 自動更新の失敗で、かつトークンがまだ有効なら、ログアウトせず後で再試行
        if (wasSilent && tokenExpiry && Date.now() < tokenExpiry - 120_000) {
          clearRefreshTimer();
          refreshTimer = setTimeout(silentRefresh, SILENT_RETRY_MS);
          return;
        }
        authState.isSignedIn = false;
        authState.accessToken = null;
        clearRefreshTimer();
        clearSession();
        notifyListeners();
        return;
      }

      authState.isSignedIn = true;
      authState.accessToken = response.access_token;
      gapi.client.setToken({ access_token: response.access_token });
      const expiresIn = response.expires_in ?? 3600;
      // ユーザー情報は初回・対話ログイン時のみ取得（自動更新では変わらないため省略）
      if (!wasSilent || !authState.userName) {
        await fetchUserInfo(response.access_token);
      }
      saveSession(response.access_token, expiresIn);
      scheduleSilentRefresh();
      notifyListeners();
    },
    error_callback: () => {
      // ポップアップを閉じた／自動更新が拒否された等。状態は維持する
      silentMode = false;
    },
  });

  // Restore session from localStorage if token is still valid
  const restored = tryRestoreSession();
  if (restored) {
    gapi.client.setToken({ access_token: authState.accessToken! });
    scheduleSilentRefresh();
    // Refresh user info in background
    fetchUserInfo(authState.accessToken!).then(() => notifyListeners());
  } else if (localStorage.getItem(STORAGE_USER_KEY)) {
    // 以前サインインした端末なら、UIなしで自動サインインを試みる
    trySilentSignIn();
  }

  // スリープ復帰やタブ再表示時、失効が近ければ静かに更新する
  document.addEventListener('visibilitychange', () => {
    if (
      !document.hidden &&
      authState.isSignedIn &&
      tokenExpiry &&
      Date.now() > tokenExpiry - REFRESH_LEAD_MS
    ) {
      silentRefresh();
    }
  });

  authState.isInitialized = true;
  notifyListeners();
}

export function signIn(): void {
  if (!tokenClient) return;
  silentMode = false;
  tokenClient.requestAccessToken({ prompt: 'select_account' });
}

export function signOut(): void {
  const token = authState.accessToken;
  if (token) {
    google.accounts.oauth2.revoke(token);
    gapi.client.setToken(null);
  }
  clearRefreshTimer();
  authState.isSignedIn = false;
  authState.accessToken = null;
  authState.userName = null;
  authState.userEmail = null;
  authState.userPhoto = null;
  clearSession();
  notifyListeners();
}
