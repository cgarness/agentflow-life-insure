import React from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Polish V2 §6 — Team-mode context on records the viewer can already see: owner, assignee, writing
 * agent and campaign names, resolved in one organization-scoped batch. A Team Leader's lists stay
 * their own (the list rule is unchanged); a failed name lookup never invents a name.
 */
const h = vi.hoisted(() => ({ db: null as any, page: vi.fn(), total: vi.fn() }));
vi.mock("@/integrations/supabase/client", async () => {
  const { makeFakeSupabase } = await import("@/test/fakePostgrest");
  return { supabase: { from: (t: string) => makeFakeSupabase(h.db).from(t) } };
});
vi.mock("@/lib/dashboard-callbacks", async (orig) => ({
  ...(await orig<Record<string, unknown>>()), fetchCallbackPage: h.page, fetchCallbackTotal: h.total,
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { organization_id: ORG }, isImpersonating: false }) }));
vi.mock("@/lib/quick-call", () => ({ dispatchQuickCall: () => true }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { createFakeDb } from "@/test/fakePostgrest";
import CallbacksWidget from "@/components/dashboard/widgets/CallbacksWidget";
import AppointmentsWidget from "@/components/dashboard/widgets/AppointmentsWidget";
import { DashboardRecordRow } from "@/components/dashboard/DashboardRecordRow";
import { resetDashboardSectionLanes } from "@/lib/dashboardRefresh";

const ME = "11111111-1111-4111-8111-111111111111";
const ALEX = "22222222-2222-4222-8222-222222222222";
const SAM = "33333333-3333-4333-8333-333333333333";
const ORG = "a0000000-0000-4000-8000-00000000000a";
const CAMPAIGN = "20000000-0000-4000-8000-000000000001";
const OFF = { clearancesEnabled: false };
const row = (n: number, ownerId: string, campaignId: string | null) => ({
  key: `campaign:${n}`, source: "campaign", sourceRowId: `${n}`, dueAt: new Date(Date.now() - n * 60_000).toISOString(),
  contactId: null, contactType: null, contactName: `Lead ${n}`, phone: "", note: null, canAct: false,
  blockedReason: "No linked contact record is available.", ownerId, campaignId, clearance: null,
});

beforeEach(() => {
  resetDashboardSectionLanes();
  h.db = createFakeDb({
    profiles: [
      { id: ALEX, organization_id: ORG, first_name: "Alex", last_name: "Rivera" },
      { id: SAM, organization_id: ORG, first_name: "Sam", last_name: "Lee" },
    ],
    campaigns: [{ id: CAMPAIGN, organization_id: ORG, name: "Final Expense Q4" }],
    appointments: [
      { id: "a1", title: "Review", contact_name: "Pat Lee", start_time: new Date().toISOString(), type: "Sales Call", status: "Scheduled", user_id: null, created_by: SAM },
    ],
  });
  h.page.mockReset().mockResolvedValue([row(1, ALEX, CAMPAIGN), row(2, SAM, null)]);
  h.total.mockReset().mockResolvedValue(2);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { cleanup(); resetDashboardSectionLanes(); vi.restoreAllMocks(); });

const mountCallbacks = (role: string, adminToggle: "team" | "my") =>
  render(<MemoryRouter><CallbacksWidget userId={ME} role={role} adminToggle={adminToggle} config={OFF} /></MemoryRouter>);

describe("Callbacks — an Admin's Team view names the owner and the campaign", () => {
  it("shows owner chips and campaign names from ONE organization-scoped batch each", async () => {
    mountCallbacks("Admin", "team");
    const first = (await screen.findByText("Lead 1")).closest("li")!;
    expect(within(first).getByText("Alex Rivera")).toBeInTheDocument();
    expect(within(first).getByText(/Campaign · Final Expense Q4/)).toBeInTheDocument();
    const second = screen.getByText("Lead 2").closest("li")!;
    expect(within(second).getByText("Sam Lee")).toBeInTheDocument();
    const reads = h.db.queries.filter((q: any) => q.table === "profiles" || q.table === "campaigns");
    expect(reads).toHaveLength(2);
    expect(reads.every((q: any) => q.filters.includes(`eq:organization_id=${ORG}`))).toBe(true);
    expect(h.page.mock.calls[0][0]).toMatchObject({ isFiltered: false });
  });

  it("a Team Leader in Team view keeps their own list (no widening, no owner lookups) and the disclosure", async () => {
    mountCallbacks("Team Leader", "team");
    await screen.findByText("Lead 1");
    expect(h.page.mock.calls[0][0]).toMatchObject({ isFiltered: true, userId: ME });
    expect(screen.getByText(/^Showing your own callbacks\./)).toBeInTheDocument();
    expect(screen.queryByText("Alex Rivera")).not.toBeInTheDocument();
    expect(h.db.queries.some((q: any) => q.table === "profiles")).toBe(false);
  });

  it("a failed name lookup says so and never invents a name; the rows still show", async () => {
    h.db.failWhen = (q: any) => (q.table === "profiles" ? { message: "timeout" } : null);
    mountCallbacks("Admin", "team");
    const first = (await screen.findByText("Lead 1")).closest("li")!;
    expect(within(first).getByText("Name unavailable")).toBeInTheDocument();
    expect(screen.getByText("Some agent names couldn't be loaded.")).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load callbacks/)).not.toBeInTheDocument();
  });
});

describe("Schedule and KPI records", () => {
  it("Schedule in an Admin's Team view names who the appointment is assigned to (user_id, else the scheduler)", async () => {
    render(<MemoryRouter><AppointmentsWidget userId={ME} role="Admin" adminToggle="team" /></MemoryRouter>);
    const appt = (await screen.findByText("Pat Lee")).closest("li")!;
    await waitFor(() => expect(within(appt).getByText("Sam Lee")).toBeInTheDocument());
    expect(within(appt).getByText("Scheduled")).toBeInTheDocument();
    expect(within(appt).getByRole("button", { name: "Open Pat Lee in Calendar" })).toBeInTheDocument();
  });

  it("Policies Sold rows show the writing agent only when names were provided (Team view)", () => {
    const people = { names: new Map([[ALEX, { id: ALEX, name: "Alex Rivera", initials: "AR" }]]), unavailable: false };
    const item = { id: "w1", contact_name: "Casey Client", policy_type: "Term", premium_amount: 50, sold_date: "2026-10-15", agent_id: ALEX };
    const { rerender } = render(<ul><DashboardRecordRow type="policies_sold" tone="green" item={item} canOpen onView={vi.fn()} onCall={vi.fn()} people={people} /></ul>);
    expect(screen.getByText("Alex Rivera")).toBeInTheDocument();
    rerender(<ul><DashboardRecordRow type="policies_sold" tone="green" item={item} canOpen onView={vi.fn()} onCall={vi.fn()} people={null} /></ul>);
    expect(screen.queryByText("Alex Rivera")).not.toBeInTheDocument();
  });
});
