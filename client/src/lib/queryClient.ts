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
const API_DOMAIN_OVERRIDE = "https://api.tradeaid.ink";

function resolveApiBaseUrl(): string {
  if (typeof window !== "undefined") {
    const hostname = String(window.location.hostname || "").toLowerCase();
    if (hostname === "tradeaid.ink" || hostname === "www.tradeaid.ink") {
      return API_DOMAIN_OVERRIDE;
    }
    if (!API_URL) {
      return window.location.origin;
    }
  }

  return API_URL;
}

function getToken(): string | null {
  return localStorage.getItem("trade_aid_token");
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
  const res = await fetch(fullUrl, {
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

    const res = await fetch(fullUrl, { headers });

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
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      refetchOnMount: "always",
      staleTime: 0,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
