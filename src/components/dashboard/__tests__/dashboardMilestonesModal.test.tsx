import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Milestone } from "@/lib/dashboard-milestones";

/** Client Milestones detail (plan §6.4): 90-day window, status filters, Restore, Retry. */

const h = vi.hoisted(() => ({ load: vi.fn(), clear: vi.fn(), set: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/dashboard-milestones-data", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  loadClientMilestones: h.load,
  clearMilestoneReview: h.clear,
  setMilestoneReview: h.set,
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isImpersonating: false }) }));
vi.mock("@/lib/quick-call", () => ({ dispatchQuickCall: () => true }));
vi.mock("sonner", () => ({ toast: h.toast }));

import DashboardMilestonesModal from "@/components/dashboard/DashboardMilestonesModal";

const USER = "aaaa0000-0000-4000-8000-000000000001";
const ORG = "bbbb0000-0000-4000-8000-000000000002";
const ON = { reviewsEnabled: true, firstPaymentStart: "2026-10-01" };

const m = (over: Partial<Milestone>): Milestone => ({
  key: over.key ?? "k", kind: "policy_anniversary", clientId: "cccc0000-0000-4000-8000-000000000001", clientName: "Sam Ortiz",
  phone: "", eventKey: "primary", occurrenceDate: "2027-01-20", occurrenceYear: 2027, daysUntil: 83, status: "pending",
  followUp: false, reviewId: null, reviewUpdatedAt: null, remindAt: null, age: null, policyYears: 4, policyType: null,
  carrier: null, actionBlockedReason: null, ...over,
});
const ITEMS = [
  m({ key: "a" }),
  m({ key: "b", clientName: "Snoozed Sue", status: "snoozed", remindAt: "2026-11-05T07:00:00Z", reviewId: "dddd0000-0000-4000-8000-000000000001", reviewUpdatedAt: "2026-10-29T19:00:00Z" }),
  m({ key: "c", clientName: "Followed Fay", followUp: true, daysUntil: -9 }),
];

const mount = () =>
  render(
    <MemoryRouter>
      <DashboardMilestonesModal open onClose={vi.fn()} userId={USER} role="Admin" adminToggle="team" organizationId={ORG} config={ON} />
    </MemoryRouter>,
  );

beforeEach(() => {
  h.load.mockReset().mockResolvedValue({ items: ITEMS, malformedPolicyClients: 0, complete: true, clientsLoaded: 2, clientsTotal: 2 });
  h.clear.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("DashboardMilestonesModal", () => {
  it("loads the 90-day detail window for the opener's scope and lists pending items first", async () => {
    mount();
    await screen.findByText("Sam Ortiz");
    expect(h.load.mock.calls[0][0]).toEqual({ userId: USER, organizationId: ORG, isFiltered: false });
    expect(h.load.mock.calls[0][2]).toBe(90);
    expect(screen.getByRole("dialog", { name: "Client Milestones" })).toBeInTheDocument();
    expect(screen.getByText(/Anniversaries: next 90 days/)).toBeInTheDocument();
    expect(screen.getByText("Followed Fay")).toBeInTheDocument();
    expect(screen.getByText(/^Follow-up · 4-year policy anniversary was/)).toBeInTheDocument();
    expect(screen.queryByText("Snoozed Sue")).not.toBeInTheDocument();
  });

  it("filters by status and restores a snoozed milestone through the conditional Undo", async () => {
    mount();
    await screen.findByText("Sam Ortiz");
    expect(screen.getByRole("button", { name: /^Dismissed \(/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Snoozed (1)" }));
    expect(screen.getByText("Snoozed Sue")).toBeInTheDocument();
    expect(screen.getByText(/^Reminds you /)).toBeInTheDocument();
    // Undo is a visible button on a dismissed or snoozed row (no hover, no menu needed).
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Undo for Snoozed Sue" })); });
    expect(h.clear).toHaveBeenCalledWith({ id: "dddd0000-0000-4000-8000-000000000001", updatedAt: "2026-10-29T19:00:00Z" });
    await waitFor(() => expect(h.load).toHaveBeenCalledTimes(2));
  });

  it("a failed load offers Retry and never the empty message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.load.mockRejectedValueOnce(new Error("timeout"));
    mount();
    expect(await screen.findByText("Couldn't load these records")).toBeInTheDocument();
    expect(screen.queryByText("No client milestones here")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Sam Ortiz")).toBeInTheDocument();
  });
});
