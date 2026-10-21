import { z } from "zod";
import { formatDateRange, formatMonth, parseDollarsToCents } from "./installments";
import type { CarrierGroup, ComparisonWindow } from "./centerSchemas";

/**
 * Commissions Overview insights: presentation math only. Every figure comes from the server (saved cents, receipts by
 * received date, the server-resolved comparison windows); nothing here recalculates commission.
 */

/** The month's first day when [from, to] is exactly one whole calendar month, else null (no goal for that period). */
export function singleMonth(from: string, to: string): string | null {
  const [y, m, d] = from.split("-").map(Number);
  if (d !== 1 || !y || !m) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return to === `${from.slice(0, 8)}${String(last).padStart(2, "0")}` ? from : null;
}

export type CarrierMetric = "policies" | "estimate" | "received";
export const carrierValue = (g: CarrierGroup, metric: CarrierMetric) =>
  metric === "policies" ? g.policies : metric === "estimate" ? g.estimate_cents : g.received_cents;

export interface CarrierBars {
  /** Named carriers by value (largest first, then name); Unknown is never among them. */
  shown: CarrierGroup[];
  /** The named carriers beyond the top ones, summed (never a drill-down). */
  other: { count: number; value: number } | null;
  /** Policies or receipts with no known carrier: always its own bar when present, never folded into Other. */
  unknown: CarrierGroup | null;
}

/** Top carriers plus Other; "View all" passes `all` to list every named carrier. */
export function carrierBars(groups: CarrierGroup[], metric: CarrierMetric, all: boolean, top = 5): CarrierBars {
  const named = groups.filter((g) => g.carrier !== null)
    .sort((a, b) => carrierValue(b, metric) - carrierValue(a, metric) || (a.carrier ?? "").localeCompare(b.carrier ?? ""));
  const unknown = groups.find((g) => g.carrier === null) ?? null;
  const cut = all || named.length <= top + 1 ? named.length : top;
  const rest = named.slice(cut);
  return {
    shown: named.slice(0, cut),
    other: rest.length > 0 ? { count: rest.length, value: rest.reduce((sum, g) => sum + carrierValue(g, metric), 0) } : null,
    unknown,
  };
}

/** A comparison of two server values: the difference always; a percentage only when the earlier value is above zero. */
export function change(current: number, previous: number): { delta: number; percent: number | null } {
  return { delta: current - previous, percent: previous > 0 ? Math.round(((current - previous) / previous) * 100) : null };
}

/** "vs Sep 2026", or both windows when the current one differs from the selected range ("Oct 1 – 21 vs Sep 1 – 21"). */
export function comparisonLabel(selected: Pick<ComparisonWindow, "from" | "to">, current: ComparisonWindow, previous: ComparisonWindow): string {
  const range = (w: Pick<ComparisonWindow, "from" | "to">) => (singleMonth(w.from, w.to) ? formatMonth(w.from) : formatDateRange(w.from, w.to));
  const before = `vs ${range(previous)}`;
  return current.from === selected.from && current.to === selected.to ? before : `${range(current)} ${before}`;
}

/** Goal progress: the figure may pass 100 % (floored, so it never shows 100 % early); the bar is capped at 100 %. */
export function goalProgress(receivedCents: number, targetCents: number): { percent: number; bar: number } {
  const percent = Math.floor((receivedCents * 100) / targetCents);
  return { percent, bar: Math.min(percent, 100) };
}

export const goalFormSchema = z.object({
  amount: z.string().transform(parseDollarsToCents)
    .refine((cents): cents is number => cents !== null, "Enter a goal above $0.00 (up to $1,000,000.00)."),
});
