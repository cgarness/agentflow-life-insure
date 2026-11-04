/**
 * RL-17 component harness (Reports V2 PKG-B, D2 §6.5 step 3). The correction bundles are real PostgreSQL responses
 * from the reporting fixture's policy database (scripts/reports_v3_fixture.py --part correction-payloads): the
 * seller's Leaderboard snapshot, performance summary and Recent Wins before and after an Admin corrected a sale
 * from $100/mo to $120/mo. Both parse through the existing performanceQueries.ts / performanceSummary.ts loaders and
 * render through the unchanged Leaderboard row, Dashboard AP card, Goal progress and Recent Wins.
 * The payload cases run only when REPORTS_SQL_PAYLOADS is set (the reports-backend workflow sets it).
 */
import React from "react";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { format, parseISO } from "date-fns";

const h = vi.hoisted(() => ({ stage: null as null | Record<string, unknown>, goal: 5000 }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { organization_id: "00000000-0000-0000-0000-000000000001" } }) }));
vi.mock("@/contexts/BrandingContext", () => {
  const at = (d: string | Date) => (typeof d === "string" ? parseISO(d) : d);
  return { useBranding: () => ({ branding: { timezone: "America/Los_Angeles" },
    formatDate: (d: string | Date) => format(at(d), "MM/dd/yyyy"), formatTime: (d: string | Date) => format(at(d), "h:mm a") }) };
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string) => {
      const data = fn === "get_leaderboard_snapshot" ? h.stage!.snapshot : fn === "get_performance_summary" ? h.stage!.summary
        : fn === "get_leaderboard_recent_wins" ? h.stage!.recentWins : null;
      const q = { abortSignal: () => q, then: (yes: (v: unknown) => unknown, no: (e: unknown) => unknown) =>
        Promise.resolve({ data, error: null }).then(yes, no) };
      return q;
    },
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q; q.eq = () => q; q.abortSignal = () => q;
      q.maybeSingle = () => Promise.resolve({ data: { id: "goal", monthly_call_goal: 0, monthly_policies_goal: 0, monthly_appointment_goal: 0,
        monthly_premium_goal: h.goal }, error: null });
      return q;
    },
  },
}));

import { loadPerformanceSnapshot, loadPerformanceWins } from "@/lib/performanceQueries";
import { loadPerformanceSummary } from "@/lib/performanceSummary";
import LeaderboardRankingsTable from "@/components/leaderboard/LeaderboardRankingsTable";
import RecentWinsPanel from "@/components/leaderboard/RecentWinsPanel";
import StatCards from "@/components/dashboard/StatCards";
import GoalProgressWidget from "@/components/dashboard/widgets/GoalProgressWidget";
import { resetDashboardSectionLanes } from "@/lib/dashboardRefresh";
import type { StatData } from "@/hooks/useDashboardStats";

const payloadPath = process.env.REPORTS_SQL_PAYLOADS;
const bundles = (path = payloadPath!) => {
  const data = JSON.parse(readFileSync(path, "utf8"));
  if (!data.correction?.before || !data.correction?.after || !data.correction?.fixture) {
    throw new Error("REPORTS_SQL_PAYLOADS has no correction.before / correction.after bundles");
  }
  return data.correction as Record<"before" | "after" | "fixture", Record<string, unknown>>;
};
afterEach(() => { cleanup(); resetDashboardSectionLanes(); });

async function surfaces(stage: Record<string, unknown>, fixture: Record<string, unknown>) {
  h.stage = stage;
  const signal = new AbortController().signal;
  const snapshot = await loadPerformanceSnapshot("This Month", null, (stage.snapshot as { organization_id: string }).organization_id, signal);
  const wins = await loadPerformanceWins(null, signal);
  const summary = await loadPerformanceSummary("month", "own", fixture.actor as string, signal);
  expect(snapshot.error).toBeNull();
  expect(wins.error).toBeNull();
  const seller = snapshot.data!.rows.find((r) => r.id === fixture.actor)!;
  const c = summary.current, p = summary.previous;
  const stats = { performance: summary, callsToday: c.calls, callsYesterday: p.calls, leadsToday: 0, leadsYesterday: 0,
    policiesThisMonth: c.policies, policiesLastMonth: p.policies, winsThisMonth: c.policies, appointmentsToday: c.workload,
    appointmentsYesterday: p.workload, callsThisMonth: c.calls, premiumThisMonth: c.annual_premium, premiumLastMonth: p.annual_premium,
    talkTimeMinutes: 0, prevLabel: "previous full month" } as unknown as StatData;
  const sale = wins.data!.find((w) => w.id === fixture.win_id)!;
  const empty = new Map();
  const board = render(<LeaderboardRankingsTable agents={[seller]} view="org" rankAnimations={empty} rankMovements={empty}
    rankMotions={empty} rankDeltas={empty} onExportCsv={() => {}} />);
  const row = board.container.textContent!;
  board.unmount();
  const cards = render(<StatCards role="Agent" userId={fixture.actor as string} adminToggle="my" timeRange="month" stats={stats} loading={false} />);
  const card = (screen.getByText("Annual Premium").closest(".rounded-2xl") as HTMLElement).textContent!;
  cards.unmount();
  const recent = render(<RecentWinsPanel wins={[sale]} agents={[]} flashingWinId={null} />);
  const recentText = recent.container.textContent!;
  recent.unmount();
  render(<MemoryRouter><GoalProgressWidget userId={fixture.actor as string} /></MemoryRouter>);
  const goal = ((await screen.findByText("Monthly Premium")).closest("div.space-y-2") as HTMLElement).textContent!;
  cleanup(); resetDashboardSectionLanes();
  return { seller, sale, summary, row, card, recentText, goal };
}

describe("corrected premium surfaces (RL-17)", () => {
  it.runIf(!!payloadPath)("the Leaderboard row, Dashboard AP card, Goal progress and Recent Wins move from $1,200.00 to $1,440.00", async () => {
    const { before, after, fixture } = bundles();
    const b = await surfaces(before, fixture);
    const a = await surfaces(after, fixture);
    expect([b.seller.premiumSold, a.seller.premiumSold]).toEqual([1200, 1440]);
    expect(a.seller.policiesSold).toBe(b.seller.policiesSold);
    expect(b.row).toContain("$1,200.00"); expect(a.row).toContain("$1,440.00"); expect(a.row).not.toContain("$1,200.00");
    expect(b.card).toContain("$1,200.00"); expect(a.card).toContain("$1,440.00");
    expect([b.summary.current.policies, a.summary.current.policies]).toEqual([1, 1]);
    expect(b.goal).toContain("$100.00 / $5,000.00"); expect(a.goal).toContain("$120.00 / $5,000.00");
    expect([b.sale.premiumSold, a.sale.premiumSold]).toEqual([1200, 1440]);
    expect(a.sale.premium_amount).toBe(100);  // the raw sale amount stays in the payload, never rendered
    expect(b.recentText).toContain("$1,200.00"); expect(a.recentText).toContain("$1,440.00");
    expect(a.recentText).not.toMatch(/\$100\.00|\$1,200\.00/);
  });

  it.runIf(!!payloadPath)("a payload file without the correction bundles fails", () => {
    const { correction: _omitted, ...rest } = JSON.parse(readFileSync(payloadPath!, "utf8"));
    const path = join(mkdtempSync(join(tmpdir(), "pspc-")), "payloads.json");
    writeFileSync(path, JSON.stringify(rest));
    expect(() => bundles(path)).toThrow("no correction.before / correction.after bundles");
  });
});
