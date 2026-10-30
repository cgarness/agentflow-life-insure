import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Polish V2 §3.5.5 / §3.7 — the Missed Calls (and Callbacks) detail view through the real container
 * and feed: exact totals, paging by loaded ACTIVE rows, a refresh in place after Clear (rows kept
 * on screen, no spinner), the Cleared view with Undo, and routing-based recipients in Team view.
 */
const h = vi.hoisted(() => ({
  page: vi.fn(), counts: vi.fn(), cleared: vi.fn(), read: vi.fn(), clear: vi.fn(), undo: vi.fn(), people: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/dashboard-missed-calls", async (orig) => ({
  ...(await orig<Record<string, unknown>>()), fetchMissedCallPage: h.page, fetchMissedCallCounts: h.counts, fetchClearedMissedCalls: h.cleared,
}));
vi.mock("@/lib/dashboard-attention", async (orig) => ({
  ...(await orig<Record<string, unknown>>()), readOwnClearances: h.read, clearAttentionItem: h.clear, undoAttentionClear: h.undo,
}));
vi.mock("@/lib/dashboard-people", async (orig) => ({ ...(await orig<Record<string, unknown>>()), resolvePeople: h.people }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: USER }, profile: { organization_id: ORG }, isImpersonating: false }) }));
vi.mock("@/lib/quick-call", () => ({ dispatchQuickCall: () => true }));
vi.mock("@/components/voicemail/VoicemailPlayer", () => ({ VoicemailPlayer: ({ voicemailId }: { voicemailId: string }) => <div data-testid="vm" data-id={voicemailId} /> }));
vi.mock("sonner", () => ({ toast: h.toast }));

import DashboardAttentionModal from "@/components/dashboard/DashboardAttentionModal";
import { AttentionExclusions } from "@/lib/dashboard-attention";
import { describeInboundCallOutcome } from "@/lib/inbound-call-labels";

const USER = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";
const ORG = "a0000000-0000-4000-8000-00000000000a";
const item = (n: number, over: Record<string, any> = {}) => {
  const row = {
    key: `missed_call:4000000${n}-0000-4000-8000-000000000000`, id: `4000000${n}-0000-4000-8000-000000000000`,
    contactId: null, contactName: `Caller ${n}`, createdAt: `2026-10-29T1${n}:00:00.000001+00:00`, phone: "+15550001111",
    contactType: null, voicemailId: null, missed_for_agent_id: USER, missed_recipient_ids: [USER], routed_agent_ids: null,
    answered_by_agent_id: null, clearance: null, missed_reason: "no_answer", outcome_raw: null, ...over,
  };
  return { ...row, outcome: describeInboundCallOutcome({ direction: "inbound", is_missed: true, missed_reason: row.missed_reason, outcome: row.outcome_raw, voicemail_id: row.voicemailId }) };
};
const twenty = Array.from({ length: 20 }, (_, i) => item(i % 10, { key: `k${i}`, id: `4000${String(i).padStart(4, "0")}-0000-4000-8000-000000000000`, contactName: `Caller ${i}` }));

const mount = (props: Partial<React.ComponentProps<typeof DashboardAttentionModal>> = {}) =>
  render(
    <MemoryRouter>
      <DashboardAttentionModal open onClose={vi.fn()} kind="missed_calls" userId={USER} isFiltered scopeNote={null}
        config={{ clearancesEnabled: true }} {...props} />
    </MemoryRouter>,
  );

beforeEach(() => {
  h.read.mockReset().mockResolvedValue(new AttentionExclusions([]));
  h.page.mockReset().mockImplementation(async (scope: any) => twenty.slice(scope.offset ?? 0, (scope.offset ?? 0) + scope.pageSize));
  h.counts.mockReset().mockResolvedValue({ active: 33, cleared: 2 });
  h.cleared.mockReset().mockResolvedValue([item(8, { contactName: "Cleared Cal", clearance: { id: "d1", sourceType: "missed_call", sourceId: "x", occurrenceAt: "o", clearedAt: "2026-10-29T19:00:00Z" } })]);
  h.clear.mockReset();
  h.undo.mockReset().mockResolvedValue(undefined);
  h.people.mockReset().mockResolvedValue({ names: new Map([[AGENT, { id: AGENT, name: "Alex Rivera", initials: "AR" }]]), unavailable: false });
  h.toast.success.mockClear();
  h.toast.error.mockClear();
});
afterEach(cleanup);

describe("Missed Calls detail view", () => {
  it("shows the exact active total and pages by the number of ACTIVE rows loaded", async () => {
    mount();
    await screen.findByText("Caller 0");
    expect(screen.getByText("Showing 20 of 33 active missed calls")).toBeInTheDocument();
    expect(h.page.mock.calls[0][0]).toMatchObject({ offset: 0, pageSize: 20, isFiltered: true, organizationId: ORG });
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(h.page).toHaveBeenCalledTimes(2));
    expect(h.page.mock.calls[1][0]).toMatchObject({ offset: 20, pageSize: 20 });
  });

  it("Clear refreshes IN PLACE: rows stay on screen, then the server's list replaces them (no spinner, no reset)", async () => {
    h.clear.mockResolvedValue({ id: "d9", sourceType: "missed_call", sourceId: twenty[0].id, occurrenceAt: twenty[0].createdAt, clearedAt: "2026-10-29T19:00:00Z" });
    mount();
    await screen.findByText("Caller 0");
    let release!: () => void;
    h.page.mockImplementation((scope: any) => new Promise((resolve) => (release = () => resolve(twenty.slice(1, 1 + scope.pageSize)))));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Clear missed call from Caller 0" })); });
    expect(h.clear).toHaveBeenCalledWith({ sourceType: "missed_call", sourceId: twenty[0].id, expectedOccurrenceAt: twenty[0].createdAt });
    // While the refresh runs, the rows are still there and nothing claims "loading".
    expect(screen.getByText("Caller 0")).toBeInTheDocument();
    expect(screen.queryByText("Loading records...")).not.toBeInTheDocument();
    expect(screen.getByText("Updating…")).toBeInTheDocument();
    expect(h.page.mock.calls.at(-1)![0]).toMatchObject({ offset: 0, pageSize: 20 });
    await act(async () => release());
    await waitFor(() => expect(screen.queryByText("Caller 0")).not.toBeInTheDocument());
  });

  it("the Cleared view lists the viewer's cleared calls with a Cleared badge and Undo, and says what clearing means", async () => {
    mount();
    await screen.findByText("Caller 0");
    fireEvent.click(screen.getByRole("button", { name: "Cleared (2)" }));
    expect(await screen.findByText("Cleared Cal")).toBeInTheDocument();
    expect(screen.getByText(/The call, its voicemail and reports are unchanged\./)).toBeInTheDocument();
    const row = screen.getByText("Cleared Cal").closest("li")!;
    expect(row.querySelector('[data-status="cleared"]')).toHaveTextContent(/^Cleared /);
    await act(async () => { fireEvent.click(within(row).getByRole("button", { name: "Undo clear for Cleared Cal" })); });
    expect(h.undo).toHaveBeenCalledWith({ id: "d1", clearedAt: "2026-10-29T19:00:00Z" });
    expect(screen.getByText("Showing 1 of 2 cleared missed calls")).toBeInTheDocument();
  });

  it("opens directly on the Cleared view when asked (the widget's \"N cleared\" link)", async () => {
    mount({ initialView: "cleared" });
    expect(await screen.findByText("Cleared Cal")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cleared (2)" })).toHaveAttribute("aria-pressed", "true");
  });

  it("badges distinguish voicemail and answered-on-mobile; an Admin's Team view names the routing recipient", async () => {
    h.page.mockResolvedValue([
      item(1, { voicemailId: "vm-1", missed_for_agent_id: AGENT, missed_recipient_ids: [AGENT] }),
      item(2, { missed_reason: "forwarded_to_mobile", outcome_raw: "forwarded_answered", answered_by_agent_id: AGENT }),
    ]);
    h.counts.mockResolvedValue({ active: 2, cleared: 0 });
    mount({ isFiltered: false });
    await screen.findByText("Caller 1");
    const first = screen.getByText("Caller 1").closest("li")!;
    expect(within(first).getByText("Voicemail")).toBeInTheDocument();
    expect(within(first).getByTestId("vm")).toHaveAttribute("data-id", "vm-1");
    expect(within(first).getByText("Missed for Alex Rivera")).toBeInTheDocument();
    const second = screen.getByText("Caller 2").closest("li")!;
    expect(within(second).getByText("Answered on mobile")).toBeInTheDocument();
    expect(within(second).getByText(/Alex Rivera/)).toBeInTheDocument();
    expect(h.people.mock.calls[0][0]).toBe(ORG);
  });

  it("a failed first load offers Retry, never the empty message; Clear is absent when switched off", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.counts.mockRejectedValue(new Error("timeout"));
    mount({ config: { clearancesEnabled: false } });
    expect(await screen.findByText("Couldn't load these records")).toBeInTheDocument();
    expect(screen.queryByText("No records found")).not.toBeInTheDocument();
    expect(h.read).not.toHaveBeenCalled();
    h.counts.mockResolvedValue({ active: 20, cleared: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Caller 0");
    expect(screen.queryByRole("button", { name: /^Clear missed call/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /view$/ })).not.toBeInTheDocument();
  });
});
