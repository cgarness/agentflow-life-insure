import { z } from "zod";
import type { CommissionEstimateRecord, CommissionInstallment, CommissionReceipt, InstallmentKind, TimingChoice } from "./trackingSchemas";

/**
 * Display helpers for saved policy commissions (Phase 2A). Expected amounts are estimates; received amounts are
 * what someone recorded by hand. Remaining is per installment and never negative; anything above the expected
 * amount is shown as excess on that installment only (an advance overpayment never counts toward Months 10–12).
 * Calendar dates only: no time-zone shifts, and no "due" or "overdue" states. Expected dates are estimates.
 */
export const INSTALLMENT_LABELS: Record<InstallmentKind, string> = {
  advance: "Advance",
  month_10: "Month 10",
  month_11: "Month 11",
  month_12: "Month 12",
};

export const activeReceipts = (installment: CommissionInstallment): CommissionReceipt[] =>
  installment.receipts.filter((receipt) => receipt.voided_at === null);

export function receivedCents(installment: CommissionInstallment): number {
  return activeReceipts(installment).reduce((sum, receipt) => sum + receipt.amount_cents, 0);
}

export function remainingCents(installment: CommissionInstallment): number {
  return Math.max(installment.expected_cents - receivedCents(installment), 0);
}

export function excessCents(installment: CommissionInstallment): number {
  return Math.max(receivedCents(installment) - installment.expected_cents, 0);
}

export interface EstimateTotals {
  expected: number;
  received: number;
  /** Sum of per-installment remaining amounts (an excess on one never reduces another). */
  remaining: number;
  excess: number;
}

export function estimateTotals(estimate: CommissionEstimateRecord): EstimateTotals {
  return estimate.installments.reduce<EstimateTotals>(
    (totals, installment) => ({
      expected: totals.expected + installment.expected_cents,
      received: totals.received + receivedCents(installment),
      remaining: totals.remaining + remainingCents(installment),
      excess: totals.excess + excessCents(installment),
    }),
    { expected: 0, received: 0, remaining: 0, excess: 0 },
  );
}

/** "$1,234.56" from whole cents. */
export function formatCents(cents: number): string {
  const negative = cents < 0;
  const value = Math.abs(Math.trunc(cents));
  const dollars = Math.floor(value / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}$${dollars}.${String(value % 100).padStart(2, "0")}`;
}

/** Strict dollars-and-cents entry ("150", "$1,250.50") to whole cents; null for anything else or out of range. */
export function parseDollarsToCents(raw: string): number | null {
  const text = raw.trim().replace(/^\$/, "").replace(/,(?=\d{3}(\D|$))/g, "");
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
  return cents > 0 && cents <= 100_000_000 ? cents : null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The manual receipt form; issues are reported in field order, so the first one is the message to show. */
export const receiptFormSchema = (today: string) => z.object({
  amount: z.string().transform(parseDollarsToCents)
    .refine((cents): cents is number => cents !== null, "Enter an amount above $0.00 (up to $1,000,000.00)."),
  receivedOn: z.string().regex(ISO_DATE, "Enter the date the payment was received.")
    .refine((date) => !ISO_DATE.test(date) || date <= today, "The received date can't be in the future.")
    .refine((date) => !ISO_DATE.test(date) || date >= "2000-01-01", "Enter a received date from 2000 onward."),
  reference: z.string().transform((text) => text.trim())
    .refine((text) => text.length <= 200, "Keep the reference to 200 characters."),
});

/** Validates the manual receipt fields; returns an error message or the parsed values. */
export function validateReceipt(input: { amount: string; receivedOn: string; reference: string }, today: string):
  { error: string } | { amountCents: number; receivedOn: string; reference: string | null } {
  const parsed = receiptFormSchema(today).safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  return { amountCents: parsed.data.amount as number, receivedOn: parsed.data.receivedOn, reference: parsed.data.reference || null };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function parts(iso: string): { y: number; m: number; d: number } | null {
  const match = ISO.exec(iso);
  return match ? { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) } : null;
}

/** "Oct 2026" */
export function formatMonth(iso: string): string {
  const p = parts(iso);
  return p ? `${MONTHS[p.m - 1]} ${p.y}` : iso;
}

/** "Oct 20, 2026" */
export function formatCalendarDate(iso: string): string {
  const p = parts(iso);
  return p ? `${MONTHS[p.m - 1]} ${p.d}, ${p.y}` : iso;
}

/** "Oct 5 – 7, 2026", "Nov 27 – Dec 1, 2026", "Dec 31, 2026 – Jan 5, 2027" */
export function formatDateRange(from: string, until: string): string {
  const a = parts(from);
  const b = parts(until);
  if (!a || !b || from === until) return formatCalendarDate(from);
  if (a.y !== b.y) return `${formatCalendarDate(from)} – ${formatCalendarDate(until)}`;
  if (a.m !== b.m) return `${MONTHS[a.m - 1]} ${a.d} – ${MONTHS[b.m - 1]} ${b.d}, ${b.y}`;
  return `${MONTHS[a.m - 1]} ${a.d} – ${b.d}, ${b.y}`;
}

export function timingLabel(installment: Pick<CommissionInstallment, "timing_precision" | "expected_on" | "expected_until">): string {
  if (installment.timing_precision === "unknown" || !installment.expected_on) return "Date needed";
  if (installment.timing_precision === "month") return `Expected ${formatMonth(installment.expected_on)}`;
  if (installment.expected_until) return `Expected ${formatDateRange(installment.expected_on, installment.expected_until)}`;
  return `Expected ${formatCalendarDate(installment.expected_on)}`;
}

const NON_MONTHLY: Record<string, string> = { quarterly: "Quarterly", semi_annual: "Semi-annual", annual: "Annual" };

/** The start line: where the expected dates come from, and the non-monthly exception. */
export function scheduleSummary(estimate: Pick<CommissionEstimateRecord, "schedule_start_on" | "schedule_start_source" |
  "schedule_assumed" | "schedule_frequency">): { text: string; exception: string | null } {
  const start = estimate.schedule_start_on;
  if (!start) return { text: "Date needed", exception: null };
  const text = estimate.schedule_start_source === "manual" ? `From first premium date ${formatCalendarDate(start)}`
    : `${estimate.schedule_assumed ? "Estimated from" : "From"} effective date ${formatCalendarDate(start)}`;
  const cadence = estimate.schedule_frequency ? NON_MONTHLY[estimate.schedule_frequency] : undefined;
  return { text, exception: cadence ? `${cadence} premiums: Months 10–12 need dates.` : null };
}

/** Edit dates: the policy's effective date, a first premium date a person enters, or none ("Date needed"). */
export type StartChoice = "effective_date" | "manual" | "none";
const inRange = (date: string) => date >= "2000-01-01" && date <= "2100-12-31";
const startDateFormSchema = z.discriminatedUnion("choice", [
  z.object({ choice: z.literal("effective_date"), effectiveDate: z.string().regex(ISO_DATE, "This policy has no effective date.") }),
  z.object({ choice: z.literal("manual"), startOn: z.string().regex(ISO_DATE, "Enter the first premium date.")
    .refine(inRange, "Enter a date between 2000 and 2100.") }),
  z.object({ choice: z.literal("none") }),
]);

export function parseStartDateForm(input: { choice: StartChoice; startOn: string; effectiveDate: string | null }):
  { error: string } | { startOn: string | null; source: "effective_date" | "manual" | null } {
  const parsed = startDateFormSchema.safeParse({ ...input, effectiveDate: input.effectiveDate ?? "" });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (parsed.data.choice === "effective_date") return { startOn: parsed.data.effectiveDate, source: "effective_date" };
  if (parsed.data.choice === "manual") return { startOn: parsed.data.startOn, source: "manual" };
  return { startOn: null, source: null };
}

const paymentDateFormSchema = z.discriminatedUnion("choice", [
  z.object({ choice: z.literal("automatic") }),
  z.object({ choice: z.literal("unknown") }),
  z.object({ choice: z.literal("month"), month: z.string().regex(/^\d{4}-\d{2}$/, "Choose the expected month.")
    .refine((month) => inRange(`${month}-01`), "Choose a date between 2000 and 2100.") }),
  z.object({ choice: z.literal("date"), date: z.string().regex(ISO_DATE, "Choose the expected date.")
    .refine(inRange, "Choose a date between 2000 and 2100.") }),
]);

/** One payment's date: automatic (the estimated schedule), an exact date, a month, or "Date needed". */
export function parsePaymentDateForm(input: { choice: TimingChoice; month: string; date: string }):
  { error: string } | { precision: TimingChoice; expectedOn: string | null } {
  const parsed = paymentDateFormSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (parsed.data.choice === "month") return { precision: "month", expectedOn: `${parsed.data.month}-01` };
  if (parsed.data.choice === "date") return { precision: "date", expectedOn: parsed.data.date };
  return { precision: parsed.data.choice, expectedOn: null };
}

/** Explanations for a capture that needs attention (server codes), in plain language. */
const ATTENTION_MESSAGES: Record<string, string> = {
  agent_changed: "The policy's seller changed after the estimate was shown.",
  grid_unavailable: "Your agency's comp grid isn't available right now.",
  grid_changed: "Your agency's comp grid changed after the estimate was shown.",
  product_unavailable: "That product is no longer active on the comp grid.",
  policy_mismatch: "The policy type or carrier no longer matches the product.",
  not_available: "The comp grid has no rate for this age, term or contract level.",
  variant_changed: "The age or term now matches a different grid row.",
  level_changed: "The agent's contract level changed or isn't on the grid.",
  rate_changed: "The comp grid rate changed after the estimate was shown.",
  premium_mismatch: "The saved monthly premium differs from the one estimated.",
  amount_changed: "The recalculated amount differs from the one shown.",
  budget_exhausted: "The save was busy, so this estimate hasn't been checked yet.",
  calculation_failed: "This estimate couldn't be checked when the sale was saved.",
  policy_unavailable: "This policy's sale record isn't available.",
};

export function attentionMessage(code: string | null): string {
  return (code && ATTENTION_MESSAGES[code]) || "This estimate needs a check before it can be recorded.";
}
