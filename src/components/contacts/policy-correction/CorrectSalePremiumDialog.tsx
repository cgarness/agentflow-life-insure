import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePremiumCorrectionSubmission } from "@/hooks/usePremiumCorrectionSubmission";
import {
  CORRECTION_REASONS, premiumCorrectionFormSchema, prepareCorrection, sameAmount,
  type BookMode, type CorrectionResult, type PremiumCorrectionForm, type SalePremiumPolicy,
} from "@/lib/policySaleCorrection";

const fieldCls = "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";
const labelCls = "mb-1 block text-xs font-medium text-muted-foreground";
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const monthly = (value: number | null) => (value === null ? "Unknown" : `${money.format(value)}/mo`);

/**
 * Admin-only correction of one sale's premium (D2 §5, §6.1). Restates the sale's AP on its original seller and Sold
 * Date; never records a new sale. "Update the policy record to match" is offered only when the record still matches
 * the sale (or already holds the corrected amount).
 */
export function CorrectSalePremiumDialog({ open, onOpenChange, clientId, sale, currentMonthly, onSaved }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  sale: SalePremiumPolicy;
  currentMonthly: number | null;
  onSaved?: (result: CorrectionResult) => void;
}) {
  const id = useId();
  const submission = usePremiumCorrectionSubmission(clientId, onSaved);
  const { reset } = submission;
  const requestId = useRef<string>(crypto.randomUUID());
  const initial = (): PremiumCorrectionForm => ({
    amount: "", unknown: false, reason: "entry_error", note: "",
    bookMode: sale.book?.present && sale.book.matches_sale ? "match_sale" : "keep_current",
  });
  const [form, setForm] = useState<PremiumCorrectionForm>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    reset();
    requestId.current = crypto.randomUUID();
    setForm(initial());
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reset]);
  useEffect(() => {
    if (submission.phase === "saved") onOpenChange(false);
  }, [submission.phase, onOpenChange]);

  const legacy = sale.effective.source === "legacy_record_fallback";
  const locked = submission.phase === "sending" || submission.phase === "frozen";
  const update = (patch: Partial<PremiumCorrectionForm>) => setForm((current) => ({ ...current, ...patch }));
  const recordMatches = !!sale.book?.present && (sale.book.matches_sale
    || (!form.unknown && form.amount.trim() !== "" && sameAmount(sale.book.monthly, Number(form.amount.replace(/[$,]/g, "")))));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submission.phase === "frozen") { await submission.retry(); return; }
    const parsed = premiumCorrectionFormSchema(sale).safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])));
      return;
    }
    setErrors({});
    await submission.submit(prepareCorrection(sale, form, requestId.current));
  };

  const facts: [string, string][] = [
    ["Seller", sale.seller_name ?? "Unassigned"],
    ["Sold date", sale.sold_date ?? "—"],
    ["Sale premium", monthly(sale.effective.monthly)],
    ["Current premium", monthly(currentMonthly)],
  ];
  if (sale.book) facts.push(["Policy record", sale.book.present ? monthly(sale.book.monthly) : "None"]);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!locked || !next) onOpenChange(next); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Correct sale premium</DialogTitle>
          <DialogDescription>Fix an amount entered incorrectly when this policy was sold.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3" noValidate>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-md bg-muted/40 p-2.5 text-xs">
            {facts.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-[10px] text-muted-foreground">{label}</dt>
                <dd className="break-words text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
          <div>
            <label htmlFor={`${id}-amount`} className={labelCls}>Corrected monthly premium</label>
            <input id={`${id}-amount`} inputMode="decimal" className={fieldCls} value={form.amount} disabled={locked || form.unknown}
              aria-invalid={!!errors.amount} onChange={(e) => update({ amount: e.target.value })} />
            <label className="mt-1.5 flex items-center gap-2 text-xs text-foreground">
              <input type="checkbox" checked={form.unknown} disabled={locked} onChange={(e) => update({ unknown: e.target.checked })} />
              Premium unknown
            </label>
            {errors.amount && <p role="alert" className="mt-1 text-xs text-destructive">{errors.amount}</p>}
          </div>
          <div>
            <label htmlFor={`${id}-reason`} className={labelCls}>Reason</label>
            <select id={`${id}-reason`} className={fieldCls} value={form.reason} disabled={locked}
              onChange={(e) => update({ reason: e.target.value as PremiumCorrectionForm["reason"] })}>
              {CORRECTION_REASONS.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-note`} className={labelCls}>Note</label>
            <textarea id={`${id}-note`} rows={2} maxLength={500} className={fieldCls} value={form.note} disabled={locked}
              aria-invalid={!!errors.note} onChange={(e) => update({ note: e.target.value })} />
            {errors.note && <p role="alert" className="mt-1 text-xs text-destructive">{errors.note}</p>}
          </div>
          <fieldset className="space-y-1 text-xs" disabled={locked}>
            <legend className={labelCls}>Policy record</legend>
            {([["match_sale", "Update the policy record to match"], ["keep_current", "Keep the current policy record"]] as [BookMode, string][])
              .map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 text-foreground">
                  <input type="radio" name={`${id}-book`} value={value} checked={form.bookMode === value}
                    disabled={value === "match_sale" && !recordMatches} onChange={() => update({ bookMode: value })} />
                  {label}
                </label>
              ))}
            {sale.book?.present && !recordMatches && <p className="text-muted-foreground">The policy record was changed after the sale.</p>}
            {errors.bookMode && <p role="alert" className="text-destructive">{errors.bookMode}</p>}
          </fieldset>
          <p className="text-xs text-muted-foreground">Changes this sale's AP for its seller and Sold Date. No new sale is recorded.</p>
          {legacy && (
            <p className="text-xs text-muted-foreground">
              This older sale uses its current policy premium. Saving the same amount stops it following the policy record.
            </p>
          )}
          {submission.message && <p role="alert" className="text-xs text-destructive">{submission.message}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={locked} onClick={() => onOpenChange(false)}>Cancel</Button>
            {submission.phase === "stale" || submission.phase === "conflict"
              ? <Button type="button" onClick={() => onOpenChange(false)}>Close and reload</Button>
              : <Button type="submit" disabled={submission.phase === "sending"}>
                  {submission.phase === "frozen" ? "Retry" : submission.phase === "sending" ? "Saving…" : "Save correction"}
                </Button>}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
