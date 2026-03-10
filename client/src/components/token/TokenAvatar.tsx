import { useMemo, type ReactNode } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

type TokenAvatarProps = {
  logoUrl?: string | null;
  symbol?: string | null;
  name?: string | null;
  className?: string;
  fallbackClassName?: string;
  fallback?: ReactNode;
};

function initialsFromToken(symbol?: string | null, name?: string | null) {
  const source = String(symbol || name || "TK").trim();
  if (!source) return "TK";
  return source.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase() || "TK";
}

export function TokenAvatar({
  logoUrl,
  symbol,
  name,
  className,
  fallbackClassName,
  fallback,
}: TokenAvatarProps) {
  const initials = useMemo(() => initialsFromToken(symbol, name), [symbol, name]);

  return (
    <Avatar className={cn("h-10 w-10 border border-border/50", className)}>
      {logoUrl ? <AvatarImage src={logoUrl} alt={`${symbol || name || "token"} logo`} className="object-cover" /> : null}
      <AvatarFallback className={cn("bg-gradient-to-br from-primary/20 to-accent/20 text-xs font-semibold text-foreground", fallbackClassName)}>
        {fallback || initials}
      </AvatarFallback>
    </Avatar>
  );
}
