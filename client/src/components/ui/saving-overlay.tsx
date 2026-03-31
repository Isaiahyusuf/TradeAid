import { Loader2 } from "lucide-react";

type SavingOverlayProps = {
  visible: boolean;
  title?: string;
  message?: string;
};

export function SavingOverlay({ visible, title = "Please wait", message = "Saving your changes..." }: SavingOverlayProps) {
  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/45 backdrop-blur-[1px] flex items-center justify-center px-4">
      <div className="rounded-xl border border-border/60 bg-card shadow-xl p-5 w-full max-w-sm">
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
          <div>
            <p className="text-sm font-semibold">{title}</p>
            <p className="text-xs text-muted-foreground">{message}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
