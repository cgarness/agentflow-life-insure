import { z } from "zod";

/**
 * Commissions center filters live in the URL (so tabs, card links, chart drill-downs and browser back/forward agree).
 * Every value is parsed with Zod and an unknown value falls back to its default; nothing is trusted as authority (the
 * server resolves the period against the agency date and scopes every read to the signed-in seller).
 */
export const COMMISSIONS_PATH = "/commissions";
export const COMMISSION_TABS = ["overview", "payments", "policies", "calculator"] as const;
export type CommissionTab = (typeof COMMISSION_TABS)[number];
export const TAB_LABELS: Record<CommissionTab, string> = { overview: "Overview", payments: "Payments", policies: "Policies", calculator: "Calculator" };
export const tabPath = (tab: CommissionTab) => (tab === "overview" ? COMMISSIONS_PATH : `${COMMISSIONS_PATH}/${tab}`);
export const PAGE_SIZE = 25;

export const PERIOD_PRESETS = ["this_month", "last_month", "next_month", "this_year", "last_year", "all", "custom"] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];
export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  this_month: "This month", last_month: "Last month", next_month: "Next month", this_year: "This year", last_year: "Last year",
  all: "All time", custom: "Custom range",
};
export interface CommissionPeriod { preset: PeriodPreset; from: string | null; to: string | null }

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => d >= "2000-01-01" && d <= "2100-12-31");
const presetSchema = z.enum(PERIOD_PRESETS);
const dateOrNull = (raw: string | null) => (isoDate.safeParse(raw).success ? raw : null);

/** The Overview has no "All time" (its timeline needs a bounded range); lists do. */
export function parsePeriod(params: URLSearchParams, allowAll: boolean): CommissionPeriod {
  const parsed = presetSchema.safeParse(params.get("period"));
  const preset = parsed.success && (allowAll || parsed.data !== "all") ? parsed.data : "this_month";
  if (preset !== "custom") return { preset, from: null, to: null };
  return { preset, from: dateOrNull(params.get("from")), to: dateOrNull(params.get("to")) };
}

/** A custom range needs both dates in order before anything is requested. */
export const periodReady = (p: CommissionPeriod) => p.preset !== "custom" || (!!p.from && !!p.to && p.from <= p.to);

export const periodArgs = (p: CommissionPeriod) => ({ p_period: p.preset, p_from: p.preset === "custom" ? p.from : null, p_to: p.preset === "custom" ? p.to : null });

export function writePeriod(params: URLSearchParams, p: CommissionPeriod): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete("from");
  next.delete("to");
  if (p.preset === "this_month") next.delete("period");
  else next.set("period", p.preset);
  if (p.preset === "custom") {
    if (p.from) next.set("from", p.from);
    if (p.to) next.set("to", p.to);
  }
  next.delete("page");
  return next;
}

export const SCHEDULED_SCOPES = ["period", "next_90", "any"] as const;
export const SCHEDULED_STATUSES = ["all", "remaining", "upcoming", "check_payment", "received", "date_needed", "on_hold"] as const;
export const PAYMENT_KINDS = ["advance", "month_10", "month_11", "month_12", "later"] as const;
export const SETUP_FILTERS = ["all", "missing", "needs_review", "recorded", "on_hold"] as const;
export type ScheduledScope = (typeof SCHEDULED_SCOPES)[number];
export type ScheduledStatus = (typeof SCHEDULED_STATUSES)[number];
export type PaymentKindFilter = (typeof PAYMENT_KINDS)[number];
export type SetupFilter = (typeof SETUP_FILTERS)[number];

export const SCOPE_LABELS: Record<ScheduledScope, string> = { period: "Selected period", next_90: "Next 90 days", any: "Any date" };
export const STATUS_LABELS: Record<ScheduledStatus, string> = {
  all: "All", remaining: "Remaining", upcoming: "Upcoming", check_payment: "Check payment", received: "Received",
  date_needed: "Date needed", on_hold: "On hold",
};
export const KIND_LABELS: Record<PaymentKindFilter, string> = {
  advance: "Advance", month_10: "Month 10", month_11: "Month 11", month_12: "Month 12", later: "Months 10–12",
};
export const SETUP_LABELS: Record<SetupFilter, string> = {
  all: "All", missing: "Missing commission", needs_review: "Needs review", recorded: "Has estimate", on_hold: "On hold",
};

const page = z.coerce.number().int().min(1).max(100_000).catch(1);
const carrier = (raw: string | null) => (raw && raw.trim() && raw.length <= 120 ? raw : null);

export interface ScheduledFilter { period: CommissionPeriod; scope: ScheduledScope; status: ScheduledStatus; kind: PaymentKindFilter | null;
  carrier: string | null; page: number }
export interface HistoryFilter { period: CommissionPeriod; includeVoided: boolean; page: number }
export interface PoliciesFilter { setup: SetupFilter; carrier: string | null; page: number }

export const parseView = (params: URLSearchParams) => (params.get("view") === "history" ? "history" : "scheduled") as "scheduled" | "history";

export function parseScheduled(params: URLSearchParams): ScheduledFilter {
  return {
    period: parsePeriod(params, true),
    scope: z.enum(SCHEDULED_SCOPES).catch("period").parse(params.get("dates") ?? undefined),
    status: z.enum(SCHEDULED_STATUSES).catch("all").parse(params.get("status") ?? undefined),
    kind: z.enum(PAYMENT_KINDS).nullable().catch(null).parse(params.get("kind")),
    carrier: carrier(params.get("carrier")),
    page: page.parse(params.get("page") ?? undefined),
  };
}

export const parseHistory = (params: URLSearchParams): HistoryFilter => ({
  period: parsePeriod(params, true), includeVoided: params.get("voided") === "1", page: page.parse(params.get("page") ?? undefined),
});

export const parsePolicies = (params: URLSearchParams): PoliciesFilter => ({
  setup: z.enum(SETUP_FILTERS).catch("all").parse(params.get("setup") ?? undefined),
  carrier: carrier(params.get("carrier")),
  page: page.parse(params.get("page") ?? undefined),
});

/** One URL param changed; every filter change returns to the first page. */
export function withParam(params: URLSearchParams, key: string, value: string | null, fallback?: string): URLSearchParams {
  const next = new URLSearchParams(params);
  if (value === null || value === fallback) next.delete(key);
  else next.set(key, value);
  if (key !== "page") next.delete("page");
  return next;
}

function href(path: string, entries: Record<string, string | null | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(entries)) if (value) params.set(key, value);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

const periodEntries = (p: CommissionPeriod) => ({
  period: p.preset === "this_month" ? null : p.preset, from: p.preset === "custom" ? p.from : null, to: p.preset === "custom" ? p.to : null,
});

/** Exactly the list behind a card, chart month or review item. */
export const scheduledHref = (o: { period?: CommissionPeriod; scope?: ScheduledScope; status?: ScheduledStatus; kind?: PaymentKindFilter }) =>
  href(tabPath("payments"), {
    ...(o.period ? periodEntries(o.period) : {}), dates: o.scope && o.scope !== "period" ? o.scope : null,
    status: o.status && o.status !== "all" ? o.status : null, kind: o.kind ?? null,
  });
export const historyHref = (period: CommissionPeriod) => href(tabPath("payments"), { view: "history", ...periodEntries(period) });
export const policiesHref = (setup: SetupFilter) => href(tabPath("policies"), { setup: setup === "all" ? null : setup });
export const customPeriod = (from: string, to: string): CommissionPeriod => ({ preset: "custom", from, to });
