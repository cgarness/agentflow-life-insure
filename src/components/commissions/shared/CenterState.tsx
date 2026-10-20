import { AlertCircle, Clock3, Inbox, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatePanel } from "@/components/commission/ui/CommissionSurface";
import { CommissionCenterError } from "@/lib/commission/centerApi";

/** A failed read: no access, agency time zone not set, or a load error with Retry. Never a $0 fallback. */
export function CenterError({ error, onRetry, compact }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  const kind = error instanceof CommissionCenterError ? error.kind : "unknown";
  const message = error instanceof Error ? error.message : "Commissions couldn't load. Try again.";
  const icon = kind === "denied" ? Lock : kind === "time_zone" ? Clock3 : AlertCircle;
  const retry = kind !== "denied" && kind !== "time_zone" && onRetry;
  return (
    <StatePanel icon={icon} role="alert" tone={kind === "unknown" ? "destructive" : "muted"} compact={compact}
      title={kind === "time_zone" ? "Agency time zone needed" : kind === "denied" ? "No access" : "Couldn't load"} body={message}
      action={retry ? <Button variant="outline" size="sm" onClick={onRetry}>Try again</Button> : undefined} />
  );
}

export function CenterEmpty({ title }: { title: string }) {
  return <StatePanel icon={Inbox} compact dashed title={title} />;
}
