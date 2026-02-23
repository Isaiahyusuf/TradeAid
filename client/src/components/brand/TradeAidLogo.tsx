import { cn } from "@/lib/utils";

type TradeAidLogoProps = {
  className?: string;
  withText?: boolean;
};

export function TradeAidLogo({ className, withText = true }: TradeAidLogoProps) {
  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
      <svg
        viewBox="0 0 64 64"
        role="img"
        aria-label="Trade Aid logo"
        className="h-8 w-8 shrink-0"
      >
        <defs>
          <linearGradient id="ta-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#22c55e" />
            <stop offset="58%" stopColor="#14b8a6" />
            <stop offset="100%" stopColor="#9945FF" />
          </linearGradient>
        </defs>
        <rect x="4" y="4" width="56" height="56" rx="16" fill="#0b1110" stroke="url(#ta-gradient)" strokeWidth="3" />
        <path d="M16 40L26 30L34 36L48 20" fill="none" stroke="url(#ta-gradient)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="16" cy="40" r="2.5" fill="#22c55e" />
        <circle cx="26" cy="30" r="2.5" fill="#14b8a6" />
        <circle cx="34" cy="36" r="2.5" fill="#22c55e" />
        <circle cx="48" cy="20" r="2.5" fill="#9945FF" />
      </svg>

      {withText && (
        <span className="text-xl font-bold font-sans tracking-tight">
          <span className="text-primary">Trade</span> Aid
        </span>
      )}
    </div>
  );
}
