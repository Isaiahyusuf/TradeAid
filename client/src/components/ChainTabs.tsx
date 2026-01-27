import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SiSolana, SiEthereum } from "react-icons/si";
import { cn } from "@/lib/utils";

export type Chain = "solana" | "ethereum" | "bsc" | "base";

interface ChainInfo {
  id: Chain;
  name: string;
  shortName: string;
  icon: React.ReactNode;
  launchpad: string;
  color: string;
  bgColor: string;
}

export const CHAINS: ChainInfo[] = [
  {
    id: "solana",
    name: "Solana",
    shortName: "SOL",
    icon: <SiSolana className="w-4 h-4" />,
    launchpad: "Pump.fun",
    color: "text-[#9945FF]",
    bgColor: "bg-[#9945FF]/10",
  },
  {
    id: "ethereum",
    name: "Ethereum",
    shortName: "ETH",
    icon: <SiEthereum className="w-4 h-4" />,
    launchpad: "Uniswap",
    color: "text-[#627EEA]",
    bgColor: "bg-[#627EEA]/10",
  },
  {
    id: "bsc",
    name: "BNB Chain",
    shortName: "BSC",
    icon: (
      <div className="w-4 h-4 rounded-full bg-[#F3BA2F] flex items-center justify-center">
        <span className="text-[8px] font-bold text-black">B</span>
      </div>
    ),
    launchpad: "PancakeSwap",
    color: "text-[#F3BA2F]",
    bgColor: "bg-[#F3BA2F]/10",
  },
  {
    id: "base",
    name: "Base",
    shortName: "BASE",
    icon: (
      <div className="w-4 h-4 rounded-full bg-[#0052FF] flex items-center justify-center">
        <span className="text-[8px] font-bold text-white">B</span>
      </div>
    ),
    launchpad: "Aerodrome",
    color: "text-[#0052FF]",
    bgColor: "bg-[#0052FF]/10",
  },
];

interface ChainTabsProps {
  value: Chain;
  onChange: (chain: Chain) => void;
  className?: string;
}

export function ChainTabs({ value, onChange, className }: ChainTabsProps) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as Chain)} className={className}>
      <TabsList className="grid grid-cols-4 h-auto p-1 bg-muted/50">
        {CHAINS.map((chain) => (
          <TabsTrigger
            key={chain.id}
            value={chain.id}
            className={cn(
              "flex flex-col gap-1 py-3 px-2 data-[state=active]:shadow-lg transition-all",
              value === chain.id && chain.bgColor
            )}
            data-testid={`tab-chain-${chain.id}`}
          >
            <div className="flex items-center gap-1.5">
              <span className={chain.color}>{chain.icon}</span>
              <span className="font-medium text-xs sm:text-sm">{chain.shortName}</span>
            </div>
            <span className="text-[10px] text-muted-foreground hidden sm:block">
              {chain.launchpad}
            </span>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

export function ChainBadge({ chain }: { chain: Chain }) {
  const info = CHAINS.find((c) => c.id === chain);
  if (!info) return null;

  return (
    <div className={cn("flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium", info.bgColor, info.color)}>
      {info.icon}
      <span>{info.shortName}</span>
    </div>
  );
}
