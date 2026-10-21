import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTrackingMutation } from "@/hooks/useClientPolicyCommissions";
import { commissionTrackingApi } from "@/lib/commission/trackingApi";
import { INSTALLMENT_LABELS, parsePaymentDateForm } from "@/lib/commission/installments";
import type { CommissionInstallment, TimingChoice } from "@/lib/commission/trackingSchemas";
import { WhenAmountsShown } from "../ui/AmountsVisibility";

const fieldCls =
  "w-full h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";
const labelCls = "mb-1 block text-xs font-medium text-muted-foreground";

type DateForm = { precision: TimingChoice; month: string; date: string };

/** One payment's expected date: automatic (the estimated schedule), an exact date, a month, or "Date needed". */
export function InstallmentTimingDialog({ open, onOpenChange, installment, estimateRevision }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  installment: CommissionInstallment | null;
  estimateRevision: number;
}) {
  const id = useId();
  const mutation = useTrackingMutation<DateForm>(`timing:${installment?.id ?? "none"}`);
  const { restart } = mutation;
  const [precision, setPrecision] = useState<TimingChoice>("automatic");
  const [month, setMonth] = useState("");
  const [date, setDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(estimateRevision);

  useEffect(() => {
    if (!open || !installment) return;
    restart();
    const pending = mutation.pending;
    const manual = installment.timing_source === "manual";
    setPrecision(pending?.precision ?? (manual ? installment.timing_precision : "automatic"));
    setMonth(pending?.month ?? (manual && installment.timing_precision === "month" && installment.expected_on ? installment.expected_on.slice(0, 7) : ""));
    setDate(pending?.date ?? (manual && installment.timing_precision === "date" && installment.expected_on ? installment.expected_on : ""));
    setError(null);
    setRevision(estimateRevision);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, installment?.id, restart]);

  if (!installment) return null;
  const locked = mutation.locked || mutation.saving;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (mutation.unresolved) {
      if (await mutation.retry()) onOpenChange(false);
      return;
    }
    const parsed = parsePaymentDateForm({ choice: precision, month, date });
    if ("error" in parsed) { setError(parsed.error); return; }
    setError(null);
    const result = await mutation.run((requestId) => commissionTrackingApi.setInstallmentTiming({
      requestId, installmentId: installment.id, expectedRevision: revision, precision: parsed.precision, expectedOn: parsed.expectedOn,
    }), { precision, month, date });
    if (result) onOpenChange(false);
  };

  const options: Array<[TimingChoice, string]> = [["automatic", "Automatic"], ["date", "Exact date"], ["month", "Month"], ["unknown", "Date needed"]];
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!mutation.saving) onOpenChange(next); }}>
      <DialogContent className="w-[95vw] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{INSTALLMENT_LABELS[installment.kind]} date</DialogTitle>
          <DialogDescription>Automatic uses the estimated schedule.</DialogDescription>
        </DialogHeader>
        <WhenAmountsShown>
          <form onSubmit={submit} className="space-y-3">
            <fieldset disabled={locked} className="space-y-3">
              <div role="radiogroup" aria-label="Expected date" className="flex flex-wrap gap-3">
                {options.map(([value, label]) => (
                  <label key={value} className="flex items-center gap-1.5 text-sm">
                    <input type="radio" name={`${id}-precision`} checked={precision === value} onChange={() => setPrecision(value)} />
                    {label}
                  </label>
                ))}
              </div>
              {precision === "month" && (
                <div>
                  <label htmlFor={`${id}-month`} className={labelCls}>Month</label>
                  <input id={`${id}-month`} type="month" className={fieldCls} value={month} onChange={(event) => setMonth(event.target.value)} />
                </div>
              )}
              {precision === "date" && (
                <div>
                  <label htmlFor={`${id}-date`} className={labelCls}>Date</label>
                  <input id={`${id}-date`} type="date" className={fieldCls} value={date} onChange={(event) => setDate(event.target.value)} />
                </div>
              )}
            </fieldset>
            {(error || mutation.message) && <p role="alert" className="break-words text-sm text-destructive">{error ?? mutation.message}</p>}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.saving}>Cancel</Button>
              <Button type="submit" disabled={mutation.saving || mutation.syncing}>{mutation.saving ? "Saving…" : mutation.locked ? "Retry" : "Save date"}</Button>
            </DialogFooter>
          </form>
        </WhenAmountsShown>
      </DialogContent>
    </Dialog>
  );
}
