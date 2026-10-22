import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PolicyCommissionEstimate } from "@/components/commission/preview/PolicyCommissionEstimate";
import { useTrackingMutation } from "@/hooks/useClientPolicyCommissions";
import type { CommissionSlotInputs } from "@/lib/commission/capture";
import { activeReceipts, attentionMessage } from "@/lib/commission/installments";
import { commissionTrackingApi } from "@/lib/commission/trackingApi";
import type { OpenPolicyCommission } from "@/lib/commission/trackingSchemas";
import { WhenAmountsShown } from "../ui/AmountsVisibility";
import { useAmounts } from "../ui/amountsContext";

const fieldCls =
  "w-full h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";
const labelCls = "mb-1 block text-xs font-medium text-muted-foreground";

/**
 * Records an estimate for a policy whose sale did not capture one ("Recorded later · current rates"), or replaces
 * the current estimate (needs a reason; recorded payments must be voided first). The server re-checks the inputs
 * against the agency's current grid and the sale's seller and premium; it never records a different figure.
 */
export function RecordEstimateDialog({ open, onOpenChange, policy, replace }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policy: OpenPolicyCommission;
  replace: boolean;
}) {
  const id = useId();
  const { money } = useAmounts();
  // One estimate operation per policy (record or replace), so an unresolved one is found from either dialog.
  const mutation = useTrackingMutation<{ inputs: CommissionSlotInputs; reason: string }>(`estimate:${policy.policy_id}`);
  const { restart } = mutation;
  const capture = useRef<CommissionSlotInputs | null>(null);
  const [hasCapture, setHasCapture] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState<number | null>(policy.estimate?.state_revision ?? null);
  const estimate = replace ? policy.estimate : null;
  const blockedByReceipts = !!estimate && estimate.installments.some((installment) => activeReceipts(installment).length > 0);

  useEffect(() => {
    if (!open) return;
    restart();
    setReason(mutation.pending?.reason ?? "");
    setError(null);
    setRevision(policy.estimate?.state_revision ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, restart]);

  const premium = policy.basis.monthly_premium;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (mutation.unresolved) {
      const retried = await mutation.retry<Awaited<ReturnType<typeof commissionTrackingApi.recordEstimateLater>>>();
      if (retried?.status === "changed") { setError(attentionMessage(retried.code)); restart(); }
      else if (retried) onOpenChange(false);
      return;
    }
    const inputs = capture.current;
    if (!inputs) { setError("Complete the estimate first."); return; }
    const trimmed = reason.trim();
    if (estimate && (trimmed.length < 3 || trimmed.length > 200)) { setError("Give a reason of 3 to 200 characters."); return; }
    setError(null);
    const result = await mutation.run((requestId) => commissionTrackingApi.recordEstimateLater({
      requestId, policyId: policy.policy_id, inputs, replaceEstimateId: estimate?.id ?? null,
      expectedRevision: estimate ? revision : null, reason: estimate ? trimmed : null,
    }), { inputs, reason });
    if (!result) return;
    if (result.status === "changed") { setError(attentionMessage(result.code)); restart(); return; }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!mutation.saving) onOpenChange(next); }}>
      <DialogContent className="w-[95vw] max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{estimate ? "Replace commission estimate" : "Record commission estimate"}</DialogTitle>
          <DialogDescription>
            An estimate, not a payment.
          </DialogDescription>
        </DialogHeader>
        {blockedByReceipts ? (
          <p role="status" className="text-sm text-muted-foreground">Void the payments recorded on this estimate before replacing it.</p>
        ) : !premium ? (
          <p role="status" className="text-sm text-muted-foreground">This policy has no recorded monthly premium to estimate from.</p>
        ) : (
          <WhenAmountsShown>
            <form onSubmit={submit} className="space-y-3">
              <fieldset disabled={mutation.locked || mutation.saving} className="space-y-3">
                {policy.basis.premium_source === "policy_record" && (
                  <p className="text-xs text-muted-foreground">This older sale saved no premium of its own, so the policy's current monthly premium is used.</p>
                )}
                {mutation.unresolved && mutation.pending ? (
                  <p role="status" className="text-sm text-muted-foreground">
                    Submitted estimate: <span className="tabular-nums text-foreground">{money(mutation.pending.inputs.first_year_cents)}</span> first-year,{" "}
                    <span className="tabular-nums text-foreground">{money(mutation.pending.inputs.advance_cents)}</span> advance.
                  </p>
                ) : (
                  <PolicyCommissionEstimate
                    owner={{ kind: "agent", id: policy.credited_agent_id }}
                    policyType={policy.basis.policy_type ?? ""}
                    carrier={policy.basis.carrier ?? ""}
                    monthlyPremium={premium}
                    onCaptureChange={(inputs) => { capture.current = inputs; setHasCapture(!!inputs); }}
                  />
                )}
                {estimate && (
                  <div>
                    <label htmlFor={`${id}-reason`} className={labelCls}>Reason for replacing</label>
                    <input id={`${id}-reason`} className={fieldCls} maxLength={200} value={reason} onChange={(event) => setReason(event.target.value)} />
                  </div>
                )}
              </fieldset>
              {(error || mutation.message) && <p role="alert" className="break-words text-sm text-destructive">{error ?? mutation.message}</p>}
              <DialogFooter className="gap-2 sm:gap-0">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.saving}>Cancel</Button>
                <Button type="submit" disabled={mutation.saving || mutation.syncing || (!hasCapture && !mutation.unresolved)}>
                  {mutation.saving ? "Saving…" : mutation.locked ? "Retry" : estimate ? "Replace estimate" : "Record estimate"}
                </Button>
              </DialogFooter>
            </form>
          </WhenAmountsShown>
        )}
      </DialogContent>
    </Dialog>
  );
}
