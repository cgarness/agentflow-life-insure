import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const CLIENT = "00000000-0000-4000-8000-0000000000c1";
const h = vi.hoisted(() => ({
  impersonating: false,
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
    user: { id: "00000000-0000-4000-8000-0000000000a1" },
    isImpersonating: h.impersonating,
    profile: { id: h.impersonating ? "00000000-0000-4000-8000-0000000000a9" : "00000000-0000-4000-8000-0000000000a1", role: "Agent",
      organization_id: "00000000-0000-4000-8000-0000000000e1" },
  }),
}));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: "00000000-0000-4000-8000-0000000000e1", role: "Agent" }) }));

import { useClientPolicyCommissions, useTrackingMutation } from "../useClientPolicyCommissions";
import { commissionTrackingApi } from "@/lib/commission/trackingApi";

let client: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
let n = 0;
beforeEach(() => {
  h.impersonating = false;
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
    const { result } = renderHook(() => useTrackingMutation(), { wrapper });
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
    const { result } = renderHook(() => useTrackingMutation(), { wrapper });
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
    const { result } = renderHook(() => useTrackingMutation(), { wrapper });
    await act(async () => { await result.current.run(write); });
    expect(result.current.message).toBe("This commission changed elsewhere. Refresh and try again.");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["policy-commissions"] });
  });
});
