import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Milestone } from "@/lib/dashboard-milestones";
import type { MilestoneLoad } from "@/lib/dashboard-milestones-data";

/**
 * Client Milestones widget (plan §6.3, rev 1): three categories with icons, pending
 * items only, review actions only when reviews are live and never under View As,
 * keyboard-operable menus, honest incomplete reads (R4), and actions that report
 * only what the server stored.
 */

const h = vi.hoisted(() => ({
  load: vi.fn(),
  set: vi.fn(),
  clear: vi.fn(),
  call: vi.fn(() => true),
  navigate: vi.fn(),
  impersonating: false,
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/dashboard-milestones-data", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  loadClientMilestones: h.load,
  setMilestoneReview: h.set,
  clearMilestoneReview: h.clear,
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isImpersonating: h.impersonating }) }));
vi.mock("@/lib/quick-call", () => ({ dispatchQuickCall: h.call }));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<Record<string, unknown>>()), useNavigate: () => h.navigate }));

import ClientMilestonesWidget from "@/components/dashboard/widgets/ClientMilestonesWidget";
import { resetDashboardSectionLanes } from "@/lib/dashboardRefresh";

const USER = "aaaa0000-0000-4000-8000-000000000001";
const ORG = "bbbb0000-0000-4000-8000-000000000002";
const ON = { reviewsEnabled: true, firstPaymentStart: "2026-10-01" };
const OFF = { reviewsEnabled: false, firstPaymentStart: null };

function milestone(over: Partial<Milestone>): Milestone {
  return {
    key: "k", kind: "client_birthday", clientId: "cccc0000-0000-4000-8000-000000000001", clientName: "Riley Stone",
    phone: "5550001111", eventKey: "birthday", occurrenceDate: "2026-11-03", occurrenceYear: 2026, daysUntil: 5,
    status: "pending", followUp: false, reviewId: null, reviewUpdatedAt: null, remindAt: null, age: 66,
    policyYears: null, policyType: null, carrier: null, actionBlockedReason: null, ...over,
  };
}

const ITEMS: Milestone[] = [
  milestone({ key: "fp", kind: "first_payment", clientName: "Pat Lee", eventKey: "first_payment", daysUntil: -2, age: null }),
  milestone({ key: "an", kind: "policy_anniversary", clientName: "Sam Ortiz", eventKey: "primary", policyYears: 3, age: null, policyType: "Term", carrier: "Aetna" }),
  milestone({ key: "bd" }),
  milestone({ key: "done", clientName: "Done Already", status: "reviewed" }),
];
const loaded = (items: Milestone[], over: Partial<MilestoneLoad> = {}): MilestoneLoad => ({
  items, malformedPolicyClients: 0, complete: true, clientsLoaded: 3, clientsTotal: 3, ...over,
});

const mount = (props: Partial<React.ComponentProps<typeof ClientMilestonesWidget>> = {}) =>
  render(
    <MemoryRouter>
      <ClientMilestonesWidget userId={USER} role="Agent" adminToggle="my" organizationId={ORG} config={ON} onOpenDetails={vi.fn()} {...props} />
    </MemoryRouter>,
  );
const openMenu = async (name: string) => {
  fireEvent.keyDown(screen.getByRole("button", { name: `More actions for ${name}` }), { key: "Enter" });
  return screen.findByRole("menu");
};

beforeEach(() => {
  resetDashboardSectionLanes();
  h.impersonating = false;
  h.load.mockReset().mockResolvedValue(loaded(ITEMS));
  h.set.mockReset();
  h.clear.mockReset();
  h.call.mockClear();
  h.navigate.mockClear();
  h.toast.success.mockClear();
  h.toast.error.mockClear();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("ClientMilestonesWidget", () => {
  it("shows pending milestones in three recognizable categories, never reviewed ones", async () => {
    mount();
    await screen.findByText("Pat Lee");
    expect(screen.getByRole("img", { name: "Birthday" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Policy anniversary" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "First payment" })).toBeInTheDocument();
    expect(screen.queryByText("Done Already")).not.toBeInTheDocument();
    expect(screen.getByText(/^3-year policy anniversary · .* · Term · Aetna$/)).toBeInTheDocument();
    expect(screen.getByText(/^Draft date was .* · not yet reviewed$/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/renewal|expir|overdue|missed|failed|paid/i);
    const group = screen.getByRole("group", { name: "Milestone category" });
    fireEvent.click(within(group).getByRole("button", { name: "Anniversaries (1)" }));
    expect(screen.queryByText("Riley Stone")).not.toBeInTheDocument();
    expect(screen.getByText("Sam Ortiz")).toBeInTheDocument();
  });

  it("loads the viewer's scope through the list rule, with a Team Leader note in Team perspective", async () => {
    mount({ role: "Team Leader", adminToggle: "team" });
    await screen.findByText("Pat Lee");
    expect(h.load.mock.calls[0][0]).toEqual({ userId: USER, organizationId: ORG, isFiltered: true });
    expect(h.load.mock.calls[0][2]).toBe(30);
    expect(screen.getByText(/^Showing your own client milestones\./)).toBeInTheDocument();
  });

  it("offers review actions only when reviews are live, operable from the keyboard", async () => {
    const view = mount({ config: OFF });
    await screen.findByText("Riley Stone");
    let menu = await openMenu("Riley Stone");
    expect(within(menu).getByRole("menuitem", { name: /View contact/ })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: /Mark reviewed/ })).not.toBeInTheDocument();
    view.unmount();
    resetDashboardSectionLanes();

    mount();
    await screen.findByText("Riley Stone");
    menu = await openMenu("Riley Stone");
    expect(within(menu).getByRole("menuitem", { name: /Mark reviewed.*client record isn't changed/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /Remind later/ })).toBeInTheDocument();
  });

  it("never offers review actions while viewing as another user", async () => {
    h.impersonating = true;
    mount();
    await screen.findByText("Riley Stone");
    const menu = await openMenu("Riley Stone");
    expect(within(menu).queryByRole("menuitem", { name: /Mark reviewed/ })).not.toBeInTheDocument();
  });

  it("Mark reviewed stores the event identity, then reloads; Undo restores only that stored row", async () => {
    const stored = { id: "dddd0000-0000-4000-8000-000000000004", updated_at: "2026-10-29T19:00:00Z" };
    h.set.mockResolvedValue(stored);
    h.clear.mockResolvedValue(undefined);
    mount();
    await screen.findByText("Riley Stone");
    const menu = await openMenu("Riley Stone");
    await act(async () => { fireEvent.click(within(menu).getByRole("menuitem", { name: /Mark reviewed/ })); });
    await waitFor(() => expect(h.set).toHaveBeenCalledTimes(1));
    expect(h.set.mock.calls[0][0]).toEqual({
      kind: "client_birthday", clientId: ITEMS[2].clientId, eventKey: "birthday", occurrenceDate: "2026-11-03", state: "reviewed", remindAt: null,
    });
    await waitFor(() => expect(h.load).toHaveBeenCalledTimes(2));
    const [, options] = h.toast.success.mock.calls[0];
    await act(async () => { options.action.onClick(); });
    expect(h.clear).toHaveBeenCalledWith({ id: stored.id, updatedAt: stored.updated_at });
  });

  it("a failed action says so and changes nothing (no reload, no success)", async () => {
    const { MilestoneActionError } = await import("@/lib/dashboard-milestones-data");
    h.set.mockRejectedValue(new MilestoneActionError("Couldn't update this reminder. Please try again."));
    mount();
    await screen.findByText("Riley Stone");
    const menu = await openMenu("Riley Stone");
    await act(async () => { fireEvent.click(within(menu).getByRole("menuitem", { name: /Mark reviewed/ })); });
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("Couldn't update this reminder. Please try again."));
    expect(h.toast.success).not.toHaveBeenCalled();
    expect(h.load).toHaveBeenCalledTimes(1);
  });

  it("calls the client (never a lead) and reports a call that could not start", async () => {
    mount();
    await screen.findByText("Riley Stone");
    fireEvent.click(screen.getByRole("button", { name: "Call Riley Stone" }));
    expect(h.call).toHaveBeenCalledWith({ contactId: ITEMS[2].clientId, name: "Riley Stone", phone: "5550001111", type: "client" });
    h.call.mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: "Call Pat Lee" }));
    expect(h.toast.error).toHaveBeenCalledWith("No phone number on file for Pat Lee.");
  });

  it("an incomplete read says so, counts are lower bounds, and it never claims there are none (R4)", async () => {
    h.load.mockResolvedValue(loaded([ITEMS[2]], { complete: false, clientsLoaded: 5000, clientsTotal: 6212 }));
    const view = mount();
    expect(await screen.findByText(/Milestones from the first 5,000 of 6,212 clients\. Some milestones may be missing\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All (1+)" })).toBeInTheDocument();
    view.unmount();
    resetDashboardSectionLanes();

    h.load.mockResolvedValue(loaded([], { complete: false, clientsLoaded: 5000, clientsTotal: 6212 }));
    mount();
    expect(await screen.findByText(/Some milestones may be missing/)).toBeInTheDocument();
    expect(screen.queryByText("No upcoming client milestones")).not.toBeInTheDocument();
  });

  it("shows the empty state only after a complete read, and a failure is never empty", async () => {
    h.load.mockResolvedValue(loaded([]));
    const view = mount();
    expect(await screen.findByText("No upcoming client milestones")).toBeInTheDocument();
    view.unmount();
    resetDashboardSectionLanes();
    h.load.mockRejectedValue(new Error("statement timeout"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    mount();
    expect(await screen.findByText("Couldn't load client milestones")).toBeInTheDocument();
    expect(screen.queryByText("No upcoming client milestones")).not.toBeInTheDocument();
  });
});
