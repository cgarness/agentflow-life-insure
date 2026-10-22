import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const CLIENT = "00000000-0000-4000-8000-0000000000c1";
const h = vi.hoisted(() => ({
  impersonating: false,
  userId: "00000000-0000-4000-8000-0000000000a1",
  calls: [] as Array<[string, Record<string, unknown>]>,
  responses: [] as Array<{ data: unknown; error: unknown }>,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => {
      h.calls.push([name, args]);
      const request = Promise.resolve(name === "get_client_policy_commissions"
        ? { data: { client_id: "00000000-0000-4000-8000-0000000000c1", policies: [] }, error: null }
        : h.responses.shift() ?? { data: null, error: { message: "unset" } });
      return Object.assign(request, { abortSignal: () => request });
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: h.userId },
    isImpersonating: h.impersonating,
    profile: { id: h.impersonating ? "00000000-0000-4000-8000-0000000000a9" : h.userId, role: "Agent",
      organization_id: "00000000-0000-4000-8000-0000000000e1" },
  }),
}));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: "00000000-0000-4000-8000-0000000000e1", role: "Agent" }) }));

import { resetUnresolvedTrackingWrites, useClientPolicyCommissions, useTrackingMutation } from "../useClientPolicyCommissions";
import { commissionTrackingApi } from "@/lib/commission/trackingApi";

let client: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
let n = 0;
beforeEach(() => {
  resetUnresolvedTrackingWrites();
  h.impersonating = false;
  h.userId = "00000000-0000-4000-8000-0000000000a1";
  h.calls = [];
  h.responses = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: () => `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}` });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("useClientPolicyCommissions", () => {
  it("reads the client's saved commissions for the signed-in user", async () => {
    const { result } = renderHook(() => useClientPolicyCommissions(CLIENT), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.calls).toEqual([["get_client_policy_commissions", { p_client_id: CLIENT }]]);
  });

  it("requests nothing under View As", async () => {
    h.impersonating = true;
    const { result } = renderHook(() => useClientPolicyCommissions(CLIENT), { wrapper });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(result.current.enabled).toBe(false);
    expect(h.calls).toHaveLength(0);
  });
});

describe("useTrackingMutation", () => {
  const write = (requestId: string) =>
    commissionTrackingApi.setHold({ requestId, estimateId: CLIENT, expectedRevision: 1, onHold: true, reason: "Carrier review" });

  it("retries an unknown outcome with the same request id and keeps the inputs locked", async () => {
    h.responses = [{ data: null, error: { code: "", message: "TypeError: Failed to fetch" } },
      { data: { estimate_id: CLIENT, state_revision: 2, status: "ok" }, error: null }];
    const { result } = renderHook(() => useTrackingMutation("hold:e1"), { wrapper });
    await act(async () => { await result.current.run(write); });
    expect(result.current).toMatchObject({ status: "error", locked: true });
    await act(async () => { await result.current.run(write); });
    expect(result.current).toMatchObject({ status: "idle", locked: false });
    const ids = h.calls.filter(([name]) => name === "set_policy_commission_hold").map(([, args]) => args.p_request_id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  it("a confirmed refusal stays editable; restart issues a new request id", async () => {
    h.responses = [{ data: null, error: { code: "22023", message: "Invalid hold change" } },
      { data: { estimate_id: CLIENT, state_revision: 2, status: "ok" }, error: null }];
    const { result } = renderHook(() => useTrackingMutation("hold:e1"), { wrapper });
    await act(async () => { await result.current.run(write); });
    expect(result.current).toMatchObject({ status: "error", locked: false, message: "Invalid hold change" });
    act(() => result.current.restart());
    await act(async () => { await result.current.run(write); });
    const ids = h.calls.filter(([name]) => name === "set_policy_commission_hold").map(([, args]) => args.p_request_id);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("a stale revision refreshes the commission views", async () => {
    h.responses = [{ data: null, error: { code: "PT409", message: "Commission changed elsewhere" } }];
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useTrackingMutation("hold:e1"), { wrapper });
    await act(async () => { await result.current.run(write); });
    expect(result.current.message).toBe("This commission changed elsewhere. Refresh and try again.");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["policy-commissions"] });
  });

  const holdIds = () => h.calls.filter(([name]) => name === "set_policy_commission_hold").map(([, args]) => args.p_request_id);
  const lost = { data: null, error: { code: "", message: "TypeError: Failed to fetch" } };
  const saved = { data: { estimate_id: CLIENT, state_revision: 2, status: "ok" }, error: null };

  it("an unresolved write survives closing and remounting: restart refuses, retry resends the exact call and id", async () => {
    h.responses = [lost, saved];
    const first = renderHook(() => useTrackingMutation<{ reason: string }>("hold:e1"), { wrapper });
    await act(async () => { await first.result.current.run(write, { reason: "Carrier review" }); });
    first.unmount();
    const second = renderHook(() => useTrackingMutation<{ reason: string }>("hold:e1"), { wrapper });
    expect(second.result.current).toMatchObject({ unresolved: true, locked: true, pending: { reason: "Carrier review" } });
    act(() => second.result.current.restart());
    expect(second.result.current.unresolved).toBe(true);
    // A different callback (e.g. edited inputs) is never sent while unresolved: the stored call is replayed.
    const other = vi.fn(async () => { throw new Error("must not be sent"); });
    await act(async () => { await second.result.current.run(other); });
    expect(other).not.toHaveBeenCalled();
    expect(second.result.current).toMatchObject({ unresolved: false, locked: false, message: null });
    const ids = holdIds();
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
    expect(h.calls.filter(([name]) => name === "set_policy_commission_hold").map(([, args]) => args)[1])
      .toEqual(h.calls.filter(([name]) => name === "set_policy_commission_hold").map(([, args]) => args)[0]);
  });

  it("a later permission or sign-in error proves nothing: the write stays unresolved with the same id", async () => {
    h.responses = [lost, { data: null, error: { code: "42501", message: "Commission access is unavailable" } },
      { data: null, error: { code: "PGRST301", message: "JWT expired" } }, saved];
    const { result } = renderHook(() => useTrackingMutation("hold:e1"), { wrapper });
    await act(async () => { await result.current.run(write); });
    await act(async () => { await result.current.retry(); });
    expect(result.current).toMatchObject({ unresolved: true, locked: true });
    expect(result.current.message).toMatch(/Retry sends exactly the same change\. Last retry: You don't have permission/);
    await act(async () => { await result.current.retry(); });
    expect(result.current.unresolved).toBe(true);
    await act(async () => { await result.current.retry(); });
    expect(result.current.unresolved).toBe(false);
    expect(new Set(holdIds()).size).toBe(1);
  });

  it("a refusal of that same request proves nothing was saved and frees the inputs with a new id", async () => {
    h.responses = [lost, { data: null, error: { code: "PT409", message: "stale" } }, saved];
    const { result } = renderHook(() => useTrackingMutation("hold:e1"), { wrapper });
    await act(async () => { await result.current.run(write); });
    await act(async () => { await result.current.retry(); });
    expect(result.current).toMatchObject({ unresolved: false, locked: false });
    expect(result.current.message).toMatch(/^That change was not saved\./);
    await act(async () => { await result.current.run(write); });
    const ids = holdIds();
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  it("ignores a response that arrives after the signed-in user changed, and keeps nothing for the new user", async () => {
    let fail!: () => void;
    const slow = () => new Promise<never>((_, reject) => { fail = () => reject(new Error("socket hang up")); });
    const { result, rerender } = renderHook(() => useTrackingMutation("hold:e1"), { wrapper });
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.run(slow); });
    h.userId = "00000000-0000-4000-8000-0000000000b2";
    rerender();
    await act(async () => { fail(); await pending; });
    expect(result.current).toMatchObject({ unresolved: false, locked: false, saving: false, message: null });
    h.userId = "00000000-0000-4000-8000-0000000000a1";
    rerender();
    expect(result.current.unresolved).toBe(false);
  });

  it("another user never sees an unresolved write, and switching users drops it from memory", async () => {
    h.responses = [lost];
    const { result, rerender } = renderHook(() => useTrackingMutation("hold:e1"), { wrapper });
    await act(async () => { await result.current.run(write); });
    expect(result.current.unresolved).toBe(true);
    h.userId = "00000000-0000-4000-8000-0000000000b2";
    rerender();
    expect(result.current).toMatchObject({ unresolved: false, locked: false });
    h.userId = "00000000-0000-4000-8000-0000000000a1";
    rerender();
    expect(result.current.unresolved).toBe(false);
  });
});
