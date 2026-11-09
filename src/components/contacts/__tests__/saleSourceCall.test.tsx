import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  twilio: { currentCall: null as unknown, callState: "idle", lastCallDirection: "outbound", identifiedContact: null as unknown,
            incomingCallerName: "", incomingCallerNumber: "" },
  user: { id: "00000000-0000-4000-8000-0000000000a1" } as { id: string } | null,
  org: "00000000-0000-4000-8000-0000000000e1" as string | null,
  rpc: vi.fn(),
}));
vi.mock("@/contexts/TwilioContext", () => ({ useTwilio: () => h.twilio }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: h.user, isImpersonating: false,
  profile: h.user ? { id: h.user.id, role: "Agent", organization_id: h.org } : null }) }));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: h.org, role: "Agent" }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => {
  const r = h.rpc(...a); return Object.assign(Promise.resolve(r), { abortSignal: () => Promise.resolve(r) }); } } }));

import TrackedCallObserver from "@/components/layout/TrackedCallObserver";
import { SaleSourceCallChip } from "../SaleSourceCallChip";
import { PolicySaleCallLinkStatus } from "../PolicySaleCallLinkStatus";
import { getChipSelection, resetTrackedCalls } from "@/lib/recentTrackedCall";

const ROW = "00000000-0000-4000-8000-00000000c001";
const ROW2 = "00000000-0000-4000-8000-00000000c002";
const call = (row: string) => ({ customParameters: new Map([["af_call_row_id", row]]) });
const answer = (row: string, name = "Synthetic Caller") => {
  h.twilio = { ...h.twilio, currentCall: call(row), callState: "active", lastCallDirection: "inbound", identifiedContact: { name, number: "" } };
};
const hangUp = () => { h.twilio = { ...h.twilio, currentCall: null, callState: "ended" }; };

beforeEach(() => {
  resetTrackedCalls(); h.rpc.mockReset();
  h.twilio = { currentCall: null, callState: "idle", lastCallDirection: "outbound", identifiedContact: null, incomingCallerName: "", incomingCallerNumber: "" };
  h.user = { id: "00000000-0000-4000-8000-0000000000a1" }; h.org = "00000000-0000-4000-8000-0000000000e1";
});
afterEach(cleanup);

describe("TrackedCallObserver + SaleSourceCallChip (IN-A, ★6)", () => {
  it("during an active inbound call the call is attached automatically and can be removed (never re-attached)", async () => {
    answer(ROW);
    const observer = render(<TrackedCallObserver />);
    expect(observer.container).toBeEmptyDOMElement();
    render(<SaleSourceCallChip requestId="req-1" />);
    expect(await screen.findByText(/Sold on this call with Synthetic Caller/)).toBeInTheDocument();
    expect(getChipSelection("req-1")).toBe(ROW);
    fireEvent.click(screen.getByRole("button", { name: "Remove the sale's source call" }));
    expect(getChipSelection("req-1")).toBeNull();
    expect(screen.queryByText(/Sold on this call/)).toBeNull();
  });

  it("a call answered while no sale modal was open is offered unselected after it ends", async () => {
    answer(ROW, "Earlier Caller");
    const observer = render(<TrackedCallObserver />);
    hangUp(); observer.rerender(<TrackedCallObserver />);
    render(<SaleSourceCallChip requestId="req-2" />);
    const offer = await screen.findByRole("button", { name: /Sold on the call with Earlier Caller/ });
    expect(getChipSelection("req-2")).toBeUndefined();
    fireEvent.click(offer);
    expect(getChipSelection("req-2")).toBe(ROW);
  });

  it("a newer call never replaces the selected one", async () => {
    answer(ROW, "First");
    const observer = render(<TrackedCallObserver />);
    render(<SaleSourceCallChip requestId="req-3" />);
    await waitFor(() => expect(getChipSelection("req-3")).toBe(ROW));
    hangUp(); observer.rerender(<TrackedCallObserver />);
    answer(ROW2, "Second"); act(() => { observer.rerender(<TrackedCallObserver />); });
    expect(getChipSelection("req-3")).toBe(ROW);
  });

  it("an outbound call or a call without a valid row id is never tracked; unmount clears the selection", () => {
    h.twilio = { ...h.twilio, currentCall: call(ROW), callState: "active", lastCallDirection: "outbound" };
    render(<TrackedCallObserver />);
    const chip = render(<SaleSourceCallChip requestId="req-4" />);
    expect(chip.container).toBeEmptyDOMElement();
    cleanup(); resetTrackedCalls();
    h.twilio = { ...h.twilio, currentCall: { customParameters: new Map([["af_call_row_id", "nope"]]) }, lastCallDirection: "inbound" };
    render(<TrackedCallObserver />);
    expect(render(<SaleSourceCallChip requestId="req-5" />).container).toBeEmptyDOMElement();
  });

  it("is cleared on sign-out", async () => {
    answer(ROW);
    const observer = render(<TrackedCallObserver />);
    hangUp(); observer.rerender(<TrackedCallObserver />);
    h.user = null; act(() => { observer.rerender(<TrackedCallObserver />); });
    h.user = { id: "00000000-0000-4000-8000-0000000000a1" }; act(() => { observer.rerender(<TrackedCallObserver />); });
    expect(render(<SaleSourceCallChip requestId="req-6" />).container).toBeEmptyDOMElement();
  });
});

describe("PolicySaleCallLinkStatus (RL-21, T-RECOVER client half)", () => {
  const premiums = (winIds: string[]) => ({ client_id: "00000000-0000-4000-8000-0000000000d1", can_correct: false, policies: winIds.map((w, i) => ({
    policy_id: `00000000-0000-4000-8000-00000000f00${i}`, win_id: w, policy_source: "primary", sold_date: "2026-10-02", seller_id: null, seller_name: null,
    original: { monthly: 50, state: "known", source: "sale_snapshot" }, effective: { monthly: 50, annual: 600, source: "sale_snapshot", state: "known", revision: 0 },
    book: null, history: [] })) });
  const W1 = "00000000-0000-4000-8000-00000000b001", W2 = "00000000-0000-4000-8000-00000000b002";
  const show = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <PolicySaleCallLinkStatus clientId="00000000-0000-4000-8000-0000000000d1" /></QueryClientProvider>);

  it("after a reload it reads open_failure and its Retry saves the link", async () => {
    let linked = false;
    h.rpc.mockImplementation((name: string) => name === "get_client_policy_sale_premiums" ? { data: premiums([W1, W2]), error: null }
      : name === "get_policy_sale_call_link_status" ? { data: [{ win_id: W1, status: linked ? "linked" : "open_failure" }, { win_id: W2, status: "linked" }], error: null }
      : name === "retry_policy_sale_call_link" ? (linked = true, { data: { status: "linked", recorded: true }, error: null }) : { data: null, error: null });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByText("Call link not saved")).toBeNull());
    expect(h.rpc.mock.calls.filter(([name]) => name === "retry_policy_sale_call_link")).toEqual([["retry_policy_sale_call_link", { p_win_id: W1 }]]);
  });

  it("shows nothing without an open failure; a failed retry keeps the action", async () => {
    h.rpc.mockImplementation((name: string) => name === "get_client_policy_sale_premiums" ? { data: premiums([W1]), error: null }
      : name === "get_policy_sale_call_link_status" ? { data: [{ win_id: W1, status: "open_failure" }], error: null }
      : name === "retry_policy_sale_call_link" ? { data: { status: "capture_failed", recorded: true }, error: null } : { data: null, error: null });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Still not saved.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    cleanup();
    h.rpc.mockImplementation((name: string) => name === "get_client_policy_sale_premiums" ? { data: premiums([W1]), error: null }
      : { data: [{ win_id: W1, status: "not_linked" }], error: null });
    const none = show();
    await waitFor(() => expect(h.rpc.mock.calls.some(([name]) => name === "get_policy_sale_call_link_status")).toBe(true));
    expect(none.container).toBeEmptyDOMElement();
  });
});
