// Google Identity Services (GIS) Token Model
declare namespace google.accounts.oauth2 {
  interface TokenClient {
    requestAccessToken(config?: { prompt?: string }): void;
  }
  interface TokenClientConfig {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: { type: string; message: string }) => void;
  }
  interface TokenResponse {
    access_token: string;
    expires_in: number;
    error?: string;
    scope?: string;
    token_type?: string;
  }
  function initTokenClient(config: TokenClientConfig): TokenClient;
  function revoke(token: string, callback?: () => void): void;
}

// Google API Client (gapi)
declare namespace gapi {
  function load(api: string, callback: () => void): void;
  namespace client {
    function init(config: object): Promise<void>;
    function setToken(token: { access_token: string } | null): void;
    function getToken(): { access_token: string } | null;
    function request<T = unknown>(args: {
      path: string;
      method?: string;
      params?: Record<string, string>;
      headers?: Record<string, string>;
      body?: unknown;
    }): Promise<{ result: T; body: string; status: number }>;
  }
}
