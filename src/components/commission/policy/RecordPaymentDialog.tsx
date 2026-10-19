import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTrackingMutation } from "@/hooks/useClientPolicyCommissions";
import { commissionTrackingApi } from "@/lib/commission/trackingApi";
import { formatCents, INSTALLMENT_LABELS, remainingCents, validateReceipt } from "@/lib/commission/installments";
import type { CommissionInstallment } from "@/lib/commission/trackingSchemas";
import { todayLocalIsoDate } from "@/lib/policyPaymentFields";

const fieldCls =
  "w-full h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";
const labelCls = "mb-1 block text-xs font-medium text-muted-foreground";

/**
 * Records one MANUAL receipt against an expected payment. Partial and excess amounts are allowed; nothing here is
 * a carrier statement or reconciliation.
 */
export function RecordPaymentDialog({ open, onOpenChange, installments, initialInstallmentId }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  installments: CommissionInstallment[];
  initialInstallmentId: string;
}) {
  const id = useId();
  const mutation = useTrackingMutation();
  const { restart } = mutation;
  const [installmentId, setInstallmentId] = useState(initialInstallmentId);
  const [amount, setAmount] = useState("");
  const [receivedOn, setReceivedOn] = useState(todayLocalIsoDate());
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    restart();
    setInstallmentId(initialInstallmentId);
    const installment = installments.find((candidate) => candidate.id === initialInstallmentId);
    const remaining = installment ? remainingCents(installment) : 0;
    setAmount(remaining > 0 ? (remaining / 100).toFixed(2) : "");
    setReceivedOn(todayLocalIsoDate());
    setReference("");
    setError(null);
    // Reset only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialInstallmentId, restart]);

  const locked = mutation.locked || mutation.saving;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const checked = validateReceipt({ amount, receivedOn, reference }, todayLocalIsoDate());
    if ("error" in checked) { setError(checked.error); return; }
    setError(null);
    const result = await mutation.run((requestId) => commissionTrackingApi.recordReceipt({ requestId, installmentId, ...checked }));
    if (result) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!mutation.saving) onOpenChange(next); }}>
      <DialogContent className="w-[95vw] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record payment received</DialogTitle>
          <DialogDescription>Enter a commission payment you received. This is a manual record, not a carrier statement.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <fieldset disabled={locked} className="space-y-3">
            <div>
              <label htmlFor={`${id}-installment`} className={labelCls}>Expected payment</label>
              <select id={`${id}-installment`} className={fieldCls} value={installmentId} onChange={(event) => setInstallmentId(event.target.value)}>
                {installments.map((installment) => (
                  <option key={installment.id} value={installment.id}>
                    {INSTALLMENT_LABELS[installment.kind]} · {formatCents(installment.expected_cents)} expected
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={`${id}-amount`} className={labelCls}>Amount received</label>
                <input id={`${id}-amount`} className={fieldCls} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" />
              </div>
              <div>
                <label htmlFor={`${id}-date`} className={labelCls}>Date received</label>
                <input id={`${id}-date`} type="date" className={fieldCls} value={receivedOn} max={todayLocalIsoDate()} onChange={(event) => setReceivedOn(event.target.value)} />
              </div>
            </div>
            <div>
              <label htmlFor={`${id}-reference`} className={labelCls}>Reference (optional)</label>
              <input id={`${id}-reference`} className={fieldCls} maxLength={200} value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Statement or deposit note" />
            </div>
          </fieldset>
          {(error || mutation.message) && <p role="alert" className="break-words text-sm text-destructive">{error ?? mutation.message}</p>}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.saving}>Cancel</Button>
            <Button type="submit" disabled={mutation.saving}>{mutation.saving ? "Saving…" : mutation.locked ? "Retry" : "Record payment"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
