import { useEffect, useMemo, useState } from "react";

export type ScannerStreamEvent = {
  type?: string;
  channel?: string;
  contract?: string;
  chain?: string;
  [key: string]: unknown;
};

type ViteMeta = ImportMeta & {
  env?: Record<string, string | undefined>;
};

function toWsUrl(apiBase: string) {
  if (!apiBase) return null;
  const withProtocol = apiBase.startsWith("http") ? apiBase : `https://${apiBase}`;
  const wsBase = withProtocol.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
  return `${wsBase}/ws/alerts`;
}

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

export function useScannerStream(onEvent: (event: ScannerStreamEvent) => void) {
  const [connected, setConnected] = useState(false);
  const configuredApiBase = normalizeApiUrl((import.meta as ViteMeta).env?.VITE_API_URL);
  const apiBase = useMemo(() => {
    if (typeof window === "undefined") {
      return configuredApiBase;
    }
    const hostname = String(window.location.hostname || "").toLowerCase();
    const isTradeAidDomain = hostname === "tradeaid.ink"
      || hostname === "www.tradeaid.ink"
      || hostname === "app.tradeaid.ink"
      || hostname.endsWith(".tradeaid.ink");
    if (isTradeAidDomain) {
      return "https://tradeaid-4e908.up.railway.app";
    }
    return configuredApiBase;
  }, [configuredApiBase]);
  const wsUrl = useMemo(() => toWsUrl(apiBase), [apiBase]);

  useEffect(() => {
    if (!wsUrl) return;

    let isMounted = true;
    const socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      if (isMounted) setConnected(true);
    };

    socket.onclose = () => {
      if (isMounted) setConnected(false);
    };

    socket.onerror = () => {
      if (isMounted) setConnected(false);
    };

    socket.onmessage = (message) => {
      try {
        const data = JSON.parse(message.data) as ScannerStreamEvent;
        onEvent(data);
      } catch {
        // ignore malformed message
      }
    };

    return () => {
      isMounted = false;
      socket.close();
    };
  }, [wsUrl, onEvent]);

  return { connected };
}
