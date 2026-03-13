import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiGet, apiPatch } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

export const SUPPORTED_CHAINS = ["solana"] as const;
export type AppChain = "solana" | "all";

const CHAIN_LABELS: Record<AppChain, string> = {
  all: "All Chains",
  solana: "Solana",
};

type ChainContextValue = {
  chain: AppChain;
  chainLabel: string;
  setChain: (chain: AppChain) => void;
};

const ChainContext = createContext<ChainContextValue | null>(null);

function normalizeChain(value: string | null | undefined): AppChain {
  const normalized = String(value || "").toLowerCase();
  if ((SUPPORTED_CHAINS as readonly string[]).includes(normalized)) {
    return normalized as AppChain;
  }
  return "solana";
}

export function ChainProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const [chain, setChainState] = useState<AppChain>("solana");

  const setChain = (next: AppChain) => {
    const normalized = normalizeChain(next);
    setChainState(normalized);

    if (!isAuthenticated) {
      return;
    }

    void apiPatch<{ ok: boolean; settings: { selected_chain: AppChain } }>("/api/user/settings", {
      selected_chain: normalized,
    }).catch(() => undefined);
  };

  useEffect(() => {
    if (isLoading || !isAuthenticated) {
      return;
    }

    let active = true;
    void apiGet<{ ok: boolean; settings?: { selected_chain?: string } }>("/api/user/settings")
      .then((response) => {
        if (!active) return;
        const serverChain = normalizeChain(String(response?.settings?.selected_chain || "solana"));
        setChainState(serverChain);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [isAuthenticated, isLoading]);

  const value = useMemo<ChainContextValue>(() => {
    return {
      chain,
      chainLabel: CHAIN_LABELS[chain],
      setChain,
    };
  }, [chain]);

  return <ChainContext.Provider value={value}>{children}</ChainContext.Provider>;
}

export function useChain() {
  const context = useContext(ChainContext);
  if (!context) {
    throw new Error("useChain must be used within ChainProvider");
  }
  return context;
}
