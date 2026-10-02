import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTeamDialerLeadDetails } from "../useTeamDialerLeadDetails";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
const props = {
  enabled: true, organizationId: "org", viewerId: "agent", campaignId: "team",
  campaignLeadId: "queue", leadId: "lead", membershipKey: '["agent"]',
};
const row = { id: "lead", organization_id: "org", campaign_id: "team", campaign_lead_id: "queue",
  notes: "Full display", custom_fields: { Imported: "value", Zero: 0, Flag: false } };
function deferred() {
  let resolve!: (v: { data: unknown; error: unknown }) => void;
  const promise = new Promise<{ data: unknown; error: unknown }>(r => { resolve = r; });
  return { promise, resolve };
}
beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: row, error: null }); });
afterEach(cleanup);

describe("Team display-only reader visit safety", () => {
  it("makes one narrow queue-ID read and preserves raw populated display values", async () => {
    const { result } = renderHook(() => useTeamDialerLeadDetails(props));
    await waitFor(() => expect(result.current.status).toBe("loaded"));
    expect(rpc).toHaveBeenCalledExactlyOnceWith("get_team_dialer_lead_details", { p_campaign_lead_id: "queue" });
    expect(result.current.details).toEqual(row);
    expect(result.current).not.toHaveProperty("master");
    expect(result.current).not.toHaveProperty("adopt");
  });
  it("does not repeat the read on ordinary re-renders", async () => {
    const { result, rerender } = renderHook(p => useTeamDialerLeadDetails(p), { initialProps: props });
    await waitFor(() => expect(result.current.status).toBe("loaded"));
    rerender({ ...props }); rerender({ ...props });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it.each(["organizationId", "viewerId", "campaignId", "campaignLeadId", "leadId"] as const)("requires %s before querying", key => {
    const { result } = renderHook(() => useTeamDialerLeadDetails({ ...props, [key]: null }));
    expect(result.current.details).toBeNull(); expect(rpc).not.toHaveBeenCalled();
  });
  it("does not query while disabled", () => {
    renderHook(() => useTeamDialerLeadDetails({ ...props, enabled: false }));
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each(["id", "organization_id", "campaign_id", "campaign_lead_id"])("rejects a wrong %s in the response", async key => {
    rpc.mockResolvedValue({ data: { ...row, [key]: "wrong" }, error: null });
    const { result } = renderHook(() => useTeamDialerLeadDetails(props));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.details).toBeNull();
  });
  it.each([undefined, [], [row], "bad", 0])("rejects malformed payload %j", async data => {
    rpc.mockResolvedValue({ data, error: null });
    const { result } = renderHook(() => useTeamDialerLeadDetails(props));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.details).toBeNull();
  });
  it("maps NULL denial to an unavailable campaign-copy fallback", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useTeamDialerLeadDetails(props));
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(result.current.details).toBeNull();
  });
  it.each(["error", "throw"])("handles %s without exposing a record or claiming", async mode => {
    if (mode === "throw") rpc.mockRejectedValue(new Error("network"));
    else rpc.mockResolvedValue({ data: row, error: { message: "refused" } });
    const { result } = renderHook(() => useTeamDialerLeadDetails(props));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.details).toBeNull(); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it.each(["organizationId", "viewerId", "campaignId", "campaignLeadId", "leadId", "membershipKey"] as const)("masks first-render state when %s changes", async key => {
    const pending = deferred();
    const { result, rerender } = renderHook(p => useTeamDialerLeadDetails(p), { initialProps: props });
    await waitFor(() => expect(result.current.status).toBe("loaded"));
    rpc.mockReturnValue(pending.promise);
    rerender({ ...props, [key]: "changed" });
    expect(result.current.details).toBeNull(); expect(result.current.status).toBe("loading");
    await act(async () => pending.resolve({ data: row, error: null }));
    // A membership-only change still accepts a fresh server-authorized response with matching IDs.
    expect(result.current.details).toEqual(key === "membershipKey" || key === "viewerId" ? row : null);
  });
  it("masks on loss/advancement/disable and rejects an old retained retry", async () => {
    const { result, rerender } = renderHook(p => useTeamDialerLeadDetails(p), { initialProps: props });
    await waitFor(() => expect(result.current.status).toBe("loaded"));
    const oldRetry = result.current.retry;
    rerender({ ...props, enabled: false });
    expect(result.current.details).toBeNull();
    await act(async () => { await oldRetry(); });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("ignores a late result after the viewer changes", async () => {
    const first = deferred(), second = deferred();
    rpc.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result, rerender } = renderHook(p => useTeamDialerLeadDetails(p), { initialProps: props });
    rerender({ ...props, viewerId: "other" });
    await act(async () => first.resolve({ data: row, error: null }));
    expect(result.current.details).toBeNull();
    await act(async () => second.resolve({ data: null, error: null }));
    expect(result.current.status).toBe("unavailable");
  });
  it("A → B → A creates three visits; the original A cannot overwrite the new A", async () => {
    const old = deferred(), middle = deferred(), current = deferred();
    rpc.mockReturnValueOnce(old.promise).mockReturnValueOnce(middle.promise).mockReturnValueOnce(current.promise);
    const { result, rerender } = renderHook(p => useTeamDialerLeadDetails(p), { initialProps: props });
    const oldRetry = result.current.retry;
    rerender({ ...props, campaignLeadId: "B", leadId: "B" }); rerender({ ...props });
    await act(async () => { await oldRetry(); old.resolve({ data: row, error: null }); });
    expect(rpc).toHaveBeenCalledTimes(3); expect(result.current.details).toBeNull();
    await act(async () => current.resolve({ data: { ...row, notes: "new A" }, error: null }));
    await act(async () => middle.resolve({ data: { ...row, notes: "B" }, error: null }));
    expect(result.current.details?.notes).toBe("new A");
  });
  it("only the newest explicit retry may finish", async () => {
    const old = deferred(), fresh = deferred();
    rpc.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const { result } = renderHook(() => useTeamDialerLeadDetails(props));
    let retry!: Promise<void>;
    act(() => { retry = result.current.retry(); });
    await act(async () => fresh.resolve({ data: { ...row, notes: "fresh" }, error: null }));
    await retry;
    await act(async () => old.resolve({ data: row, error: null }));
    expect(result.current.details?.notes).toBe("fresh");
  });
  it("does not allow a retained retry or finish after unmount", async () => {
    const pending = deferred(); rpc.mockReturnValue(pending.promise);
    const { result, unmount } = renderHook(() => useTeamDialerLeadDetails(props));
    const retry = result.current.retry; unmount();
    await act(async () => { await retry(); pending.resolve({ data: row, error: null }); });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
