import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "whitespace-nowrap inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-primary/30 bg-primary/10 text-primary/90",
        secondary: 
          "border-secondary/30 bg-secondary/10 text-secondary/90",
        destructive:
          "border-destructive/30 bg-destructive/10 text-destructive/90",
        success:
          "border-green-500/30 bg-green-500/10 text-green-400",
        warning:
          "border-amber-500/30 bg-amber-500/10 text-amber-300",
        outline: 
          "border-white/20 bg-white/5 text-foreground",
        muted:
          "border-muted/30 bg-muted/20 text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants }
