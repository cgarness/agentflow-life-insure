import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Polish V2 §3.8 — Clear on the Callbacks and Missed Calls widgets: a visible, keyboard-reachable
 * button; the source-qualified identity and the exact occurrence string are sent; one request per
 * row at a time; nothing is hidden until the server stored it; Undo; focus moves to the next row;
 * no actions (and no clearance read) under View As or with the switch off.
 */
const h = vi.hoisted(() => ({
  loadCb: vi.fn(), loadMc: vi.fn(), clear: vi.fn(), undo: vi.fn(), impersonating: false,
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/dashboard-widget-loads", async (orig) => ({
  ...(await orig<Record<string, unknown>>()), loadCallbackWidget: h.loadCb, loadMissedCallWidget: h.loadMc,
}));
vi.mock("@/lib/dashboard-attention", async (orig) => ({
  ...(await orig<Record<string, unknown>>()), clearAttentionItem: h.clear, undoAttentionClear: h.undo,
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { organization_id: ORG }, isImpersonating: h.impersonating }) }));
vi.mock("@/lib/quick-call", () => ({ dispatchQuickCall: () => true }));
vi.mock("@/components/voicemail/VoicemailPlayer", () => ({ VoicemailPlayer: () => null }));
vi.mock("sonner", () => ({ toast: h.toast }));

import CallbacksWidget from "@/components/dashboard/widgets/CallbacksWidget";
import MissedCallsWidget from "@/components/dashboard/widgets/MissedCallsWidget";
import { AttentionActionError } from "@/lib/dashboard-attention";
import { EMPTY_PEOPLE } from "@/lib/dashboard-people";
import { resetDashboardSectionLanes } from "@/lib/dashboardRefresh";
import { describeInboundCallOutcome } from "@/lib/inbound-call-labels";

const USER = "11111111-1111-4111-8111-111111111111";
const ORG = "a0000000-0000-4000-8000-00000000000a";
const ON = { clearancesEnabled: true };
const OFF = { clearancesEnabled: false };
/** Fixed, microsecond-precise due times (as PostgREST returns them). */
const due = (n: number) => `2026-10-29T1${n}:00:00.123456+00:00`;

const cb = (n: number, over: Record<string, unknown> = {}) => ({
  key: `campaign:30000000-0000-4000-8000-00000000000${n}`, source: "campaign", sourceRowId: `30000000-0000-4000-8000-00000000000${n}`,
  dueAt: due(n), contactId: `1ead0000-0000-4000-8000-00000000000${n}`, contactType: "lead", contactName: `Pat ${n}`,
  phone: "5551110000", note: null, canAct: true, blockedReason: null, ownerId: USER, campaignId: null, clearance: null, ...over,
});
const cbData = (rows: any[], cleared = 0) => ({
  buckets: { overdue: rows, dueToday: [], dueSoon: [] }, bucketCounts: { overdue: String(rows.length), dueToday: "0", dueSoon: "0" },
  totalCount: rows.length, clearedCount: cleared, people: EMPTY_PEOPLE, campaigns: new Map(),
});
const mc = (n: number, over: Record<string, unknown> = {}) => {
  const base = {
    key: `missed_call:40000000-0000-4000-8000-00000000000${n}`, id: `40000000-0000-4000-8000-00000000000${n}`,
    contactId: null, contactName: "Unknown", createdAt: "2026-10-29T18:00:00.123456+00:00", phone: "+15550001111",
    contactType: null, voicemailId: null, missed_for_agent_id: USER, missed_recipient_ids: [USER], routed_agent_ids: null,
    answered_by_agent_id: null, clearance: null, ...over,
  };
  return { ...base, outcome: describeInboundCallOutcome({ direction: "inbound", is_missed: true, missed_reason: "no_answer" }) };
};

const renderCallbacks = (config = ON) =>
  render(<MemoryRouter><CallbacksWidget userId={USER} role="Agent" adminToggle="my" config={config} onOpenDetails={vi.fn()} /></MemoryRouter>);

beforeEach(() => {
  resetDashboardSectionLanes();
  h.impersonating = false;
  h.loadCb.mockReset().mockResolvedValue(cbData([cb(1), cb(2)]));
  h.loadMc.mockReset().mockResolvedValue({ items: [mc(1)], totalCount: 1, clearedCount: 0, people: EMPTY_PEOPLE });
  h.clear.mockReset();
  h.undo.mockReset();
  h.toast.success.mockClear();
  h.toast.error.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { cleanup(); resetDashboardSectionLanes(); vi.restoreAllMocks(); });

describe("Callbacks widget — Clear", () => {
  it("is a visible native button with an accessible name and description (never hover-only)", async () => {
    renderCallbacks();
    const button = await screen.findByRole("button", { name: "Clear callback for Pat 1" });
    expect(button.tagName).toBe("BUTTON");
    expect(button).toBeVisible();
    expect(button).not.toBeDisabled();
    expect(button).toHaveTextContent("Clear");
    expect(button).toHaveAccessibleDescription(/Dashboard only.*stays scheduled/);
    button.focus();
    expect(document.activeElement).toBe(button);
    expect(h.loadCb.mock.calls[0][0]).toMatchObject({ clearancesEnabled: true, organizationId: ORG, isFiltered: true });
  });

  it("sends the callback's own source id and the exact due string, reloads only after the server stored it, and Undo restores it", async () => {
    const stored = { id: "d0000000-0000-4000-8000-000000000001", sourceType: "campaign_callback", sourceId: cb(1).sourceRowId, occurrenceAt: cb(1).dueAt, clearedAt: "2026-10-29T19:00:00.000001+00:00" };
    let release!: () => void;
    h.clear.mockImplementation(() => new Promise((resolve) => (release = () => resolve(stored))));
    h.undo.mockResolvedValue(undefined);
    renderCallbacks();
    const button = await screen.findByRole("button", { name: "Clear callback for Pat 1" });
    fireEvent.click(button);
    fireEvent.click(button); // a double click while the first is in flight
    expect(h.clear).toHaveBeenCalledTimes(1);
    expect(h.clear).toHaveBeenCalledWith({ sourceType: "campaign_callback", sourceId: cb(1).sourceRowId, expectedOccurrenceAt: cb(1).dueAt });
    expect(button).toHaveAttribute("aria-busy", "true");
    // Nothing is hidden before the server answered.
    expect(screen.getByText("Pat 1")).toBeInTheDocument();
    expect(h.loadCb).toHaveBeenCalledTimes(1);
    h.loadCb.mockResolvedValue(cbData([cb(2)], 1));
    await act(async () => release());
    await waitFor(() => expect(screen.queryByText("Pat 1")).not.toBeInTheDocument());
    expect(h.loadCb).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: /1 cleared/ })).toBeInTheDocument();
    const [message, options] = h.toast.success.mock.calls[0];
    expect(message).toBe("Callback cleared: Pat 1");
    expect(options.description).toBe("Hidden from your Dashboard only.");
    await act(async () => options.action.onClick());
    expect(h.undo).toHaveBeenCalledWith({ id: stored.id, clearedAt: stored.clearedAt });
  });

  it("moves keyboard focus to the next row's primary action when the cleared row leaves", async () => {
    h.clear.mockResolvedValue({ id: "d0000000-0000-4000-8000-000000000001", sourceType: "campaign_callback", sourceId: cb(1).sourceRowId, occurrenceAt: cb(1).dueAt, clearedAt: "2026-10-29T19:00:00Z" });
    renderCallbacks();
    const button = await screen.findByRole("button", { name: "Clear callback for Pat 1" });
    h.loadCb.mockResolvedValue(cbData([cb(2)], 1));
    button.focus();
    await act(async () => { fireEvent.click(button); });
    await waitFor(() => expect(screen.queryByText("Pat 1")).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Call Pat 2" })));
  });

  it("a refused clear says why, keeps the row and reloads nothing", async () => {
    h.clear.mockRejectedValue(new AttentionActionError("changed"));
    renderCallbacks();
    fireEvent.click(await screen.findByRole("button", { name: "Clear callback for Pat 1" }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("This callback was rescheduled. Refresh to see it."));
    expect(h.toast.success).not.toHaveBeenCalled();
    expect(screen.getByText("Pat 1")).toBeInTheDocument();
    expect(h.loadCb).toHaveBeenCalledTimes(1);
  });

  it("no Clear and no clearance read while viewing as another user, or with the switch off", async () => {
    h.impersonating = true;
    const view = renderCallbacks();
    await screen.findByText("Pat 1");
    expect(screen.queryByRole("button", { name: /^Clear callback/ })).not.toBeInTheDocument();
    expect(h.loadCb.mock.calls[0][0]).toMatchObject({ clearancesEnabled: false });
    view.unmount();
    resetDashboardSectionLanes();
    h.impersonating = false;
    h.loadCb.mockClear();
    renderCallbacks(OFF);
    await screen.findByText("Pat 1");
    expect(screen.queryByRole("button", { name: /^Clear callback/ })).not.toBeInTheDocument();
    expect(h.loadCb.mock.calls[0][0]).toMatchObject({ clearancesEnabled: false });
  });
});

describe("Missed Calls widget — Clear", () => {
  it("clears an Unknown, unlinked caller by its CALL id with the exact microsecond time; Call back stays blocked with a reason", async () => {
    h.clear.mockResolvedValue({ id: "d0000000-0000-4000-8000-000000000002", sourceType: "missed_call", sourceId: mc(1).id, occurrenceAt: mc(1).createdAt, clearedAt: "2026-10-29T19:00:00Z" });
    render(<MemoryRouter><MissedCallsWidget userId={USER} role="Agent" adminToggle="my" config={ON} /></MemoryRouter>);
    const callBack = await screen.findByRole("button", { name: "Call back +15550001111" });
    expect(callBack).toHaveAttribute("aria-disabled", "true");
    expect(callBack).toHaveAccessibleDescription(/no linked contact record/);
    fireEvent.click(screen.getByRole("button", { name: "Clear missed call from +15550001111" }));
    await waitFor(() => expect(h.clear).toHaveBeenCalledWith({
      sourceType: "missed_call", sourceId: "40000000-0000-4000-8000-000000000001", expectedOccurrenceAt: "2026-10-29T18:00:00.123456+00:00",
    }));
    expect(h.toast.success.mock.calls[0][0]).toBe("Missed call cleared: +15550001111");
  });
});
