// Synthetic Reports v3 data (D6 §7). The only place synthetic v3 data lives: test builders, the 11 BC4 truth-table
// cases, and labelled preview scenarios derived from real SQL payloads. Never imported by production code.
import type { KpiEnvelope } from "@/lib/reports-v3-schemas";

type Partialish = Partial<KpiEnvelope> & Pick<KpiEnvelope, "id">;
export const env = (e: Partialish): KpiEnvelope => ({
  value: null, status: "available", reason: null, numerator: null, denominator: null, coverage: null, maturity: null, detail: null, ...e,
});
const cov = (eligible: number, assessable: number, reasons: Record<string, number>) =>
  ({ eligible, assessable, unassessable: eligible - assessable, reasons }) as KpiEnvelope["coverage"];
const maturity = (members: number, pending: number, successes: number, mature: number, matureSuccesses: number) => ({
  window_days: 30 as const, state: pending > 0 ? "in_progress" as const : "complete" as const, members, pending,
  successes_to_date: successes, mature_members: mature, mature_successes: matureSuccesses, fully_mature_on: pending > 0 ? "2026-12-03" : null,
});

export interface Bc4Case {
  n: number;
  scenario: string;
  envelopes: KpiEnvelope[];
  /** Per KPI id: the tile text, cue and chips, and the CSV status, value and reason. */
  expect: Record<number, { text: string; cue: string | null; chips: string[]; csvStatus: string; csvValue: string; csvReason: string; inProgress?: string }>;
}

const unverified3 = { call_population: { attempts: 0, non_attempts: 0, unverified: 3, duplicates_excluded: 0 } };
export const BC4_CASES: Bc4Case[] = [
  { n: 1, scenario: "0 confirmed calls, 0 unverified, 2 policies (complete)",
    envelopes: [env({ id: 9, value: 0, numerator: 0, denominator: 2 })],
    expect: { 9: { text: "0.0", cue: null, chips: [], csvStatus: "available", csvValue: "0.00", csvReason: "" } } },
  { n: 2, scenario: "0 contacted calls, 2 policies (complete)",
    envelopes: [env({ id: 10, value: 0, numerator: 0, denominator: 2 })],
    expect: { 10: { text: "0.0", cue: null, chips: [], csvStatus: "available", csvValue: "0.00", csvReason: "" } } },
  { n: 3, scenario: "0 prospects reached, complete identity coverage, 2 policies",
    envelopes: [env({ id: 11, value: 0, numerator: 0, denominator: 2 })],
    expect: { 11: { text: "0.0", cue: null, chips: [], csvStatus: "available", csvValue: "0.00", csvReason: "" } } },
  { n: 4, scenario: "Positive calls, 0 policies",
    envelopes: [env({ id: 9, status: "unavailable", reason: "no_policies_sold", numerator: 12, denominator: 0 })],
    expect: { 9: { text: "—", cue: "No policies", chips: [], csvStatus: "unavailable", csvValue: "", csvReason: "no_policies_sold" } } },
  { n: 5, scenario: "0 confirmed calls, 3 unverified, 2 policies",
    envelopes: [
      env({ id: 9, status: "unavailable", reason: "attempt_unverified", numerator: 0, denominator: 2, coverage: cov(3, 0, { attempt_unverified: 3 }) }),
      env({ id: 5, status: "unavailable", reason: "attempt_unverified", coverage: cov(3, 0, { attempt_unverified: 3 }), detail: unverified3 }),
    ],
    expect: {
      9: { text: "—", cue: "Not enough data", chips: [], csvStatus: "unavailable", csvValue: "", csvReason: "attempt_unverified" },
      5: { text: "—", cue: "Not enough data", chips: [], csvStatus: "unavailable", csvValue: "", csvReason: "attempt_unverified" },
    } },
  { n: 6, scenario: "5 confirmed calls, 3 unverified, 2 policies",
    envelopes: [env({ id: 9, value: 2.5, status: "partial", reason: "attempt_unverified", numerator: 5, denominator: 2, coverage: cov(8, 5, { attempt_unverified: 3 }) })],
    expect: { 9: { text: "2.5", cue: null, chips: ["partial"], csvStatus: "partial", csvValue: "2.50", csvReason: "attempt_unverified" } } },
  { n: 7, scenario: "0 attempts, 0 unverified",
    envelopes: [
      env({ id: 8, status: "unavailable", reason: "no_calls_made", numerator: 0, denominator: 0 }),
      env({ id: 5, value: 0, detail: { call_population: { attempts: 0, non_attempts: 0, unverified: 0, duplicates_excluded: 0 } } }),
    ],
    expect: {
      8: { text: "—", cue: "No calls", chips: [], csvStatus: "unavailable", csvValue: "", csvReason: "no_calls_made" },
      5: { text: "0", cue: null, chips: [], csvStatus: "available", csvValue: "0", csvReason: "" },
    } },
  { n: 8, scenario: "First-contact prospects, none bought, all mature",
    envelopes: [env({ id: 19, value: 0, numerator: 0, denominator: 40, maturity: maturity(40, 0, 0, 40, 0) })],
    expect: { 19: { text: "0.0%", cue: null, chips: [], csvStatus: "available", csvValue: "0.0", csvReason: "", inProgress: "no" } } },
  { n: 9, scenario: "First-contact prospects, none bought, some pending",
    envelopes: [env({ id: 19, value: 0, numerator: 0, denominator: 40, maturity: maturity(40, 12, 0, 28, 0) })],
    expect: { 19: { text: "0.0%", cue: null, chips: ["in_progress"], csvStatus: "available", csvValue: "0.0", csvReason: "", inProgress: "yes" } } },
  { n: 10, scenario: "KPI 12: every member unresolved",
    envelopes: [env({ id: 12, status: "unavailable", reason: "attribution_unresolved", coverage: cov(6, 0, { attribution_unresolved: 6 }), maturity: maturity(6, 0, 0, 6, 0) })],
    expect: { 12: { text: "—", cue: "Not enough data", chips: [], csvStatus: "unavailable", csvValue: "", csvReason: "attribution_unresolved", inProgress: "no" } } },
  { n: 11, scenario: "KPI 12: resolved members, no attributed policy, none unresolved",
    envelopes: [env({ id: 12, status: "unavailable", reason: "no_attributed_policies", numerator: 6, denominator: 0, maturity: maturity(6, 0, 0, 6, 0) })],
    expect: { 12: { text: "—", cue: "No linked policies", chips: [], csvStatus: "unavailable", csvValue: "", csvReason: "no_attributed_policies", inProgress: "no" } } },
];

// ---- Preview scenarios (labelled synthetic; derived from a real SQL payload bundle, never sent to a server) ----
type Bundle = Record<string, any>;
export const PREVIEW_SCENARIOS = ["complete", "missing-premiums", "in-progress", "empty", "loading", "error", "unavailable"] as const;
export type PreviewScenario = (typeof PREVIEW_SCENARIOS)[number];
export const PREVIEW_LABEL = "Synthetic preview data";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const setMetric = (payload: Bundle, id: number, patch: Partial<KpiEnvelope>) => {
  payload.metrics = payload.metrics.map((m: KpiEnvelope) => (m.id === id ? { ...m, ...patch } : m));
};

/** A bundle for a scenario. "complete" removes the real payload's coverage gaps so every KPI the backend can compute
 * today is available; the other data scenarios start from the real payload. Loading, error and unavailable are
 * transport states, decided by the harness. */
export function scenarioBundle(real: Bundle, scenario: PreviewScenario): Bundle {
  const b = clone(real);
  const s = b.summaryV3, j = b.journeyV3;
  if (scenario === "complete") {
    for (const m of s.metrics as KpiEnvelope[]) {
      if (m.status === "partial") Object.assign(m, { status: "available", reason: null, coverage: null });
    }
    if (s.metrics[0].detail) s.metrics[0].detail.premium = { ...s.metrics[0].detail.premium, missing: 0, invalid: 0 };
    if (s.metrics[3].detail) s.metrics[3].detail.premium = { ...s.metrics[3].detail.premium, missing: 0, invalid: 0 };
    s.metrics[4].detail.call_population.unverified = 0;
    for (const m of j.metrics as KpiEnvelope[]) {
      if (m.status === "partial") Object.assign(m, { status: "available", reason: null, coverage: null });
      if (m.maturity) m.maturity = { ...m.maturity, state: "complete", pending: 0, mature_members: m.maturity.members,
        mature_successes: m.maturity.successes_to_date, fully_mature_on: null };
    }
  }
  if (scenario === "missing-premiums") {
    const p1 = s.metrics[0], known = Math.round(p1.detail.premium.known * 0.7), total = p1.detail.premium.known + p1.detail.premium.missing;
    const missing = total - known;
    for (const idx of [0, 3]) {
      const m = s.metrics[idx];
      m.detail.premium = { ...m.detail.premium, known, missing, invalid: 2 };
      Object.assign(m, { status: "partial", reason: "premium_invalid",
        coverage: { eligible: total, assessable: known, unassessable: total - known, reasons: { premium_invalid: 2, premium_missing: missing - 2 } } });
      m.detail.premium.missing = missing - 2;
      if (m.id === 4) Object.assign(m, { denominator: known, value: Number((m.numerator / known).toFixed(6)) });
    }
  }
  if (scenario === "in-progress") {
    const m19 = j.metrics.find((m: KpiEnvelope) => m.id === 19);
    if (m19?.maturity) {
      const pending = Math.max(1, Math.round(m19.maturity.members / 3));
      m19.maturity = { ...m19.maturity, pending, state: "in_progress", mature_members: m19.maturity.members - pending, fully_mature_on: "2026-12-03" };
    }
  }
  if (scenario === "empty") {
    for (const key of ["summaryV3", "journeyV3"]) {
      for (const m of b[key].metrics as KpiEnvelope[]) emptyMetric(m);
      for (const row of b[key].by_agent) for (const m of row.metrics as KpiEnvelope[]) emptyMetric(m);
    }
    s.production_by_date = s.production_by_date.map((d: Bundle) => ({ ...d, policies_sold: 0, annual_premium: 0, premium_known: 0, premium_missing: 0, premium_invalid: 0 }));
    s.call_population = { attempts: 0, non_attempts: 0, unverified: 0, duplicates_excluded: 0 };
  }
  return b;
}

const ZERO_REASON: Record<number, string | null> = { 4: "no_policies_sold", 8: "no_calls_made", 9: "no_policies_sold", 10: "no_policies_sold",
  11: "no_policies_sold", 34: "no_lead_calls", 14: "no_first_time_buyers", 38: "no_first_time_buyers", 19: "no_first_contacts", 21: "no_first_contacts" };
function emptyMetric(m: KpiEnvelope) {
  const zero = ZERO_REASON[m.id];
  if (m.status === "unavailable" && !zero) return; // keep config states such as "Not tracked yet"
  if (m.id === 38 && m.reason === "sale_call_link_not_captured") return;
  const detail = m.detail as Bundle | null;
  if (detail?.premium) detail.premium = { known: 0, missing: 0, invalid: 0, legacy_record_fallback: 0 };
  if (detail?.call_population) detail.call_population = { attempts: 0, non_attempts: 0, unverified: 0, duplicates_excluded: 0 };
  Object.assign(m, zero
    ? { value: null, status: "unavailable", reason: zero, coverage: null, maturity: null, numerator: m.numerator === null ? null : 0, denominator: m.denominator === null ? null : 0 }
    : { value: 0, status: "available", reason: null, coverage: null, numerator: m.numerator === null ? null : 0 });
}

// ---- A small, contract-valid v3 bundle for unit tests (no SQL payload file needed). Numbers reconcile: Calls
// is 200 on every surface; AP $4,000.50 over 4 policies (average rounds once to $1,000.13). ----
export const T_ORG = "10000000-0000-0000-0000-000000000001";
export const T_SELF = "11000000-0000-0000-0000-0000000000b1";
export const T_PEER = "11000000-0000-0000-0000-0000000000b2";
export const T_CAMPAIGN = "20000000-0000-0000-0000-000000000001";
const STATE_CODES = ["AK", "AL", "AR", "AZ", "CA", "CO", "CT", "DC", "DE", "FL", "GA", "HI", "IA", "ID", "IL", "IN", "KS", "KY", "LA", "MA", "MD", "ME",
  "MI", "MN", "MO", "MS", "MT", "NC", "ND", "NE", "NH", "NJ", "NM", "NV", "NY", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VA", "VT",
  "WA", "WI", "WV", "WY"];
export interface BundleArgs { requestedScope: "personal" | "team" | "agency"; startDate: string; endDate: string; agentId?: string | null; asOf?: string }
const days = (a: string, b: string) => { const out: string[] = []; for (let d = new Date(a + "T00:00:00Z"); d <= new Date(b + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10)); return out; };
const pop = (unverified = 0) => ({ attempts: 200, non_attempts: 0, unverified, duplicates_excluded: 0 });
const credit: Record<string, string> = { 1: "original_seller", 2: "original_seller", 3: "original_seller", 4: "original_seller", 5: "placing_agent", 6: "placing_agent",
  7: "placing_agent", 8: "placing_agent", 9: "placing_agent_and_original_seller", 10: "placing_agent_and_original_seller", 11: "placing_agent_and_original_seller",
  24: "placing_agent", 25: "session_agent", 34: "placing_agent", 14: "original_seller", 19: "first_contact_agent", 21: "first_contact_agent", 38: "original_seller",
  12: "assigned_agent_at_start", 15: "setter", 16: "assigned_agent_at_start", 17: "assigned_agent_at_start", 18: "assigned_agent_at_start" };
const creditFor = (ids: number[]) => Object.fromEntries(ids.map(i => [String(i), credit[i]]));

export function summaryMetrics(agency: boolean, scale = 1): KpiEnvelope[] {
  const prem = { known: 4 * scale, missing: 0, invalid: 0, legacy_record_fallback: 0 };
  return [
    env({ id: 1, value: 4000.5 * scale, detail: { premium: prem, premium_sources: { none: 0, correction: 0, sale_snapshot: 4 * scale, legacy_sale_event: 0, legacy_record_fallback: 0 }, corrections_applied: 0, unattributed_annual_premium: agency ? 0 : null } }),
    env({ id: 2, value: 4 * scale, detail: { quality: { undated_policies: 0, unattributed_policies: agency ? 0 : null, missing_policy_identity: agency ? 0 : null }, stored_without_sale: agency ? 0 : null } }),
    env({ id: 3, value: 3 * scale, detail: { client_record_deleted: 0 } }),
    env({ id: 4, value: 1000.125, numerator: 4000.5 * scale, denominator: 4 * scale, detail: { premium: prem } }),
    env({ id: 5, value: 200 * scale, detail: { call_population: { attempts: 200 * scale, non_attempts: 0, unverified: 0, duplicates_excluded: 0 } } }),
    env({ id: 6, value: 50 * scale }),
    env({ id: 7, value: 40 * scale }),
    env({ id: 8, value: 25, numerator: 50 * scale, denominator: 200 * scale }),
    env({ id: 9, value: 50, numerator: 200 * scale, denominator: 4 * scale }),
    env({ id: 10, value: 12.5, numerator: 50 * scale, denominator: 4 * scale }),
    env({ id: 11, value: 10, numerator: 40 * scale, denominator: 4 * scale }),
    env({ id: 24, value: 3600 * scale, detail: { quality: { estimated: 0, unknown: 0, conflicting: 0, inconsistent: 0, provider_confirmed: 50 * scale, duplicates_excluded: 0 } } }),
    env({ id: 25, value: 7200 * scale, detail: { quality: { stale_capped: 0, late_ended: 0 } } }),
    env({ id: 34, value: 2, numerator: 160 * scale, denominator: 80 * scale }),
  ];
}
const history = { history: { assessable: 4, unassessable_by: {}, numberless_unresolved_calls: null }, unresolved_activity: { contacted_calls: 0, answered_inbound: 0, outbound_attempts: 0 } };
const journeyMetrics = (): KpiEnvelope[] => [
  env({ id: 14, value: 6, detail: history }),
  env({ id: 19, value: 10, numerator: 1, denominator: 10, detail: history, maturity: maturity(10, 0, 1, 10, 1) }),
  env({ id: 21, value: 2, detail: history }),
  env({ id: 38, status: "unavailable", reason: "sale_call_link_not_captured" }),
];
const apptMetrics = (): KpiEnvelope[] => [12, 15, 16, 17, 18].map(id => env({ id, status: "unavailable", reason: "evidence_not_captured" }));
const zeroState = () => ({ calls_made: 0, contacted_calls: 0, policies_sold: 0, premium: { known_count: 0, policy_count: 0, invalid_count: 0, missing_count: 0, annual_premium: 0 } });
const reasons = ["missing_state", "invalid_state", "unresolved_identity", "source_conflict", "unsupported_geography", "non_prospect_contact"];

export function buildV3Bundle(a: BundleArgs): Record<string, any> {
  const scope = a.requestedScope === "personal" ? "own" : a.requestedScope === "team" ? "team" : "organization";
  const agency = scope === "organization";
  const asOf = a.asOf ?? "2026-07-15T20:00:00Z";
  const meta = (reader: string) => ({
    basis_version: "reports_v3", contract_version: "3.0.0", reader, scope, requested_scope: a.requestedScope, filter_agent_id: a.agentId ?? null,
    window: { time_zone: "America/Chicago", time_zone_source: "agency_settings", start_date: a.startDate, end_date: a.endDate,
      start_at: `${a.startDate}T05:00:00Z`, end_at: `${a.endDate}T05:00:00Z` },
    as_of: asOf, agency_today: "2026-07-15", period_open: true,
    basis: { corrections: "not_installed", sale_call_links: "not_installed", appointment_evidence: "not_installed" },
  });
  const policyBasis = { source: "original_policy_sales", credit: "original_seller", date: "sold_date", premium: "effective_sale_monthly_x12" };
  const ds = days(a.startDate, a.endDate);
  const agents = [{ agent_id: T_SELF, name: "Avery Self", status: "Active" }, ...(agency || scope === "team" ? [{ agent_id: T_PEER, name: "Blake Peer", status: "Active" }] : [])];
  const row = (ids: number[], metrics: KpiEnvelope[]) => agents.map(g => ({ ...g, credit: creditFor(ids), metrics }));
  const callRow = (calls: number, contacted: number) => ({ calls_made: calls, contacted_calls: contacted, contact_rate_numerator: contacted, contact_rate_denominator: calls });
  const ca = { ...zeroState(), calls_made: 150, contacted_calls: 40, policies_sold: 4, premium: { known_count: 4, policy_count: 4, invalid_count: 0, missing_count: 0, annual_premium: 4000.5 } };
  const unm = reasons.map(r => ({ reason: r, ...zeroState(), ...(r === "missing_state" ? { calls_made: 50, contacted_calls: 10 } : {}) }));
  return {
    scopeV3: { basis_version: "reports_v3", contract_version: "3.0.0", reader: "scope", role: agency ? "Admin" : scope === "team" ? "Team Leader" : "Agent",
      scope, requested_scope: a.requestedScope, available_scopes: ["personal", "team", "agency"], self_id: T_SELF, filter_agent_id: null,
      agents: agents.map(g => ({ id: g.agent_id, name: g.name, status: g.status })), can_export: true, max_range_days: 366, today: "2026-07-15",
      time_zone: "America/Chicago", time_zone_source: "agency_settings", as_of: asOf,
      basis: { corrections: "not_installed", sale_call_links: "not_installed", appointment_evidence: "not_installed" } },
    summaryV3: { ...meta("summary"), policy_basis: policyBasis, metrics: summaryMetrics(agency), by_agent: row([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 24, 25, 34], summaryMetrics(agency)),
      production_by_date: ds.map((d, i) => ({ date: d, policies_sold: i === 0 ? 3 : i === 1 ? 1 : 0, annual_premium: i === 0 ? 3000.25 : i === 1 ? 1000.25 : 0,
        premium_known: i === 0 ? 3 : i === 1 ? 1 : 0, premium_missing: 0, premium_invalid: 0 })), call_population: pop() },
    journeyV3: { ...meta("journey"), policy_basis: policyBasis, metrics: journeyMetrics(), by_agent: row([14, 19, 21, 38], journeyMetrics()) },
    salesAppointmentsV3: { ...meta("sales_appointments"), metrics: apptMetrics(), by_agent: row([12, 15, 16, 17, 18], apptMetrics()) },
    statesV3: { ...meta("state_breakdown"), policy_basis: policyBasis, metrics: [], call_population: pop(),
      modes: { calls_made: { metric_id: 5, status: "available", reason: null }, contacted_calls: { metric_id: 6, status: "available", reason: null },
        policies_sold: { metric_id: 2, status: "available", reason: null }, ap: { metric_id: 1, status: "available", reason: null } },
      jurisdictions: STATE_CODES.map(s => ({ state: s, ...(s === "CA" ? ca : zeroState()),
        basis: { calls: { campaign_copy: 0, current_record: 0, event_snapshot: 0 }, policies: { campaign_copy: 0, current_record: 0, event_snapshot: 0 }, calls_changed_after_event: 0, policies_changed_after_event: 0 } })),
      unmapped: { ...zeroState(), calls_made: 50, contacted_calls: 10, reasons: unm },
      totals: { calls_made: 200, contacted_calls: 50, policies_sold: 4, premium: { known_count: 4, policy_count: 4, invalid_count: 0, missing_count: 0, annual_premium: 4000.5 } },
      state_basis: { version: "state_v1" } },
    volumeV3: { ...meta("call_volume"), metrics: [], call_population: pop(), inbound_calls: 12,
      heatmap: Array.from({ length: 168 }, (_, i) => ({ dow: Math.floor(i / 24), hour: i % 24, calls_made: i === 34 ? 120 : i === 59 ? 80 : 0, contacted: i === 34 ? 30 : i === 59 ? 20 : 0 })),
      by_date: ds.map((d, i) => ({ date: d, calls_made: i === 0 ? 120 : i === 1 ? 80 : 0, contacted: i === 0 ? 30 : i === 1 ? 20 : 0, inbound_calls: i === 0 ? 12 : 0, talk_time_seconds: i === 0 ? 3600 : 0 })),
      by_hour: Array.from({ length: 24 }, (_, h) => ({ hour: h, calls_made: h === 10 ? 120 : h === 11 ? 80 : 0, contacted: h === 10 ? 30 : h === 11 ? 20 : 0 })),
      by_weekday: Array.from({ length: 7 }, (_, d) => ({ dow: d, calls_made: d === 1 ? 120 : d === 2 ? 80 : 0, contacted: d === 1 ? 30 : d === 2 ? 20 : 0 })) },
    dispositionsV3: { ...meta("disposition_breakdown"), metrics: [], call_population: pop(),
      by_disposition: [
        { key: "d-answered", name: "Interested", color: "#22C55E", calls: 150, duration_seconds: 3000, counts_as_contacted: true, converts: true, dnc: false, callback: false, appointment: false },
        { key: "none", name: "No outcome recorded", color: null, calls: 50, duration_seconds: 600, counts_as_contacted: false, converts: false, dnc: false, callback: false, appointment: false }],
      duration_buckets: ["0-30s", "30s-2m", "2-5m", "5-15m", "15m+"].map((r, i) => ({ range: r, calls: i === 0 ? 120 : i === 1 ? 80 : 0 })),
      deep_dive: { by_agent: agents.map((g, i) => ({ agent_id: g.agent_id, name: g.name, total: i === 0 ? 200 : 0, counts: i === 0 ? { "d-answered": 150, none: 50 } : {} })),
        by_campaign: [{ campaign_id: T_CAMPAIGN, name: "Spring Leads", total: 150, counts: { "d-answered": 150 } }],
        without_campaign: { total: 50, counts: { none: 50 } }, other_campaigns: { total: 0, counts: {} },
        // As the SQL reader: calls with no credited agent are part of an agency request only; null at team and personal.
        unattributed: agency ? { total: 0, counts: {} } : null } },
    campaignsV3: { ...meta("campaign_calls"), metrics: [], call_population: pop(),
      campaigns: [{ campaign_id: T_CAMPAIGN, name: "Spring Leads", type: "Personal", ...callRow(150, 40) }],
      calls_without_campaign: callRow(30, 6), other_campaigns: callRow(20, 4) },
    leadSourcesV3: { ...meta("lead_source_calls"), metrics: [], call_population: pop(),
      sources: [{ lead_source: "Facebook", new_leads: 7, ...callRow(160, 42) }], not_linked: callRow(40, 8) },
  };
}

export const V3_PANEL_KEY: Record<string, string> = {
  get_report_scope_v3: "scopeV3", get_report_summary_v3: "summaryV3", get_report_journey_v3: "journeyV3",
  get_report_sales_appointments_v3: "salesAppointmentsV3", get_report_state_breakdown_v3: "statesV3", get_report_call_volume_v3: "volumeV3",
  get_report_disposition_breakdown_v3: "dispositionsV3", get_report_campaign_calls_v3: "campaignsV3", get_report_lead_source_calls_v3: "leadSourcesV3",
};
