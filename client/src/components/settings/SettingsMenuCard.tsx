import { ReactNode } from "react";
import { Settings2 } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type SettingsMenuCardProps = {
  title: string;
  description: string;
  open: boolean;
  onToggle: () => void;
  children?: ReactNode;
};

export function SettingsMenuCard({ title, description, open, onToggle, children }: SettingsMenuCardProps) {
  return (
    <Card className="bg-card/70 backdrop-blur-sm border-border/60 max-h-[calc(100vh-6.5rem)] overflow-hidden flex flex-col">
      <div className="flex items-center justify-between gap-3 sticky top-0 z-10 bg-card/90 backdrop-blur px-4 py-3 border-b border-border/50 shrink-0">
        <div>
          <p className="text-sm font-semibold flex items-center gap-2">
            <Settings2 className="w-4 h-4" />
            {title}
          </p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Button variant="outline" onClick={onToggle}>
          {open ? "Close" : "Open"}
        </Button>
      </div>
      {open ? (
        <div className="flex-1 overflow-y-auto overflow-x-hidden scroll-smooth px-4 py-3 pr-3">{children}</div>
      ) : null}
    </Card>
  );
}
