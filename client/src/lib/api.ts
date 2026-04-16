function normalizeApiUrl(rawValue: unknown): string {
  const raw = String(rawValue ?? "").trim();
  if (!raw) return "";

  const unquoted = raw.replace(/^['\"]+|['\"]+$/g, "").trim();
  if (!unquoted) return "";

  if (!/^https?:\/\//i.test(unquoted)) {
    return "";
  }

  try {
    const url = new URL(unquoted);
    return url.origin;
  } catch {
    return "";
  }
}

const API_URL = normalizeApiUrl(import.meta.env.VITE_API_URL);
const TRADEAID_API_FALLBACK = "https://api.tradeaid.ink";

function resolveApiBaseUrl(): string {
  if (typeof window !== "undefined") {
    const hostname = String(window.location.hostname || "").toLowerCase();
    const isTradeAidDomain = hostname === "tradeaid.ink"
      || hostname === "www.tradeaid.ink"
      || hostname === "app.tradeaid.ink"
      || hostname.endsWith(".tradeaid.ink");
    if (API_URL) {
      if (isTradeAidDomain && API_URL.includes(".railway.app")) {
        return TRADEAID_API_FALLBACK;
      }
      return API_URL;
    }
    if (isTradeAidDomain) {
      return TRADEAID_API_FALLBACK;
    }
    return window.location.origin;
  }

  if (API_URL) {
    return API_URL;
  }

  return "";
}
const ACCESS_TOKEN_KEY = "trade_aid_token";
const REFRESH_TOKEN_KEY = "trade_aid_refresh_token";
let runtimeAccessToken: string | null = null;
let runtimeRefreshToken: string | null = null;

let refreshInFlight: Promise<string | null> | null = null;
const API_TIMEOUT_MS = 20000;

function getToken(): string | null {
  if (runtimeAccessToken) {
    return runtimeAccessToken;
  }
  const persisted = localStorage.getItem(ACCESS_TOKEN_KEY);
  if (persisted) {
    runtimeAccessToken = persisted;
  }
  return persisted;
}

function getRefreshToken(): string | null {
  if (runtimeRefreshToken) {
    return runtimeRefreshToken;
  }
  const persisted = localStorage.getItem(REFRESH_TOKEN_KEY);
  if (persisted) {
    runtimeRefreshToken = persisted;
  }
  return persisted;
}

export function setToken(token: string) {
  runtimeAccessToken = token;
  localStorage.setItem(ACCESS_TOKEN_KEY, token);
}

export function setAuthTokens(accessToken: string, refreshToken?: string | null) {
  setToken(accessToken);
  if (refreshToken) {
    runtimeRefreshToken = refreshToken;
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  }
}

export function clearToken() {
  runtimeAccessToken = null;
  runtimeRefreshToken = null;
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export function hasRefreshToken(): boolean {
  return Boolean(getRefreshToken());
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    return null;
  }

  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      let response: Response;
      try {
        const apiBase = resolveApiBaseUrl();
        const refreshUrl = apiBase ? `${apiBase}/api/auth/refresh` : "/api/auth/refresh";
        response = await fetch(refreshUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
      } catch {
        return null;
      }

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      const nextAccessToken = typeof data?.access_token === "string" ? data.access_token : null;
      const nextRefreshToken = typeof data?.refresh_token === "string" ? data.refresh_token : null;

      if (!nextAccessToken) {
        return null;
      }

      setAuthTokens(nextAccessToken, nextRefreshToken);
      return nextAccessToken;
    })().finally(() => {
      refreshInFlight = null;
    });
  }

  return refreshInFlight;
}

export async function ensureAuthSession(): Promise<boolean> {
  const token = getToken();
  if (token) return true;
  if (!getRefreshToken()) return false;
  const refreshed = await refreshAccessToken();
  return Boolean(refreshed);
}

export async function apiFetch<T = any>(
  path: string,
  options: (RequestInit & { timeoutMs?: number }) = {},
  shouldRetry: boolean = true,
): Promise<T> {
  const token = getToken();
  const requestTimeoutMs = Math.max(1_000, Number(options.timeoutMs || API_TIMEOUT_MS));
  const { timeoutMs: _timeoutMs, ...requestOptions } = options;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(requestOptions.headers as Record<string, string> || {}),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let res: Response;
  const timeoutController = new AbortController();
  const timeoutId = window.setTimeout(() => timeoutController.abort(), requestTimeoutMs);
  const mergedSignal = requestOptions.signal ?? timeoutController.signal;
  try {
    const apiBase = resolveApiBaseUrl();
    const target = apiBase ? `${apiBase}${path}` : path;
    res = await fetch(target, {
      ...requestOptions,
      headers,
      signal: mergedSignal,
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      throw new Error("Request timed out. Please try again.");
    }
    throw new Error("Network error. Please try again.");
  } finally {
    window.clearTimeout(timeoutId);
  }

  if (res.status === 401 && shouldRetry && path !== "/api/auth/refresh") {
    const refreshedToken = await refreshAccessToken();
    if (refreshedToken) {
      return apiFetch<T>(path, options, false);
    }
  }

  if (!res.ok) {
    let message = res.statusText || "Request failed";
    try {
      const data = await res.json();
      if (typeof data?.detail === "string" && data.detail.trim()) {
        message = data.detail;
      } else if (typeof data?.message === "string" && data.message.trim()) {
        message = data.message;
      }
    } catch {
      const text = await res.text();
      if (text?.trim()) {
        message = text;
      }
    }

    throw new Error(message);
  }

  return res.json();
}

export async function apiGet<T = any>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: "GET" });
}

export async function apiPost<T = any>(path: string, data?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: "POST",
    body: data ? JSON.stringify(data) : undefined,
  });
}

export async function apiPatch<T = any>(path: string, data?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: "PATCH",
    body: data ? JSON.stringify(data) : undefined,
  });
}

// AI Scoring API functions
export interface TokenScore {
  contract_address: string;
  chain: string;
  symbol: string;
  name: string;
  eligible: boolean;
  eligibility_reason?: string | null;
  risk_flags: string[];
  status: string;
  scores: {
    rug_probability: number;
    liquidity_stability: number;
    holder_distribution: number;
    smart_wallet_signal: number;
    trade_confidence_index: number;
    rug_risk_score: number;
    opportunity_score: number;
  };
  market_data: {
    market_cap_usd: number;
    liquidity_usd: number;
    holder_count: number;
  };
  scored_at: string;
}

export interface TokenInsight {
  status: string;
  token: {
    contract_address: string;
    symbol: string;
    chain: string;
  };
  score: TokenScore['scores'];
  insight: {
    summary: string;
    key_points: string[];
  };
}

export const scoringApi = {
  // Score a token using AI
  scoreToken: async (contractAddress: string, chain: string = 'solana'): Promise<TokenScore> => {
    return apiPost<TokenScore>('/api/scoring/score-token', {
      contract_address: contractAddress,
      chain,
    });
  },

  // Get AI insight for a token
  getInsight: async (chain: string, contractAddress: string): Promise<TokenInsight> => {
    return apiGet<TokenInsight>(`/api/scoring/insight/${chain}/${contractAddress}`);
  },
};

export const tokensApi = {
  // Get token list with scores
  getTokens: async (params?: {
    chain?: string;
    offset?: number;
    limit?: number;
    age?: string;
  }): Promise<{ tokens: any[]; total: number }> => {
    const query = new URLSearchParams();
    if (params?.chain) query.append('chain', params.chain);
    if (params?.offset) query.append('offset', String(params.offset));
    if (params?.limit) query.append('limit', String(params.limit));
    if (params?.age) query.append('age', params.age);
    
    return apiGet(`/api/tokens?${query.toString()}`);
  },

  // Get project info
  getProjectInfo: async (chain: string, contractAddress: string) => {
    return apiGet(`/api/tokens/project-info/${chain}/${contractAddress}`);
  },
};
