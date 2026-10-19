import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTrackingMutation } from "@/hooks/useClientPolicyCommissions";
import { commissionTrackingApi } from "@/lib/commission/trackingApi";
import type { CommissionEstimateRecord } from "@/lib/commission/trackingSchemas";

const fieldCls =
  "w-full h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";
const labelCls = "mb-1 block text-xs font-medium text-muted-foreground";

/** Places or releases an audited hold on the whole estimate. Payments can still be recorded while on hold. */
export function CommissionHoldDialog({ open, onOpenChange, estimate }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  estimate: CommissionEstimateRecord;
}) {
  const id = useId();
  const mutation = useTrackingMutation();
  const { restart } = mutation;
  const onHold = estimate.status === "on_hold";
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(estimate.state_revision);

  useEffect(() => {
    if (!open) return;
    restart();
    setReason("");
    setError(null);
    setRevision(estimate.state_revision);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, restart]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = reason.trim();
    if (!onHold && (trimmed.length < 3 || trimmed.length > 200)) { setError("Give a reason of 3 to 200 characters."); return; }
    setError(null);
    const result = await mutation.run((requestId) => commissionTrackingApi.setHold({
      requestId, estimateId: estimate.id, expectedRevision: revision, onHold: !onHold, reason: onHold ? null : trimmed,
    }));
    if (result) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!mutation.saving) onOpenChange(next); }}>
      <DialogContent className="w-[95vw] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{onHold ? "Release hold" : "Place on hold"}</DialogTitle>
          <DialogDescription>
            {onHold ? `On hold: ${estimate.status_reason ?? ""}` : "Flags this estimate (for example during a carrier review). The change is audited."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          {!onHold && (
            <fieldset disabled={mutation.locked || mutation.saving}>
              <label htmlFor={`${id}-reason`} className={labelCls}>Reason</label>
              <input id={`${id}-reason`} className={fieldCls} maxLength={200} value={reason} onChange={(event) => setReason(event.target.value)} />
            </fieldset>
          )}
          {(error || mutation.message) && <p role="alert" className="break-words text-sm text-destructive">{error ?? mutation.message}</p>}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.saving}>Cancel</Button>
            <Button type="submit" disabled={mutation.saving}>
              {mutation.saving ? "Saving…" : mutation.locked ? "Retry" : onHold ? "Release hold" : "Place on hold"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
