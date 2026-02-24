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
    <Card className="p-4 bg-card/70 backdrop-blur-sm border-border/60">
      <div className="flex items-center justify-between gap-3">
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
      {open ? <div className="mt-4">{children}</div> : null}
    </Card>
  );
}
