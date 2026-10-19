import type { CommissionEstimateRecord, CommissionInstallment, CommissionReceipt, InstallmentKind } from "./trackingSchemas";

/**
 * Display helpers for saved policy commissions (Phase 2A). Expected amounts are estimates; received amounts are
 * what someone recorded by hand. Remaining is per installment and never negative; anything above the expected
 * amount is shown as excess on that installment only (an advance overpayment never counts toward Months 10–12).
 * Calendar dates only: no time-zone shifts, and no "due" or "overdue" states.
 */
export const INSTALLMENT_LABELS: Record<InstallmentKind, string> = {
  advance: "Advance (75%)",
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

/** Validates the manual receipt fields; returns an error message or the parsed values. */
export function validateReceipt(input: { amount: string; receivedOn: string; reference: string }, today: string):
  { error: string } | { amountCents: number; receivedOn: string; reference: string | null } {
  const amountCents = parseDollarsToCents(input.amount);
  if (amountCents === null) return { error: "Enter an amount above $0.00 (up to $1,000,000.00)." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.receivedOn)) return { error: "Enter the date the payment was received." };
  if (input.receivedOn > today) return { error: "The received date can't be in the future." };
  if (input.receivedOn < "2000-01-01") return { error: "Enter a received date from 2000 onward." };
  const reference = input.reference.trim();
  if (reference.length > 200) return { error: "Keep the reference to 200 characters." };
  return { amountCents, receivedOn: input.receivedOn, reference: reference || null };
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

/** The first of the month `offset` calendar months after the month of `iso` (the day is ignored). */
export function addCalendarMonths(iso: string, offset: number): string | null {
  const p = parts(iso);
  if (!p) return null;
  const index = p.y * 12 + (p.m - 1) + offset;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;
}

/** Month 10/11/12 from a confirmed schedule start: start month + 9/10/11 months (as the server computes). */
export function scheduledMonths(startOn: string): Record<Exclude<InstallmentKind, "advance">, string | null> {
  return { month_10: addCalendarMonths(startOn, 9), month_11: addCalendarMonths(startOn, 10), month_12: addCalendarMonths(startOn, 11) };
}

export function timingLabel(installment: Pick<CommissionInstallment, "timing_precision" | "expected_on">): string {
  if (installment.timing_precision === "unknown" || !installment.expected_on) return "Payment timing unconfirmed";
  if (installment.timing_precision === "month") return `Expected ${formatMonth(installment.expected_on)}`;
  return `Expected ${formatCalendarDate(installment.expected_on)}`;
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
