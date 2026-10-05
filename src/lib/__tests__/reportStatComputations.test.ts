/**
 * Reports stat cards — canonical values, unknown ≠ zero, no conversion rate of any kind.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { computeAllStats, STAT_DEFINITIONS, isStatAvailable, POLICY_RATIO_SCOPE_REASON } from "@/lib/stat-computations";
import { DEFAULT_LAYOUT, DEFAULT_VISIBLE_STATS, MAX_VISIBLE_STATS } from "@/lib/report-layout-constants";
import { ReportsQueryError } from "@/lib/reports-queries";
import { AGENT_A, emptySummary, reportSummary, reportVolume } from "./reportsFixtures";
import type { ReportSummary } from "@/lib/reports-schemas";

const ready = <T,>(data: T) => ({ status: "ready" as const, data });
const inputs = (over: Partial<Parameters<typeof computeAllStats>[0]> = {}) => ({
  summary: ready(reportSummary()),
  volume: ready(reportVolume()),
  dayCount: 31,
  agencyToday: "2026-07-20",
  ...over,
});

describe("canonical stat values", () => {
  const stats = computeAllStats(inputs());
  const v = (id: string) => stats.get(id)!;

  it("uses the server's canonical totals", () => {
    expect(v("stat_total_dials").value).toBe("19");
    expect(v("stat_total_contacted").value).toBe("11");
    expect(v("stat_contact_rate").value).toBe("57.9%");
    expect(v("stat_total_talk_time").value).toBe("12:20");
    expect(v("stat_policies_sold").value).toBe("5");
    expect(v("stat_leads_converted").value).toBe("2");
    expect(v("stat_appointments_set").value).toBe("4");
    expect(v("stat_session_time").value).toBe("2h 40m 0s");
    expect(v("stat_calls_per_day").value).toBe("0.6");
    expect(v("stat_policies_sold").subtitle).toBe("stored policies, by sale date");
    expect(v("stat_dials_per_sale").label).toBe("Dials per policy sold");
    expect(v("stat_contact_rate").label).toBe("Call contact rate");
    expect(v("stat_best_contact_agent").label).toBe("Best call contact rate");
    expect(v("stat_best_contact_agent").subtitle).toBe("100.0% call contact rate");
    expect(v("stat_dials_per_contact").label).toBe("Dials per contacted call");
    expect(v("stat_dials_per_contact").subtitle).toBe("calls made ÷ contacted calls");
  });

  it("session-based ratios use the server interval-matched cohort", () => {
    // Totals carry 19 calls / 740 s talk; only 13 calls / 449 s fall inside matching session intervals.
    expect(v("stat_calls_per_hour").value).toBe("4.9"); // 13 calls ÷ 2.67 session hours, not 19 ÷ 2.67
    expect(v("stat_talk_time_ratio").value).toBe("4.7%"); // 449 s ÷ 9600 s; outside calls are excluded
  });

  it("derives team leaders from per-agent canonical rows", () => {
    expect(v("stat_top_performer").value).toBe("Bob Agent"); // 2 policies, current assignment
    expect(v("stat_top_performer").label).toBe("Most policies — current assignments");
    expect(v("stat_top_performer").subtitle).toBe("2 policies currently assigned");
    expect(v("stat_top_dialer").value).toBe("Alice Agent"); // 10 calls
    expect(v("stat_agents_active").value).toBe("2");
  });

  it("reads 'calls today' from the AGENCY calendar day", () => {
    expect(v("stat_calls_today").value).toBe("3"); // 2026-07-20 in the fixture
    const outside = computeAllStats(inputs({ agencyToday: "2026-08-02" })).get("stat_calls_today")!;
    expect(outside.state).toBe("unavailable");
    expect(outside.value).toBe("—");
  });
});

// Policy counts are the client's CURRENT assignment (plan §20 rev 2), not original seller credit.
const org = (s: ReportSummary, filter: string | null = null): ReportSummary => ({ ...s, scope: "organization", filter_agent_id: filter });

describe("per-policy ratios are organization-period figures, never agent or team efficiency", () => {
  it("organization scope with no agent filter: calls / talk in the period ÷ dated stored policies in the period", () => {
    const stats = computeAllStats(inputs({ summary: ready(org(reportSummary())) }));
    expect(stats.get("stat_dials_per_sale")!.value).toBe("3.8"); // 19 calls ÷ 5 policies
    expect(stats.get("stat_dials_per_sale")!.subtitle).toBe("calls in period ÷ dated stored policies in period");
    expect(stats.get("stat_talk_mins_per_sale")!.value).toBe("2.5"); // 740 s = 12.33 min ÷ 5
    expect(stats.get("stat_talk_mins_per_sale")!.subtitle).toBe("talk minutes in period ÷ dated stored policies in period");
  });

  it.each([
    ["team scope", reportSummary()],
    ["own scope", { ...reportSummary(), scope: "own" as const }],
    ["organization scope filtered to one agent", org(reportSummary(), AGENT_A)],
  ])("%s: both ratios are unavailable, with the reason and no number", (_label, summary) => {
    const stats = computeAllStats(inputs({ summary: ready(summary) }));
    for (const id of ["stat_dials_per_sale", "stat_talk_mins_per_sale"]) {
      expect(stats.get(id)!.state).toBe("unavailable");
      expect(stats.get(id)!.value).toBe("—");
      expect(stats.get(id)!.subtitle).toBe(POLICY_RATIO_SCOPE_REASON);
    }
  });

  it("a reassigned client moves the ranking, never the total, the calls or an efficiency figure", () => {
    const before = reportSummary();
    // Bob's client (2 policies) reassigned to Alice: same organization total, calls stay with the caller.
    const after = reportSummary({}, before.by_agent.map((a) => (a.agent_id === AGENT_A ? { ...a, policies_sold: 3 } : { ...a, policies_sold: 0 })));
    const b = computeAllStats(inputs({ summary: ready(before) }));
    const a = computeAllStats(inputs({ summary: ready(after) }));
    expect(b.get("stat_top_performer")!.value).toBe("Bob Agent");
    expect(a.get("stat_top_performer")!.value).toBe("Alice Agent");
    expect(a.get("stat_top_performer")!.label).toBe("Most policies — current assignments");
    expect(a.get("stat_policies_sold")!.value).toBe(b.get("stat_policies_sold")!.value);
    expect(a.get("stat_top_dialer")!.value).toBe("Alice Agent"); // 10 calls, unchanged
    for (const id of ["stat_dials_per_sale", "stat_talk_mins_per_sale"]) expect(a.get(id)!.state).toBe("unavailable");
    const orgAfter = computeAllStats(inputs({ summary: ready(org(after)) }));
    const orgBefore = computeAllStats(inputs({ summary: ready(org(before)) }));
    expect(orgAfter.get("stat_dials_per_sale")!.value).toBe(orgBefore.get("stat_dials_per_sale")!.value);
  });

  it("no policy stat is labelled as seller credit", () => {
    for (const def of STAT_DEFINITIONS) expect(def.label).not.toMatch(/top performer|seller/i);
  });
});

describe("unknown is never zero", () => {
  it("a failed summary renders every summary stat as an error with no digits", () => {
    const failed = { status: "error" as const, error: new ReportsQueryError("unavailable") };
    const stats = computeAllStats(inputs({ summary: failed }));
    for (const id of ["stat_total_dials", "stat_contact_rate", "stat_policies_sold", "stat_top_performer"]) {
      expect(stats.get(id)!.state).toBe("error");
      expect(stats.get(id)!.value).not.toMatch(/\d/);
    }
  });

  it("zero denominators render a dash", () => {
    const stats = computeAllStats(inputs({ summary: ready(emptySummary()) }));
    expect(stats.get("stat_total_dials")!.value).toBe("0"); // a real, successful zero
    expect(stats.get("stat_contact_rate")!.value).toBe("—");
    expect(stats.get("stat_calls_per_hour")!.value).toBe("—");
    const orgEmpty = computeAllStats(inputs({ summary: ready(org(emptySummary())) }));
    expect(orgEmpty.get("stat_dials_per_sale")!.value).toBe("—"); // zero policies: a dash, never Infinity
    expect(stats.get("stat_top_performer")!.value).toBe("—");
  });

  it("a panel refused for an unconfigured agency time zone is 'unavailable' with the reason, never a zero or a generic error", () => {
    const zone = { status: "error" as const, error: new ReportsQueryError("configuration") };
    const stats = computeAllStats(inputs({ summary: zone, volume: zone }));
    for (const id of ["stat_total_dials", "stat_contact_rate", "stat_calls_today"]) {
      expect(stats.get(id)!.state).toBe("unavailable");
      expect(stats.get(id)!.subtitle).toBe("Agency time zone not configured");
      expect(stats.get(id)!.value).not.toMatch(/\d/);
    }
  });

  it("loading stats show no value", () => {
    const stats = computeAllStats(inputs({ summary: { status: "loading" } }));
    expect(stats.get("stat_total_dials")!.state).toBe("loading");
  });
});

describe("no conversion rate and no undefined metric", () => {
  it("every conversion-rate stat is unavailable and shows no number", () => {
    const stats = computeAllStats(inputs());
    for (const id of ["stat_call_to_close", "stat_contacted_to_close", "stat_appt_to_close", "stat_best_conv_agent", "stat_callback_conv_rate"]) {
      expect(stats.get(id)!.state).toBe("unavailable");
      expect(stats.get(id)!.value).toBe("—");
    }
    for (const def of STAT_DEFINITIONS.filter((d) => !d.unavailable)) {
      expect(def.label.toLowerCase()).not.toMatch(/conversion|conv rate|close rate/);
    }
  });

  it("defaults show only available stats and respect the cap", () => {
    expect(DEFAULT_VISIBLE_STATS.length).toBeLessThanOrEqual(MAX_VISIBLE_STATS);
    for (const id of DEFAULT_VISIBLE_STATS) expect(isStatAvailable(id)).toBe(true);
    const visible = DEFAULT_LAYOUT.sections.filter((s) => s.id.startsWith("stat_") && s.visible).map((s) => s.id);
    for (const id of visible) expect(isStatAvailable(id)).toBe(true);
  });
});
