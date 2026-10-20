/** Synthetic commissions center responses for tests (never production data). */
export const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const USER = ID(901);
export const ORG = ID(902);
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
    totals: { received_cents: 5157, valid_count: 1, voided_count: 0 }, rows, ...extra };
}

export function policyRow(n: number, extra: Record<string, unknown> = {}) {
  return {
    policy_id: ID(300 + n), setup: "recorded", contact: { client_id: ID(400 + n), name: `Client ${n}` }, source: "primary",
    carrier: "Synthetic Life", product: "Synthetic Term", effective_date: "2026-11-01", estimate_cents: 57300, received_cents: 20000,
    remaining_cents: 37300, excess_cents: 0, date_needed_count: 0,
    next_payment: { kind: "advance", timing_precision: "date", expected_on: "2026-11-02", expected_until: "2026-11-04", remaining_cents: 22975, status: "upcoming" },
    ...extra,
  };
}

export function policiesPage(rows = [policyRow(1)], extra: Record<string, unknown> = {}) {
  return { meta, total_count: rows.length, counts: { eligible_count: 12, with_estimate_count: 10, missing_count: 1, needs_review_count: 1, on_hold_count: 1 },
    carriers: ["Synthetic Life"], rows, ...extra };
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
