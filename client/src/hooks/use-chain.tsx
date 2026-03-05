import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

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

const STORAGE_KEY = "tradeaid:selected-chain";

function normalizeChain(value: string | null | undefined): AppChain {
  const normalized = String(value || "").toLowerCase();
  if ((SUPPORTED_CHAINS as readonly string[]).includes(normalized)) {
    return normalized as AppChain;
  }
  return "solana";
}

export function ChainProvider({ children }: { children: ReactNode }) {
  const [chain, setChain] = useState<AppChain>(() => normalizeChain(localStorage.getItem(STORAGE_KEY)));

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, chain);
  }, [chain]);

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
