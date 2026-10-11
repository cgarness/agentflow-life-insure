/**
 * D14 (approved 2026-10-11): a wholly unavailable premium amount is never shown as a $0 sale on the Dashboard.
 *
 * The evidence is the period's own counts (policies > 0 and every premium unknown), never the amount. No policies
 * keeps the empty period's $0.00, known premiums totalling $0 stay $0.00, partial coverage keeps its subtotal and
 * the existing unknown-premium note, and loading/failed stay their own states. A comparison arrow needs both
 * periods to be available.
 */
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { summaryFixture } from "@/test/fixtures/performance";

const h = vi.hoisted(() => ({ current: {} as Record<string, number>, goal: 5000 }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { organization_id: "11111111-1111-4111-8111-111111111111" } }) }));
vi.mock("@/contexts/BrandingContext", () => ({ useBranding: () => ({ branding: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (_fn: string, args: Record<string, unknown>) => {
      const q = { abortSignal: () => q, then: (yes: (v: unknown) => unknown, no: (e: unknown) => unknown) =>
        Promise.resolve({ data: summaryFixture(args, h.current), error: null }).then(yes, no) };
      return q;
    },
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q; q.eq = () => q; q.abortSignal = () => q;
      q.maybeSingle = () => Promise.resolve({ data: { id: "u1", monthly_call_goal: 0, monthly_policies_goal: 0, monthly_appointment_goal: 0, monthly_premium_goal: h.goal }, error: null });
      return q;
    },
  },
}));

import StatCards from "@/components/dashboard/StatCards";
import GoalProgressWidget from "@/components/dashboard/widgets/GoalProgressWidget";
import { resetDashboardSectionLanes } from "@/lib/dashboardRefresh";
import type { StatData } from "@/hooks/useDashboardStats";

const totals = (over: Record<string, number> = {}) => ({
  calls: 10, policies: 0, bookings: 0, annual_premium: 0, monthly_premium: 0, unknown_premiums: 0, talk_seconds: 0,
  workload: 0, leads: 0, estimated_duration_calls: 0, unknown_duration_calls: 0, conflicting_duration_calls: 0, ...over,
});
/** The same mapping useDashboardStats applies to one summary. */
const statData = (current: Record<string, number>, previous: Record<string, number> = {}): StatData => {
  const c = totals(current), p = totals(previous);
  return {
    performance: {
      organization_id: "00000000-0000-4000-8000-000000000001", agent_ids: null, scope: "Team", period: "month", time_zone: "UTC",
      start_at: "2026-10-01T00:00:00Z", end_at: "2026-10-11T00:00:00Z", previous_start: "2026-09-01T00:00:00Z",
      previous_end: "2026-10-01T00:00:00Z", workload_end: "2026-11-01T00:00:00Z", current: c, previous: p,
    },
    callsToday: c.calls, callsYesterday: p.calls, leadsToday: 0, leadsYesterday: 0, policiesThisMonth: c.policies,
    policiesLastMonth: p.policies, winsThisMonth: c.policies, appointmentsToday: c.workload, appointmentsYesterday: p.workload,
    callsThisMonth: c.calls, premiumThisMonth: c.annual_premium, premiumLastMonth: p.annual_premium, talkTimeMinutes: 0,
    prevLabel: "previous full month",
  };
};
const premiumCard = () => screen.getByText("Annual Premium").closest(".rounded-2xl") as HTMLElement;
const arrowOf = (card: HTMLElement) => card.querySelector("span.rounded-lg")?.textContent;
const renderCards = (stats: StatData | null, loading = false) =>
  render(<StatCards role="Admin" userId="u1" adminToggle="team" timeRange="month" stats={stats} loading={loading} />);

beforeEach(() => { resetDashboardSectionLanes(); h.current = {}; h.goal = 5000; });
afterEach(() => { cleanup(); resetDashboardSectionLanes(); });

describe("Dashboard Annual Premium card (D14)", () => {
  it("no policies: keeps the empty period's $0.00", () => {
    renderCards(statData({ policies: 0, unknown_premiums: 0, annual_premium: 0 }));
    expect(premiumCard()).toHaveTextContent("$0.00");
    expect(premiumCard()).not.toHaveTextContent("Unavailable");
  });

  it("known premiums totalling $0: a genuine $0.00", () => {
    renderCards(statData({ policies: 2, unknown_premiums: 0, annual_premium: 0 }));
    expect(premiumCard()).toHaveTextContent("$0.00");
    expect(premiumCard()).not.toHaveTextContent("Unavailable");
  });

  it("some premiums known: keeps the subtotal, its comparison and the unknown-premium note", () => {
    renderCards(statData({ policies: 3, unknown_premiums: 1, annual_premium: 2400 }, { policies: 2, annual_premium: 1200 }));
    expect(premiumCard()).toHaveTextContent("$2,400.00");
    expect(arrowOf(premiumCard())).toBe("↑");
    expect(screen.getByText(/1 policies with unknown premium/)).toBeInTheDocument();
  });

  it("every premium unknown: shows Unavailable, never $0.00, and no comparison", () => {
    renderCards(statData({ policies: 2, unknown_premiums: 2, annual_premium: 0 }, { policies: 1, annual_premium: 1200 }));
    expect(premiumCard()).toHaveTextContent("Unavailable");
    expect(premiumCard()).not.toHaveTextContent("$0.00");
    expect(arrowOf(premiumCard())).toBe("—");
  });

  it("the previous period wholly unknown: today's amount stays, the comparison is suppressed", () => {
    renderCards(statData({ policies: 1, unknown_premiums: 0, annual_premium: 1200 }, { policies: 2, unknown_premiums: 2, annual_premium: 0 }));
    expect(premiumCard()).toHaveTextContent("$1,200.00");
    expect(arrowOf(premiumCard())).toBe("—");
  });

  it("loading and failed stay their own states", () => {
    const loading = renderCards(null, true);
    expect(premiumCard().querySelector(".animate-pulse")).not.toBeNull();
    expect(premiumCard()).not.toHaveTextContent("Unavailable");
    loading.unmount();
    renderCards(null);
    expect(premiumCard()).toHaveTextContent("—");
    expect(premiumCard()).not.toHaveTextContent("Unavailable");
    expect(premiumCard()).not.toHaveTextContent("$0.00");
  });
});

describe("Dashboard Monthly Premium goal (D14)", () => {
  const renderGoal = async () => {
    render(<MemoryRouter><GoalProgressWidget userId="22222222-2222-4222-8222-222222222222" /></MemoryRouter>);
    const label = await screen.findByText("Monthly Premium");
    return label.closest("div.space-y-2") as HTMLElement;
  };

  it("every premium unknown: progress reads Unavailable with no filled bar", async () => {
    h.current = { policies: 2, unknown_premiums: 2, annual_premium: 0, monthly_premium: 0 };
    const row = await renderGoal();
    expect(row).toHaveTextContent("Unavailable / $5,000.00");
    expect(row).not.toHaveTextContent("$0.00 /");
    expect(screen.getByText(/2 policies have unknown premium; premium progress is incomplete\./)).toBeInTheDocument();
  });

  it("no policies and partial coverage keep their real amounts", async () => {
    h.current = { policies: 0, unknown_premiums: 0, monthly_premium: 0 };
    expect(await renderGoal()).toHaveTextContent("$0.00 / $5,000.00");
    cleanup(); resetDashboardSectionLanes();
    h.current = { policies: 3, unknown_premiums: 1, annual_premium: 2400, monthly_premium: 200 };
    expect(await renderGoal()).toHaveTextContent("$200.00 / $5,000.00");
  });

  it("policies sold with every premium known and totalling $0 keep a genuine $0.00", async () => {
    h.current = { policies: 2, unknown_premiums: 0, annual_premium: 0, monthly_premium: 0 };
    const row = await renderGoal();
    expect(row).toHaveTextContent("$0.00 / $5,000.00");
    expect(row).not.toHaveTextContent("Unavailable");
  });
});
