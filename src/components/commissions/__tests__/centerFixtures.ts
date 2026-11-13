/** Synthetic commissions center responses for tests (never production data). */
import type { CommissionScopeContextValue } from "../commissionScopeContext";
import { commissionScopeHref, type CommissionAgentScope } from "@/lib/commission/centerScope";
export const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const USER = ID(901);
export const ORG = ID(902);
export const TEAM_AGENT = ID(903);
export const OTHER_AGENT = ID(904);
export const SCOPE_REVISION = "synthetic-scope-v1";

/** Pure presentation context. Full-page tests exercise the actual provider and admission requests. */
export function testScope(scope: CommissionAgentScope, extra: Partial<CommissionScopeContextValue> = {}): CommissionScopeContextValue {
  return { managed: false, scope, revision: SCOPE_REVISION, financialKey: JSON.stringify(scope), ready: true,
    isMe: scope.mode === "me", readOnly: scope.mode !== "me", canViewOwn: true, roster: null,
    loading: false, error: null, invalid: false, apply: () => undefined, retry: () => undefined, deny: () => undefined,
    acceptRevision: () => true, withScopeHref: (path) => commissionScopeHref(path, scope), ...extra };
}

/** Synthetic discovery payload; search/page never defines All membership. */
export function agentRoster(extra: Record<string, unknown> = {}, user = USER) {
  const agents = [
    { agent_id: user, display_name: "Morgan Seller", status: "Active", is_self: true },
    { agent_id: TEAM_AGENT, display_name: "Jordan Agent", status: "Active", is_self: false },
    { agent_id: OTHER_AGENT, display_name: "Casey Archived", status: "Inactive", is_self: false },
  ];
  return { agents, selected_agents: agents, available_count: agents.length, total_count: agents.length,
    can_view_own: true, can_select_others: true, default_scope: "me", scope_revision: SCOPE_REVISION, ...extra };
}

/** Enrich existing financial fixtures with the new envelope; amounts remain the legacy test facts. */
export function scopedResponse<T extends Record<string, unknown>>(value: T, args: Record<string, unknown> = {}, user = USER, allowedIds = [user, TEAM_AGENT, OTHER_AGENT]): T {
  const mode = String(args.p_agent_scope ?? "me");
  const ids = mode === "me" ? [user] : mode === "selected" ? args.p_agent_ids as string[] : allowedIds;
  const seller = ids[0];
  const identity = { credited_agent_id: seller, agent_name: seller === user ? "Morgan Seller" : "Jordan Agent" };
  const result: Record<string, unknown> = { ...value,
    meta: { ...(value.meta as object), agent_scope: { mode, agent_ids: ids, revision: SCOPE_REVISION } } };
  if (Array.isArray(value.rows)) result.rows = value.rows.map((row) => ({ ...row, ...identity }));
  if (value.upcoming) result.upcoming = { ...(value.upcoming as { rows: object[] }),
    rows: (value.upcoming as { rows: object[] }).rows.map((row) => ({ ...row, ...identity })) };
  if (value.policy) result.policy = { ...(value.policy as object), ...identity, access: mode === "me" ? "write" : "read" };
  return result as T;
}
const meta = { today: "2026-10-20", time_zone: "America/Los_Angeles", as_of: "2026-10-20T17:00:00Z" };

export function scheduledRow(n: number, extra: Record<string, unknown> = {}) {
  return {
    installment_id: ID(100 + n), estimate_id: ID(200 + n), policy_id: ID(300 + n), kind: "advance", expected_cents: 42975,
    received_cents: 0, remaining_cents: 42975, excess_cents: 0, receipt_count: 0, timing_precision: "date", expected_on: "2026-11-02",
    expected_until: "2026-11-04", window_end: "2026-11-04", status: "upcoming", estimate_status: "active", carrier: "Synthetic Life",
    product: "Synthetic Term", contact: { client_id: ID(400 + n), name: `Client ${n}` }, ...extra,
  };
}

export function overview(extra: Record<string, unknown> = {}) {
  const months = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04"];
  return {
    meta: { ...meta, period: "this_month", from: "2026-10-01", to: "2026-10-31" },
    summary: { expected_cents: 85671, expected_count: 3, received_cents: 25157, received_count: 2, remaining_cents: 60514, excess_cents: 7025,
      held_expected_cents: 76032, held_count: 1 },
    next_90: { from: "2026-10-20", to: "2027-01-17", remaining_cents: 90133, count: 4 },
    timeline: months.map((month) => ({
      month, from: `${month}-01`, to: month === "2026-10" ? "2026-10-31" : `${month}-28`, in_period: month === "2026-10",
      received_cents: month === "2026-10" ? 25157 : 0, receipt_count: month === "2026-10" ? 2 : 0,
      expected_advance_cents: month === "2026-10" ? 80514 : 0, expected_later_cents: month === "2026-10" ? 5157 : 0,
      installment_count: month === "2026-10" ? 3 : 0,
    })),
    review: { check_payment: { count: 3, remaining_cents: 60065 }, date_needed: { count: 7, remaining_cents: 120000 },
      needs_review: { count: 1 }, missing_estimate: { count: 0 } },
    upcoming: { total_count: 6, rows: [scheduledRow(1), scheduledRow(2, { contact: null, carrier: "Harbor Mutual" })] },
    setup: { eligible_count: 12, with_estimate_count: 10 },
    ...extra,
  };
}

export function scheduledPage(rows = [scheduledRow(1), scheduledRow(2, { contact: null })], extra: Record<string, unknown> = {}) {
  return {
    meta: { ...meta, from: "2026-10-01", to: "2026-10-31" }, total_count: 60,
    totals: { expected_cents: 85671, received_cents: 25157, remaining_cents: 60514, excess_cents: 0 }, held_count: 4,
    carriers: ["Harbor Mutual", "Synthetic Life"], rows, ...extra,
  };
}

export function historyRow(n: number, extra: Record<string, unknown> = {}) {
  return {
    receipt_id: ID(500 + n), received_on: "2026-10-15", recorded_at: "2026-10-15T18:00:00Z", amount_cents: 5157, voided: false,
    void_reason: null, replaces_receipt_id: null, replaced_by_receipt_id: null, policy_id: ID(300 + n), installment_id: ID(100 + n),
    estimate_id: ID(200 + n), kind: "month_10", estimate_status: "active", carrier: "Synthetic Life", product: "Synthetic Term",
    contact: { client_id: ID(400 + n), name: `Client ${n}` }, ...extra,
  };
}

export function historyPage(rows = [historyRow(1)], extra: Record<string, unknown> = {}) {
  return { meta: { ...meta, from: "2026-10-01", to: "2026-10-31" }, total_count: rows.length,
    totals: { received_cents: 5157, valid_count: 1, voided_count: 0 }, carriers: ["Synthetic Life"], has_unknown_carrier: false, rows, ...extra };
}

export function policyRow(n: number, extra: Record<string, unknown> = {}) {
  return {
    policy_id: ID(300 + n), setup: "recorded", contact: { client_id: ID(400 + n), name: `Client ${n}` }, source: "primary",
    carrier: "Synthetic Life", product: "Synthetic Term", effective_date: "2026-11-01", estimate_cents: 57300, received_cents: 20000,
    remaining_cents: 37300, excess_cents: 0, date_needed_count: 0,
    next_payment: { kind: "advance", timing_precision: "date", expected_on: "2026-11-02", expected_until: "2026-11-04", remaining_cents: 22975, status: "upcoming" },
    category: "term", sold_date: "2026-10-05",
    ...extra,
  };
}

export function policiesPage(rows = [policyRow(1)], extra: Record<string, unknown> = {}) {
  return { meta, total_count: rows.length, counts: { eligible_count: 12, with_estimate_count: 10, missing_count: 1, needs_review_count: 1, on_hold_count: 1 },
    totals: { policies: rows.length, with_estimate_count: 1, estimate_cents: 57300, on_hold_count: 0, on_hold_cents: 0, without_estimate_count: 0 },
    carriers: ["Synthetic Life"], has_unknown_carrier: false, rows, ...extra };
}

const group = (policies: number, withEstimate: number, estimate: number, extra: Record<string, unknown> = {}) => ({
  policies, with_estimate_count: withEstimate, estimate_cents: estimate, on_hold_count: 0, on_hold_cents: 0,
  without_estimate_count: policies - withEstimate, ...extra,
});

/** Breakdown for October 2026: synthetic carriers and categories that add up to the cohort and Received totals. */
export function breakdown(extra: Record<string, unknown> = {}) {
  return {
    meta: { ...meta, period: "this_month", from: "2026-10-01", to: "2026-10-31" },
    sold: { ...group(9, 6, 343800, { on_hold_count: 1, on_hold_cents: 57300, without_estimate_count: 2 }), needs_review_count: 1, undated_count: 1 },
    received: { received_cents: 25157, receipt_count: 2 },
    carriers: [
      { carrier: "Harbor Mutual", ...group(3, 2, 114600), received_cents: 5157, receipt_count: 1 },
      { carrier: "Synthetic Life", ...group(5, 4, 229200, { on_hold_count: 1, on_hold_cents: 57300, without_estimate_count: 0 }),
        received_cents: 20000, receipt_count: 1 },
      { carrier: null, ...group(1, 0, 0), received_cents: 0, receipt_count: 0 },
    ],
    products: [
      { category: "term", ...group(5, 4, 229200, { on_hold_count: 1, on_hold_cents: 57300, without_estimate_count: 0 }) },
      { category: "whole_life", ...group(1, 1, 57300) },
      { category: "final_expense", ...group(2, 1, 57300) },
      { category: "unknown", ...group(1, 0, 0) },
    ],
    comparison: {
      basis: "months_to_date",
      current: { from: "2026-10-01", to: "2026-10-20", policies: 9, with_estimate_count: 6, estimate_cents: 343800, received_cents: 25157, receipt_count: 2 },
      previous: { from: "2026-09-01", to: "2026-09-20", policies: 6, with_estimate_count: 6, estimate_cents: 300000, received_cents: 0, receipt_count: 0 },
    },
    months_10_12: { from: "2026-11-01", to: "2026-11-30", remaining_cents: 14325, payment_count: 3, policy_count: 2 },
    ...extra,
  };
}

export function goal(target: number | null = 50000, month = "2026-10-01") {
  return { month, target_cents: target, updated_at: target === null ? null : "2026-10-19T17:00:00Z", meta };
}

const installment = (n: number, kind: string, cents: number, receipts: unknown[] = []) => ({
  id: ID(600 + n), kind, expected_cents: cents, timing_precision: "date", expected_on: "2026-11-02", expected_until: "2026-11-04",
  timing_source: "schedule_basis", receipts,
});

export function drawer(extra: { contact?: unknown; source?: unknown; state?: string; estimate?: unknown; capture?: unknown } = {}) {
  const estimate = {
    id: ID(700), status: "active", status_reason: null, capture_mode: "sale_entry", captured_by: USER, recorded_by: USER,
    recorded_at: "2026-10-19T17:00:00Z", grid_name: "Synthetic Grid", grid_revision: 4, grid_effective_date: "2026-01-01",
    product_name: "Synthetic Term", product_carrier: "Synthetic Life", variant_label: "Ages 18-60", insured_age: 35, term_years: 20,
    contract_level: 100, rate_percent: "95.50", monthly_premium: "50.00", premium_source: "sale_snapshot", first_year_cents: 57300,
    advance_cents: 42975, schedule_start_on: "2026-11-01", schedule_start_source: "effective_date", schedule_assumed: true,
    schedule_frequency: null, schedule_convention: "premium_plus_1_3_fed_business_days_v1", state_revision: 2,
    installments: [installment(1, "advance", 42975), installment(2, "month_10", 4775), installment(3, "month_11", 4775), installment(4, "month_12", 4775)],
  };
  return {
    policy: {
      policy_id: ID(301), source: "source" in extra ? extra.source : "primary", state: extra.state ?? "recorded", access: "write",
      credited_agent_id: USER, win_id: ID(800),
      basis: { policy_type: "Term", carrier: "Synthetic Life", monthly_premium: "50.00", premium_source: "sale_snapshot", effective_date: "2026-11-01",
        payment_frequency: null },
      estimate: "estimate" in extra ? extra.estimate : estimate, capture: extra.capture ?? null,
    },
    contact: "contact" in extra ? extra.contact : { client_id: ID(401), name: "Client 1" },
    meta,
  };
}
