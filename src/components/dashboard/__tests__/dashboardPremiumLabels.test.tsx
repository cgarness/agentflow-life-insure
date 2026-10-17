/**
 * V2 simple labels on the Dashboard: the premium card reads "Annual Premium", the drill-downs are titled by
 * what they count ("Annual Premium", "Scheduled Appointments") and a win row reads "$X annual premium" or
 * "Premium unknown" — never "Premium unknown annualized". Display wording only; ids and data are unchanged.
 */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("react-router-dom", () => ({ useNavigate: () => () => {} }));
vi.mock("framer-motion", () => ({
  motion: { div: (p: React.HTMLAttributes<HTMLDivElement>) => <div {...p} /> },
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, profile: { id: "u1", organization_id: "org-1" }, realProfile: { id: "u1", organization_id: "org-1" } }) }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ getDataScope: () => "all" }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({}) } }));
vi.mock("@/lib/performanceSummary", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  loadPerformanceDetails: async () => ({
    rows: io.rows, start_at: "2026-10-01T00:00:00Z", end_at: "2026-10-11T00:00:00Z", workload_end: "2026-11-01T00:00:00Z",
    time_zone: "UTC", scope: "Team", organization_id: "org-1",
  }),
}));

import StatCards from "@/components/dashboard/StatCards";
import DashboardDetailModal from "@/components/dashboard/DashboardDetailModal";
import type { StatData } from "@/hooks/useDashboardStats";

afterEach(cleanup);

const totals = (over: Record<string, number> = {}) => ({
  calls: 10, policies: 2, bookings: 3, annual_premium: 2400, monthly_premium: 200, unknown_premiums: 0, talk_seconds: 600,
  workload: 1, leads: 0, estimated_duration_calls: 0, unknown_duration_calls: 0, conflicting_duration_calls: 0, ...over,
});

/** The same mapping useDashboardStats applies to one summary. */
const statData = (current: Record<string, number> = {}, previous: Record<string, number> = {}): StatData => {
  const c = totals(current), p = totals(previous);
  return {
    performance: {
      organization_id: "00000000-0000-4000-8000-000000000001", agent_ids: null, scope: "Team", period: "month", time_zone: "UTC",
      start_at: "2026-10-01T00:00:00Z", end_at: "2026-10-11T00:00:00Z", previous_start: "2026-09-01T00:00:00Z",
      previous_end: "2026-10-01T00:00:00Z", workload_end: "2026-11-01T00:00:00Z", current: c, previous: p,
    },
    callsToday: c.calls, callsYesterday: p.calls, leadsToday: c.leads, leadsYesterday: p.leads,
    policiesThisMonth: c.policies, policiesLastMonth: p.policies, winsThisMonth: c.policies,
    appointmentsToday: c.workload, appointmentsYesterday: p.workload, callsThisMonth: c.calls,
    premiumThisMonth: c.annual_premium, premiumLastMonth: p.annual_premium, talkTimeMinutes: c.talk_seconds / 60,
    prevLabel: "previous full month",
  };
};

const card = (label: string) => screen.getByText(label).closest(".rounded-2xl") as HTMLElement;

describe("Dashboard premium card label", () => {
  it("reads 'Annual Premium' beside the distinct 'Scheduled Appointments' workload card", () => {
    render(<StatCards role="Admin" userId="u1" adminToggle="team" timeRange="month" stats={statData()} />);
    expect(card("Annual Premium")).toHaveTextContent("$2,400.00");
    expect(screen.queryByText("Annual Premium Sold")).not.toBeInTheDocument();
    expect(screen.getByText("Scheduled Appointments (month)")).toBeInTheDocument();
  });
});

describe("Dashboard drill-down wording", () => {
  it("titles the premium drill-down 'Annual Premium' and reads each win's annual premium or 'Premium unknown'", async () => {
    io.rows = [
      { id: "00000000-0000-4000-8000-0000000000a1", contact_name: "Known Win", policy_type: "Term", annual_premium: 1200 },
      { id: "00000000-0000-4000-8000-0000000000a2", contact_name: "Unknown Win", policy_type: "Whole Life", annual_premium: null },
    ];
    render(<DashboardDetailModal isOpen onClose={() => {}} type="premium_sold" userId="u1" role="Admin" adminToggle="team" timeRange="month" />);
    expect(screen.getByText("Annual Premium (month)")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Closed: Term • $1,200.00 annual premium")).toBeInTheDocument());
    expect(screen.getByText("Closed: Whole Life • Premium unknown")).toBeInTheDocument();
    expect(screen.queryByText(/annualized/i)).not.toBeInTheDocument();
    // The subtitle names whose records are listed: the server scope only, no zone or as-of time (Part B, B1-05).
    expect(await screen.findByText("Team")).toBeInTheDocument();
    expect(screen.queryByText(/UTC|As of/)).toBeNull();
  });

  it("shows each sale's Sold Date as a calendar date, and none for a sale without one", async () => {
    io.rows = [
      { id: "00000000-0000-4000-8000-0000000000a3", contact_name: "Dated Win", policy_type: "Term", annual_premium: 499.68, sold_date: "2026-10-15", entered_at: "2026-10-16T19:51:00+00:00" },
      { id: "00000000-0000-4000-8000-0000000000a4", contact_name: "Undated Win", policy_type: "Whole Life", annual_premium: 360, sold_date: null, entered_at: "2026-10-16T19:53:00+00:00" },
    ];
    render(<DashboardDetailModal isOpen onClose={() => {}} type="premium_sold" userId="u1" role="Admin" adminToggle="team" timeRange="month" />);
    await waitFor(() => expect(screen.getByText("Closed: Term • $499.68 annual premium • Sold 10/15/2026")).toBeInTheDocument());
    expect(screen.getByText("Closed: Whole Life • $360.00 annual premium")).toBeInTheDocument();
  });

  it("lists policies sold with their Sold Date", async () => {
    io.rows = [{ id: "00000000-0000-4000-8000-0000000000a5", contact_name: "Dated Win", policy_type: "Final Expense", premium_amount: 58.45, sold_date: "2026-10-15" }];
    render(<DashboardDetailModal isOpen onClose={() => {}} type="policies_sold" userId="u1" role="Admin" adminToggle="team" timeRange="month" />);
    await waitFor(() => expect(screen.getByText("Final Expense • $58.45 monthly • Sold 10/15/2026")).toBeInTheDocument());
  });

  it("titles the workload drill-down 'Scheduled Appointments'", () => {
    io.rows = [];
    render(<DashboardDetailModal isOpen onClose={() => {}} type="appointments" userId="u1" role="Admin" adminToggle="team" timeRange="week" />);
    expect(screen.getByText("Scheduled Appointments (week)")).toBeInTheDocument();
    expect(screen.queryByText(/Appointments Detail/)).not.toBeInTheDocument();
  });

  it("closes from the footer 'Close' and the named header button, with no engine commentary (Part B, B1-03/B1-04)", async () => {
    io.rows = [];
    const onClose = vi.fn();
    render(<DashboardDetailModal isOpen onClose={onClose} type="appointments" userId="u1" role="Admin" adminToggle="team" timeRange="week" />);
    await waitFor(() => expect(screen.getByText("No records found")).toBeInTheDocument());
    const closes = screen.getAllByRole("button", { name: "Close" });
    expect(closes).toHaveLength(2);
    const footerClose = screen.getByText("Close", { selector: "button" });
    fireEvent.click(footerClose);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(closes.find((button) => button !== footerClose)!);
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Dismiss View")).not.toBeInTheDocument();
    expect(screen.queryByText(/Analytics Engine|Batch Size/)).not.toBeInTheDocument();
  });
});
