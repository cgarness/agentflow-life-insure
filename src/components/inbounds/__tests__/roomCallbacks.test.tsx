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
const calls = (name: string) => rpc.mock.calls.filter(call => call[0] === name);

describe("Inbounds callbacks", () => {
  it("lists an unknown caller's callback by number, with no contact invented and no way to dial from the list", async () => {
    render(<RoomCallbacks/>);
    const row = (await screen.findByText("+12025550100")).closest("li")!;
    expect(within(row).getByText("Open")).toBeVisible();
    expect(within(row).getByText("Call back the missed caller")).toBeVisible();
    expect(within(row).getByText(/^Missed .* · Call back by /)).toBeVisible();
    expect(screen.getByRole("heading", {name: /Callbacks\s*1 open/})).toBeVisible();
    expect(screen.queryByRole("button", {name: /call|dial/i})).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("claims, then offers Done and Release to the agent who holds it", async () => {
    render(<RoomCallbacks/>);
    fireEvent.click(await screen.findByRole("button", {name: "Claim"}));
    expect(await screen.findByText("Claimed by you")).toBeVisible();
    expect(calls("claim_inbound_callback")).toEqual([["claim_inbound_callback", {p_callback: ID}]]);
    fireEvent.click(screen.getByRole("button", {name: "Release"}));
    expect(await screen.findByRole("button", {name: "Claim"})).toBeVisible();
    fireEvent.click(screen.getByRole("button", {name: "Claim"}));
    fireEvent.click(await screen.findByRole("button", {name: "Done"}));
    expect(await screen.findByText("No callbacks waiting.")).toBeVisible();
    expect(calls("complete_inbound_callback")).toHaveLength(1);
  });

  it("tells the agent when someone else claimed it first, and shows the current holder", async () => {
    render(<RoomCallbacks/>);
    const claim = await screen.findByRole("button", {name: "Claim"});
    failure = {code: "PT409", message: "Someone else already claimed this callback."};
    queue = {admin: false, items: [item({status: "claimed", claimed_by: "other", claimed_by_name: "Jordan Lee", can_claim: false})]};
    fireEvent.click(claim);
    fireEvent.click(claim);
    expect(await screen.findByRole("status")).toHaveTextContent("Someone else already claimed this callback.");
    expect(await screen.findByText("Claimed by Jordan Lee")).toBeVisible();
    expect(calls("claim_inbound_callback")).toHaveLength(1);
    expect(screen.queryByRole("button", {name: "Release"})).toBeNull();
  });

  it("lets an administrator release another agent's claim", async () => {
    queue = {admin: true, items: [item({status: "claimed", claimed_by: "other", claimed_by_name: "Jordan Lee", can_claim: false})]};
    render(<RoomCallbacks/>);
    fireEvent.click(await screen.findByRole("button", {name: "Release"}));
    await waitFor(() => expect(calls("release_inbound_callback")).toHaveLength(1));
    expect(screen.queryByRole("button", {name: "Done"})).toBeNull();
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
