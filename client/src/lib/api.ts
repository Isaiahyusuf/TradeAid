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
const ACCESS_TOKEN_KEY = "trade_aid_token";
const REFRESH_TOKEN_KEY = "trade_aid_refresh_token";

let refreshInFlight: Promise<string | null> | null = null;
const API_TIMEOUT_MS = 20000;

function getToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(ACCESS_TOKEN_KEY, token);
}

export function setAuthTokens(accessToken: string, refreshToken?: string | null) {
  setToken(accessToken);
  if (refreshToken) {
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  }
}

export function clearToken() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    clearToken();
    return null;
  }

  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      let response: Response;
      try {
        response = await fetch(`${API_URL}/api/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
      } catch {
        clearToken();
        return null;
      }

      if (!response.ok) {
        clearToken();
        return null;
      }

      const data = await response.json();
      const nextAccessToken = typeof data?.access_token === "string" ? data.access_token : null;
      const nextRefreshToken = typeof data?.refresh_token === "string" ? data.refresh_token : null;

      if (!nextAccessToken) {
        clearToken();
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

export async function apiFetch<T = any>(
  path: string,
  options: RequestInit = {},
  shouldRetry: boolean = true,
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let res: Response;
  const timeoutController = new AbortController();
  const timeoutId = window.setTimeout(() => timeoutController.abort(), API_TIMEOUT_MS);
  const mergedSignal = options.signal ?? timeoutController.signal;
  try {
    const target = API_URL ? `${API_URL}${path}` : path;
    res = await fetch(target, {
      ...options,
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

  if ((res.status === 401 || res.status === 403) && shouldRetry && path !== "/api/auth/refresh") {
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

    if (res.status === 401 || res.status === 403) {
      clearToken();
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
