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
