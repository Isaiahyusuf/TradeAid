import { QueryClient, QueryFunction } from "@tanstack/react-query";

function normalizeApiUrl(rawValue: unknown): string {
  const raw = String(rawValue ?? "").trim();
  if (!raw) return "";

  const unquoted = raw.replace(/^['\"]+|['\"]+$/g, "").trim();
  if (!unquoted) return "";

  if (!/^https?:\/\//i.test(unquoted)) {
    return "";
  }

  try {
    return new URL(unquoted).origin;
  } catch {
    return "";
  }
}

const API_URL = normalizeApiUrl(import.meta.env.VITE_API_URL);

function resolveApiBaseUrl(): string {
  if (typeof window !== "undefined") {
    const hostname = String(window.location.hostname || "").toLowerCase();
    const isTradeAidDomain = hostname === "tradeaid.ink"
      || hostname === "www.tradeaid.ink"
      || hostname === "app.tradeaid.ink"
      || hostname.endsWith(".tradeaid.ink");
    if (isTradeAidDomain) {
      return window.location.origin;
    }
    if (API_URL) {
      return API_URL;
    }
    return window.location.origin;
  }

  if (API_URL) {
    return API_URL;
  }

  return "";
}

function getToken(): string | null {
  return localStorage.getItem("trade_aid_token");
}

const QUERY_TIMEOUT_MS = 12000;

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit, timeoutMs = QUERY_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...(init || {}),
      signal: init?.signal || controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (data) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const apiBase = resolveApiBaseUrl();
  const fullUrl = url.startsWith("http") ? url : `${apiBase}${url}`;
  const res = await fetchWithTimeout(fullUrl, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const path = queryKey.join("/") as string;
    const apiBase = resolveApiBaseUrl();
    const fullUrl = path.startsWith("http") ? path : `${apiBase}${path}`;
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetchWithTimeout(fullUrl, { headers });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      refetchOnMount: false,
      staleTime: 15_000,
      gcTime: 5 * 60 * 1000,
      retry: 1,
    },
    mutations: {
      retry: false,
    },
  },
});
