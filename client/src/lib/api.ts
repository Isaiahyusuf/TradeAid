const API_URL = import.meta.env.VITE_API_URL || "";
const ACCESS_TOKEN_KEY = "trade_aid_token";
const REFRESH_TOKEN_KEY = "trade_aid_refresh_token";

let refreshInFlight: Promise<string | null> | null = null;

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
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
    });
  } catch {
    throw new Error("Network error. Please try again.");
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
