/**
 * Reports stat cards — canonical values, unknown ≠ zero, no conversion rate of any kind.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { computeAllStats, STAT_DEFINITIONS, isStatAvailable } from "@/lib/stat-computations";
import { DEFAULT_LAYOUT, DEFAULT_VISIBLE_STATS, MAX_VISIBLE_STATS } from "@/lib/report-layout-constants";
import { ReportsQueryError } from "@/lib/reports-queries";
import { emptySummary, reportSummary, reportVolume } from "./reportsFixtures";

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
    expect(v("stat_session_time").value).toBe("2h 40m");
    expect(v("stat_calls_per_day").value).toBe("0.6");
    expect(v("stat_dials_per_sale").value).toBe("3.8");
    expect(v("stat_dials_per_sale").label).toBe("Dials per policy sold");
  });

  it("derives team leaders from per-agent canonical rows", () => {
    expect(v("stat_top_performer").value).toBe("Bob Agent"); // 2 policies
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
    expect(stats.get("stat_dials_per_sale")!.value).toBe("—");
    expect(stats.get("stat_calls_per_hour")!.value).toBe("—");
    expect(stats.get("stat_top_performer")!.value).toBe("—");
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
