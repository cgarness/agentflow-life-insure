import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTrackingMutation } from "@/hooks/useClientPolicyCommissions";
import { commissionTrackingApi } from "@/lib/commission/trackingApi";
import { INSTALLMENT_LABELS } from "@/lib/commission/installments";
import type { CommissionInstallment, TimingPrecision } from "@/lib/commission/trackingSchemas";

const fieldCls =
  "w-full h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";
const labelCls = "mb-1 block text-xs font-medium text-muted-foreground";

type TimingForm = { precision: TimingPrecision; month: string; date: string };

/** Expected timing for one payment: unconfirmed, a month, or an exact date. Set by hand; survives basis changes. */
export function InstallmentTimingDialog({ open, onOpenChange, installment, estimateRevision }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  installment: CommissionInstallment | null;
  estimateRevision: number;
}) {
  const id = useId();
  const mutation = useTrackingMutation<TimingForm>(`timing:${installment?.id ?? "none"}`);
  const { restart } = mutation;
  const [precision, setPrecision] = useState<TimingPrecision>("unknown");
  const [month, setMonth] = useState("");
  const [date, setDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(estimateRevision);

  useEffect(() => {
    if (!open || !installment) return;
    restart();
    const pending = mutation.pending;
    setPrecision(pending?.precision ?? installment.timing_precision);
    setMonth(pending?.month ?? (installment.timing_precision === "month" && installment.expected_on ? installment.expected_on.slice(0, 7) : ""));
    setDate(pending?.date ?? (installment.timing_precision === "date" && installment.expected_on ? installment.expected_on : ""));
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
    let expectedOn: string | null = null;
    if (precision === "month") {
      if (!/^\d{4}-\d{2}$/.test(month)) { setError("Choose the expected month."); return; }
      expectedOn = `${month}-01`;
    } else if (precision === "date") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setError("Choose the expected date."); return; }
      expectedOn = date;
    }
    if (expectedOn && (expectedOn < "2000-01-01" || expectedOn > "2100-12-31")) { setError("Choose a date between 2000 and 2100."); return; }
    setError(null);
    const result = await mutation.run((requestId) => commissionTrackingApi.setInstallmentTiming({
      requestId, installmentId: installment.id, expectedRevision: revision, precision, expectedOn,
    }), { precision, month, date });
    if (result) onOpenChange(false);
  };

  const options: Array<[TimingPrecision, string]> = [["unknown", "Unconfirmed"], ["month", "Expected month"], ["date", "Exact date"]];
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!mutation.saving) onOpenChange(next); }}>
      <DialogContent className="w-[95vw] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{INSTALLMENT_LABELS[installment.kind]} timing</DialogTitle>
          <DialogDescription>When you expect this payment. It's a planning note only, never a due date.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <fieldset disabled={locked} className="space-y-3">
            <div role="radiogroup" aria-label="Timing" className="flex flex-wrap gap-3">
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
            <Button type="submit" disabled={mutation.saving || mutation.syncing}>{mutation.saving ? "Saving…" : mutation.locked ? "Retry" : "Save timing"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
