import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTrackingMutation } from "@/hooks/useClientPolicyCommissions";
import { commissionTrackingApi } from "@/lib/commission/trackingApi";
import { formatCalendarDate, formatCents, INSTALLMENT_LABELS, validateReceipt } from "@/lib/commission/installments";
import type { CommissionInstallment, CommissionReceipt } from "@/lib/commission/trackingSchemas";
import { todayLocalIsoDate } from "@/lib/policyPaymentFields";

const fieldCls =
  "w-full h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";
const labelCls = "mb-1 block text-xs font-medium text-muted-foreground";

type VoidForm = { reason: string; replace: boolean; installmentId: string; amount: string; receivedOn: string; reference: string };

/**
 * Corrections are voids with a reason, never edits or deletes. A void may carry a replacement receipt, recorded in
 * the same change so the history shows exactly what replaced what.
 */
export function VoidReceiptDialog({ open, onOpenChange, receipt, installments, estimateRevision }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  receipt: CommissionReceipt | null;
  installments: CommissionInstallment[];
  estimateRevision: number;
}) {
  const id = useId();
  const mutation = useTrackingMutation<VoidForm>(`void:${receipt?.id ?? "none"}`);
  const { restart } = mutation;
  const owner = installments.find((installment) => installment.receipts.some((r) => r.id === receipt?.id)) ?? null;
  const [reason, setReason] = useState("");
  const [replace, setReplace] = useState(false);
  const [installmentId, setInstallmentId] = useState("");
  const [amount, setAmount] = useState("");
  const [receivedOn, setReceivedOn] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(estimateRevision);

  useEffect(() => {
    if (!open || !receipt) return;
    restart();
    // An unresolved void shows exactly what was submitted (locked until a retry resolves it).
    const pending = mutation.pending;
    setReason(pending?.reason ?? "");
    setReplace(pending?.replace ?? false);
    setInstallmentId(pending?.installmentId ?? owner?.id ?? "");
    setAmount(pending?.amount ?? (receipt.amount_cents / 100).toFixed(2));
    setReceivedOn(pending?.receivedOn ?? receipt.received_on);
    setReference(pending?.reference ?? receipt.reference ?? "");
    setError(null);
    // The revision the user is looking at when the dialog opens; a newer one elsewhere is a conflict.
    setRevision(estimateRevision);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, receipt?.id, restart]);

  if (!receipt) return null;
  const locked = mutation.locked || mutation.saving;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (mutation.unresolved) {
      if (await mutation.retry()) onOpenChange(false);
      return;
    }
    const trimmed = reason.trim();
    if (trimmed.length < 3 || trimmed.length > 200) { setError("Give a reason of 3 to 200 characters."); return; }
    let replacement: { installmentId: string; amountCents: number; receivedOn: string; reference: string | null } | null = null;
    if (replace) {
      const checked = validateReceipt({ amount, receivedOn, reference }, todayLocalIsoDate());
      if ("error" in checked) { setError(checked.error); return; }
      replacement = { installmentId, ...checked };
    }
    setError(null);
    const result = await mutation.run((requestId) => commissionTrackingApi.voidReceipt({
      requestId, receiptId: receipt.id, expectedRevision: revision, reason: trimmed, replacement,
    }), { reason, replace, installmentId, amount, receivedOn, reference });
    if (result) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!mutation.saving) onOpenChange(next); }}>
      <DialogContent className="w-[95vw] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Void payment</DialogTitle>
          <DialogDescription>
            {formatCents(receipt.amount_cents)} received {formatCalendarDate(receipt.received_on)}. The record stays in the history, marked void.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <fieldset disabled={locked} className="space-y-3">
            <div>
              <label htmlFor={`${id}-reason`} className={labelCls}>Reason</label>
              <input id={`${id}-reason`} className={fieldCls} maxLength={200} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. Entered the wrong amount" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={replace} onChange={(event) => setReplace(event.target.checked)} />
              Record a corrected payment in its place
            </label>
            {replace && (
              <div className="space-y-3 rounded-md border border-border p-3">
                <div>
                  <label htmlFor={`${id}-installment`} className={labelCls}>Expected payment</label>
                  <select id={`${id}-installment`} className={fieldCls} value={installmentId} onChange={(event) => setInstallmentId(event.target.value)}>
                    {installments.map((installment) => (
                      <option key={installment.id} value={installment.id}>{INSTALLMENT_LABELS[installment.kind]}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor={`${id}-amount`} className={labelCls}>Amount received</label>
                    <input id={`${id}-amount`} className={fieldCls} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
                  </div>
                  <div>
                    <label htmlFor={`${id}-date`} className={labelCls}>Date received</label>
                    <input id={`${id}-date`} type="date" className={fieldCls} value={receivedOn} max={todayLocalIsoDate()} onChange={(event) => setReceivedOn(event.target.value)} />
                  </div>
                </div>
                <div>
                  <label htmlFor={`${id}-reference`} className={labelCls}>Reference (optional)</label>
                  <input id={`${id}-reference`} className={fieldCls} maxLength={200} value={reference} onChange={(event) => setReference(event.target.value)} />
                </div>
              </div>
            )}
          </fieldset>
          {(error || mutation.message) && <p role="alert" className="break-words text-sm text-destructive">{error ?? mutation.message}</p>}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.saving}>Cancel</Button>
            <Button type="submit" variant="destructive" disabled={mutation.saving || mutation.syncing}>
              {mutation.saving ? "Saving…" : mutation.locked ? "Retry" : replace ? "Void and replace" : "Void payment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
