import { useEffect, useMemo, useState } from "react";

export type ScannerStreamEvent = {
  type?: string;
  channel?: string;
  contract?: string;
  chain?: string;
  [key: string]: unknown;
};

function toWsUrl(apiBase: string) {
  if (!apiBase) return null;
  const withProtocol = apiBase.startsWith("http") ? apiBase : `https://${apiBase}`;
  const wsBase = withProtocol.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
  return `${wsBase}/ws/alerts`;
}

export function useScannerStream(onEvent: (event: ScannerStreamEvent) => void) {
  const [connected, setConnected] = useState(false);
  const apiBase = import.meta.env.VITE_API_URL || "";
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
