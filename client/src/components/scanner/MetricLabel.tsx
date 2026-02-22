import { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";

type MetricLabelProps = {
  label: string;
  tooltip: ReactNode;
  className?: string;
};

export function MetricLabel({ label, tooltip, className }: MetricLabelProps) {
  return (
    <span className={className || "text-muted-foreground inline-flex items-center gap-1"}>
      <span>{label}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-help text-muted-foreground/70 hover:text-foreground" aria-label={`${label} details`}>
            <Info className="w-3.5 h-3.5" />
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs leading-5">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </span>
  );
}
