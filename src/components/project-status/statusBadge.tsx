import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  LIVE: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  NEEDS_WORK: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  PLACEHOLDER: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  BROKEN: "bg-destructive/15 text-destructive border-destructive/30",
  DONE: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  "IN PROGRESS": "bg-blue-500/15 text-blue-400 border-blue-500/30",
  OPEN: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  HIGH: "bg-destructive/15 text-destructive border-destructive/30",
  MEDIUM: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  LOW: "bg-muted text-muted-foreground",
  THINK: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  BUILD: "bg-teal-500/15 text-teal-400 border-teal-500/30",
  DEBUG: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  FIXED: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  NOT_STARTED: "bg-muted text-muted-foreground border-border",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const style = STATUS_STYLES[status] ?? "bg-muted text-muted-foreground";
  return (
    <Badge variant="outline" className={cn("text-xs font-medium", style, className)}>
      {status}
    </Badge>
  );
}

export function resolveDisplayStatus(
  inferred: string | undefined,
  overlayStatus: string | null | undefined
): string | undefined {
  return overlayStatus?.trim() || inferred;
}
