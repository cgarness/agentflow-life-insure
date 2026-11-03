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
