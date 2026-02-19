import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SiSolana, SiEthereum } from "react-icons/si";
import { cn } from "@/lib/utils";

export type Chain = "solana";

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
];

interface ChainTabsProps {
  value: Chain;
  onChange: (chain: Chain) => void;
  className?: string;
}

export function ChainTabs({ value, onChange, className }: ChainTabsProps) {
  // Single-chain UI: display Solana badge and keep API compatible
  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
      <ChainBadge chain={value} />
    </div>
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
