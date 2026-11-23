import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoomCallbacks } from "../RoomCallbacks";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({supabase: {rpc}}));
vi.mock("@/components/voicemail/VoicemailPlayer", () => ({
  VoicemailPlayer: ({voicemailId}: {voicemailId: string}) => <span>voicemail:{voicemailId}</span>,
}));

const ID = "00000000-0000-4000-8000-000000000001";
const CALL = "00000000-0000-4000-8000-000000000002";
const item = (extra: Record<string, unknown> = {}) => ({
  id: ID, call_id: CALL, caller_phone: "+12025550100", contact_id: null, contact_type: null, contact_name: null, status: "open",
  claimed_by: null, claimed_by_name: null, claimed_by_me: false, can_claim: true, missed_at: "2026-11-22T15:00:00Z",
  due_at: "2026-11-22T15:15:00Z", title: "Call back the missed caller", notes: null, voicemail_id: null, ...extra,
});
let queue: {admin: boolean; items: ReturnType<typeof item>[]};
let failure: {code: string; message: string} | null;
beforeEach(() => {
  queue = {admin: false, items: [item()]};
  failure = null;
  rpc.mockImplementation(async (name: string) => {
    if (name === "inbound_callback_queue") return {data: queue, error: null};
    if (failure) return {data: null, error: failure};
    if (name === "claim_inbound_callback") { queue = {...queue, items: [item({status: "claimed", claimed_by: "me", claimed_by_me: true, can_claim: false})]}; return {data: {id: ID, status: "claimed", claimed_by: "me"}, error: null}; }
    if (name === "release_inbound_callback") { queue = {...queue, items: [item()]}; return {data: {id: ID, status: "open"}, error: null}; }
    queue = {...queue, items: []};
    return {data: {id: ID, status: "done"}, error: null};
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const CLAIM = "Claim callback for +12025550100";
const DONE = "Done with callback for +12025550100";
const RELEASE = "Release callback for +12025550100";
const calls = (name: string) => rpc.mock.calls.filter(call => call[0] === name);

describe("Inbounds callbacks", () => {
  it("lists an unknown caller's callback by number, with no contact invented and no way to dial from the list", async () => {
    render(<RoomCallbacks/>);
    const row = (await screen.findByText("+12025550100")).closest("li")!;
    expect(within(row).getByText("Open")).toBeVisible();
    expect(within(row).getByText("Call back the missed caller")).toBeVisible();
    expect(within(row).getByText(/^Missed .* · Call back by /)).toBeVisible();
    expect(screen.getByRole("heading", {name: /Callbacks\s*1 open/})).toBeVisible();
    // Row actions name the caller ("Claim callback for …"), but none of them places a call.
    expect(screen.queryByRole("button", {name: /\bcall\b|\bdial/i})).toBeNull();
    expect(within(row).getByRole("button", {name: "Claim callback for +12025550100"})).toBeVisible();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("claims, then offers Done and Release to the agent who holds it", async () => {
    render(<RoomCallbacks/>);
    fireEvent.click(await screen.findByRole("button", {name: CLAIM}));
    expect(await screen.findByText("Claimed by you")).toBeVisible();
    expect(calls("claim_inbound_callback")).toEqual([["claim_inbound_callback", {p_callback: ID}]]);
    fireEvent.click(screen.getByRole("button", {name: RELEASE}));
    expect(await screen.findByRole("button", {name: CLAIM})).toBeVisible();
    fireEvent.click(screen.getByRole("button", {name: CLAIM}));
    fireEvent.click(await screen.findByRole("button", {name: DONE}));
    expect(await screen.findByText("No callbacks waiting.")).toBeVisible();
    expect(calls("complete_inbound_callback")).toHaveLength(1);
  });

  it("tells the agent when someone else claimed it first, and shows the current holder", async () => {
    render(<RoomCallbacks/>);
    const claim = await screen.findByRole("button", {name: CLAIM});
    failure = {code: "PT409", message: "Someone else already claimed this callback."};
    queue = {admin: false, items: [item({status: "claimed", claimed_by: "other", claimed_by_name: "Jordan Lee", can_claim: false})]};
    fireEvent.click(claim);
    fireEvent.click(claim);
    expect(await screen.findByRole("status")).toHaveTextContent("Someone else already claimed this callback.");
    expect(await screen.findByText("Claimed by Jordan Lee")).toBeVisible();
    expect(calls("claim_inbound_callback")).toHaveLength(1);
    expect(screen.queryByRole("button", {name: RELEASE})).toBeNull();
  });

  it("says a released callback must be claimed again before Done, and clears that after the next refresh", async () => {
    queue = {admin: false, items: [item({status: "claimed", claimed_by: "me", claimed_by_me: true, can_claim: false})]};
    render(<RoomCallbacks/>);
    const done = await screen.findByRole("button", {name: DONE});
    // An administrator released it in the meantime. Nobody holds it now.
    failure = {code: "PT409", message: "Claim this callback before completing it."};
    queue = {admin: false, items: [item()]};
    fireEvent.click(done);
    expect(await screen.findByRole("status")).toHaveTextContent("Claim this callback before completing it.");
    expect(screen.queryByText(/Someone else/)).toBeNull();
    expect(await screen.findByRole("button", {name: CLAIM})).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent("Claim this callback before completing it.");
    fireEvent.click(screen.getByRole("button", {name: "Refresh"}));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it.each([
    [{code: "PT409", message: "This callback is no longer waiting."}, "This callback is no longer waiting."],
    [{code: "PT409", message: ""}, "This callback changed. The list now shows its current state."],
    [{code: "PT404", message: "Callback not found"}, "This callback is no longer available."],
  ])("shows the server's conflict wording, or a plain fallback (%o)", async (refusal, shown) => {
    render(<RoomCallbacks/>);
    const claim = await screen.findByRole("button", {name: CLAIM});
    failure = refusal;
    fireEvent.click(claim);
    expect(await screen.findByRole("status")).toHaveTextContent(shown);
  });

  it("shows only the pressed action as busy and holds every row's actions until it settles", async () => {
    const OTHER = "00000000-0000-4000-8000-000000000003";
    queue = {admin: false, items: [
      item({status: "claimed", claimed_by: "me", claimed_by_me: true, can_claim: false}),
      item({id: OTHER, contact_name: "Ada Lead"}),
    ]};
    let settle!: () => void;
    const base = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (name: string, args: unknown) => {
      if (name !== "release_inbound_callback") return base(name, args);
      await new Promise<void>(done => { settle = done; });
      queue = {...queue, items: [item(), queue.items[1]]};
      return {data: {id: ID, status: "open"}, error: null};
    });
    render(<RoomCallbacks/>);
    fireEvent.click(await screen.findByRole("button", {name: RELEASE}));
    const release = screen.getByRole("button", {name: RELEASE});
    await waitFor(() => expect(release).toHaveTextContent("Releasing…"));
    expect(release).toBeDisabled();
    expect(screen.getByRole("button", {name: DONE})).toHaveTextContent(/^Done$/);
    expect(screen.getByRole("button", {name: DONE})).toBeDisabled();
    expect(screen.getByRole("button", {name: "Claim callback for Ada Lead"})).toBeDisabled();
    settle();
    expect(await screen.findByRole("button", {name: CLAIM})).toBeEnabled();
    expect(screen.getByRole("button", {name: "Claim callback for Ada Lead"})).toBeEnabled();
    expect(calls("claim_inbound_callback")).toHaveLength(0);
  });

  it("lets an administrator release another agent's claim", async () => {
    queue = {admin: true, items: [item({status: "claimed", claimed_by: "other", claimed_by_name: "Jordan Lee", can_claim: false})]};
    render(<RoomCallbacks/>);
    fireEvent.click(await screen.findByRole("button", {name: RELEASE}));
    await waitFor(() => expect(calls("release_inbound_callback")).toHaveLength(1));
    expect(screen.queryByRole("button", {name: DONE})).toBeNull();
  });

  it("shows a known contact with the number, and the voicemail left on the same call", async () => {
    queue = {admin: true, items: [item({contact_id: CALL, contact_type: "lead", contact_name: "Riley Ortiz", voicemail_id: "vm-1", notes: "Asked about a quote"})]};
    render(<RoomCallbacks/>);
    const row = (await screen.findByText("Riley Ortiz")).closest("li")!;
    expect(within(row).getByText("+12025550100")).toBeVisible();
    expect(within(row).getByText("voicemail:vm-1")).toBeVisible();
    expect(within(row).getByText("Asked about a quote")).toBeVisible();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("offers a retry when the list cannot be loaded", async () => {
    rpc.mockImplementationOnce(async () => ({data: null, error: {code: "42501", message: "Room access unavailable"}}));
    render(<RoomCallbacks/>);
    expect(await screen.findByRole("alert")).toHaveTextContent("Callbacks could not be loaded.");
    fireEvent.click(screen.getByRole("button", {name: "Retry"}));
    expect(await screen.findByText("+12025550100")).toBeVisible();
  });
});
