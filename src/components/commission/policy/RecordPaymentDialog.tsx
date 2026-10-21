import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTrackingMutation } from "@/hooks/useClientPolicyCommissions";
import { commissionTrackingApi } from "@/lib/commission/trackingApi";
import { INSTALLMENT_LABELS, remainingCents, validateReceipt } from "@/lib/commission/installments";
import type { CommissionInstallment } from "@/lib/commission/trackingSchemas";
import { todayLocalIsoDate } from "@/lib/policyPaymentFields";
import { WhenAmountsShown } from "../ui/AmountsVisibility";
import { useAmounts } from "../ui/amountsContext";

const fieldCls =
  "w-full h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";
const labelCls = "mb-1 block text-xs font-medium text-muted-foreground";

type PaymentForm = { installmentId: string; amount: string; receivedOn: string; reference: string };

/** The selected installment's remaining amount, or nothing when it is fully received. */
function suggestedAmount(installments: CommissionInstallment[], installmentId: string): string {
  const installment = installments.find((candidate) => candidate.id === installmentId);
  const remaining = installment ? remainingCents(installment) : 0;
  return remaining > 0 ? (remaining / 100).toFixed(2) : "";
}

/**
 * Records one MANUAL receipt against an expected payment. Partial and excess amounts are allowed; nothing here is
 * a carrier statement or reconciliation. A payment whose outcome is unknown stays locked, even after the dialog is
 * closed and reopened, until a retry of exactly that payment (same request id) resolves it.
 */
export function RecordPaymentDialog({ open, onOpenChange, installments, initialInstallmentId }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  installments: CommissionInstallment[];
  initialInstallmentId: string;
}) {
  const id = useId();
  const { money } = useAmounts();
  // One key per estimate (its installments share it), so reopening from any installment finds an unresolved payment.
  const mutation = useTrackingMutation<PaymentForm>(`receipt:${installments[0]?.id ?? "none"}`);
  const { restart } = mutation;
  const [installmentId, setInstallmentId] = useState(initialInstallmentId);
  const [amount, setAmount] = useState("");
  const [amountEdited, setAmountEdited] = useState(false);
  const [receivedOn, setReceivedOn] = useState(todayLocalIsoDate());
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    restart();
    const pending = mutation.pending;
    setInstallmentId(pending?.installmentId ?? initialInstallmentId);
    setAmount(pending?.amount ?? suggestedAmount(installments, initialInstallmentId));
    setAmountEdited(!!pending);
    setReceivedOn(pending?.receivedOn ?? todayLocalIsoDate());
    setReference(pending?.reference ?? "");
    setError(null);
    setNote(null);
    // Reset only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialInstallmentId, restart]);

  const chooseInstallment = (next: string) => {
    setInstallmentId(next);
    if (amountEdited) {
      // An amount typed for another payment is never carried over silently.
      setAmount("");
      setAmountEdited(false);
      setNote("Amount cleared because you changed the expected payment. Enter the amount for this payment.");
    } else {
      setAmount(suggestedAmount(installments, next));
      setNote(null);
    }
  };

  const locked = mutation.locked || mutation.saving;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (mutation.unresolved) {
      if (await mutation.retry()) onOpenChange(false);
      return;
    }
    const checked = validateReceipt({ amount, receivedOn, reference }, todayLocalIsoDate());
    if ("error" in checked) { setError(checked.error); return; }
    setError(null);
    const result = await mutation.run((requestId) => commissionTrackingApi.recordReceipt({ requestId, installmentId, ...checked }),
      { installmentId, amount, receivedOn, reference });
    if (result) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!mutation.saving) onOpenChange(next); }}>
      <DialogContent className="w-[95vw] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record payment received</DialogTitle>
          <DialogDescription>Enter a commission payment you received.</DialogDescription>
        </DialogHeader>
        {/* Never a blind payment: while amounts are hidden the form stays mounted (values and recovery kept) but closed. */}
        <WhenAmountsShown>
          <form onSubmit={submit} className="space-y-3">
            <fieldset disabled={locked} className="space-y-3">
              <div>
                <label htmlFor={`${id}-installment`} className={labelCls}>Expected payment</label>
                <select id={`${id}-installment`} className={fieldCls} value={installmentId} onChange={(event) => chooseInstallment(event.target.value)}>
                  {installments.map((installment) => (
                    <option key={installment.id} value={installment.id}>
                      {INSTALLMENT_LABELS[installment.kind]} · {money(installment.expected_cents)} expected
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor={`${id}-amount`} className={labelCls}>Amount received</label>
                  <input id={`${id}-amount`} className={fieldCls} inputMode="decimal" value={amount} placeholder="0.00"
                    onChange={(event) => { setAmount(event.target.value); setAmountEdited(true); setNote(null); }} />
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
            {note && <p role="status" className="text-xs text-muted-foreground">{note}</p>}
            {(error || mutation.message) && <p role="alert" className="break-words text-sm text-destructive">{error ?? mutation.message}</p>}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.saving}>Cancel</Button>
              <Button type="submit" disabled={mutation.saving || mutation.syncing}>
                {mutation.saving ? "Saving…" : mutation.syncing ? "Checking payments…" : mutation.locked ? "Retry" : "Record payment"}
              </Button>
            </DialogFooter>
          </form>
        </WhenAmountsShown>
      </DialogContent>
    </Dialog>
  );
}
