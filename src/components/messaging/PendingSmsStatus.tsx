import { cn } from "@/lib/utils";
import type { PendingSmsView } from "@/lib/sms-send/smsDisplayMerge";

function pendingSmsLabel(view: PendingSmsView): string | null {
  switch (view.state) {
    case "sending":
      return view.slow ? "Still sending…" : "Sending…";
    case "not_sent":
      return "Not sent";
    case "uncertain":
      return "Not confirmed";
    case "accepted_review":
      return "Accepted · history not saved";
    default:
      return view.reconcile === "unavailable" || view.reconcile === "mismatch" ? "Accepted · history pending" : null;
  }
}

interface PendingSmsStatusProps {
  view: PendingSmsView;
  /** The composer for this contact is on SMS and empty, so Edit cannot overwrite a draft. */
  canEdit?: boolean;
  onEdit?: (localId: string) => void;
  onDismiss?: (localId: string) => void;
  className?: string;
}

/**
 * The compact status line under a pending outbound SMS. The live region stays mounted while the
 * state changes so "Not sent" / "Not confirmed" are announced. Uncertain sends get no resend or
 * restore action; only proven non-sending offers Edit.
 */
export function PendingSmsStatus({ view, canEdit = false, onEdit, onDismiss, className }: PendingSmsStatusProps) {
  const label = pendingSmsLabel(view);
  const reason = view.state === "not_sent" || view.state === "uncertain" ? view.message : null;
  const dismissable = !!label && view.state !== "sending" && !!onDismiss;
  return (
    <div
      role="status"
      data-testid="pending-sms-status"
      data-state={view.state}
      className={cn(
        "text-[10px] mt-1 px-1 flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5 max-w-full",
        view.state === "not_sent" ? "text-destructive" : view.state === "uncertain" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
        !label && "sr-only",
        className,
      )}
    >
      {label && <span className="font-medium">{label}</span>}
      {reason && (
        <span className="text-muted-foreground truncate max-w-[16rem]" title={reason}>
          {reason}
        </span>
      )}
      {view.state === "not_sent" && canEdit && onEdit && (
        <button type="button" onClick={() => onEdit(view.localId)} className="underline text-primary">
          Edit
        </button>
      )}
      {dismissable && (
        <button type="button" onClick={() => onDismiss?.(view.localId)} className="underline text-muted-foreground">
          Dismiss
        </button>
      )}
    </div>
  );
}
