import { cn } from "@/lib/utils";

type TradeAidLogoProps = {
  className?: string;
  withText?: boolean;
};

export function TradeAidLogo({ className, withText = true }: TradeAidLogoProps) {
  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
      <img
        src="/tradeaid-logo.svg?v=3"
        alt="Trade Aid logo"
        className="h-8 w-8 shrink-0 rounded-md"
        loading="eager"
      />

      {withText && (
        <span className="text-xl font-bold font-sans tracking-tight">
          <span className="text-primary">Trade</span> Aid
        </span>
      )}
    </div>
  );
}
