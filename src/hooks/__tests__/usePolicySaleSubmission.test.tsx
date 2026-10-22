import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

const h = vi.hoisted(() => ({
  calls: [] as Array<[string, unknown]>,
  responses: [] as Array<{ data: unknown; error: unknown; status?: number }>,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (name: string, args: unknown) => {
      h.calls.push([name, JSON.parse(JSON.stringify(args))]);
      if (name === "notify_win") return { data: 1, error: null };
      if (name === "get_policy_sale_operation_status") return { data: { state: "committed", same_payload: false, this_request: false }, error: null };
      return h.responses.shift() ?? { data: null, error: { message: "no response configured" } };
    },
  },
}));

import { usePolicySaleSubmission } from "../usePolicySaleSubmission";
import type { PreparedSale, SaleAttempt } from "@/lib/policySaleOutcome";
import { runPreparedSale } from "@/lib/policySaleRecording";

const CLIENT = "00000000-0000-4000-8000-0000000000c1";
const success = { data: { client_id: CLIENT, win_ids: ["00000000-0000-4000-8000-0000000000d1"], idempotent: false,
  commission: { status: "evidence_recorded", slots: [] } }, error: null, status: 200 };
const lost = { data: null, error: { message: "TypeError: Failed to fetch", code: "" }, status: 0 };

function build(premium: number): PreparedSale {
  return {
    kind: "record", requestId: "00000000-0000-4000-8000-0000000000a1", leadId: null, expectedClientId: CLIENT,
    saleArgs: { p_client_id: CLIENT, p_policy: { premium, carrier: "Synthetic Carrier" }, p_primary: false },
    commission: { v: "policy-commission-v1", slots: [] }, notify: false,
  };
}
const sales = () => h.calls.filter(([name]) => name === "record_client_policy_handoff").map(([, args]) => args);

beforeEach(() => { h.calls = []; h.responses = []; });
afterEach(cleanup);

describe("usePolicySaleSubmission", () => {
  it("a refusal before sending stays editable", async () => {
    const { result } = renderHook(() => usePolicySaleSubmission());
    let outcome!: Awaited<ReturnType<typeof result.current.submit>>;
    await act(async () => { outcome = await result.current.submit((attempt) => runPreparedSale(attempt, () => { throw new Error("Carrier is required"); })); });
    expect(outcome).toMatchObject({ saved: false, phase: "editing", message: "Carrier is required" });
    expect(result.current.locked).toBe(false);
    expect(sales()).toHaveLength(0);
  });

  it("a confirmed rejection of a fresh attempt is editable, and the next attempt is rebuilt from the edited form", async () => {
    h.responses = [{ data: null, error: { message: "This carrier and policy number are already recorded.", code: "22023" }, status: 400 }, success];
    const { result } = renderHook(() => usePolicySaleSubmission());
    await act(async () => { await result.current.submit((attempt) => runPreparedSale(attempt, () => build(50))); });
    expect(result.current.phase).toBe("editing");
    await act(async () => { await result.current.submit((attempt) => runPreparedSale(attempt, () => build(60))); });
    expect(result.current.phase).toBe("saved");
    expect(sales().map((args) => (args as { p_policy: { premium: number } }).p_policy.premium)).toEqual([50, 60]);
  });

  it("an unknown outcome freezes the submission: locked, and Retry replays it byte for byte", async () => {
    h.responses = [lost, success];
    const { result } = renderHook(() => usePolicySaleSubmission());
    await act(async () => { await result.current.submit((attempt) => runPreparedSale(attempt, () => build(50))); });
    expect(result.current).toMatchObject({ phase: "frozen", locked: true, frozen: true });
    expect(result.current.message).toMatch(/couldn't confirm/);
    const rebuild = vi.fn(() => build(999));
    let outcome!: Awaited<ReturnType<typeof result.current.submit>>;
    await act(async () => { outcome = await result.current.submit((attempt) => runPreparedSale(attempt, rebuild)); });
    expect(rebuild).not.toHaveBeenCalled();
    expect(outcome.saved).toBe(true);
    const [first, retry] = sales();
    expect(JSON.stringify(retry)).toBe(JSON.stringify(first));
  });

  it("a failed retry proves nothing about the earlier attempt: it stays frozen, even after an auth or rejection error", async () => {
    h.responses = [lost, { data: null, error: { message: "JWT expired", code: "PGRST301" }, status: 401 },
      { data: null, error: { message: "Client not available", code: "42501" }, status: 403 }, lost, success];
    const { result } = renderHook(() => usePolicySaleSubmission());
    const send = () => act(async () => { await result.current.submit((attempt: SaleAttempt) => runPreparedSale(attempt, () => build(50))); });
    await send();
    for (let i = 0; i < 3; i += 1) {
      await send();
      expect(result.current.phase).toBe("frozen");
      expect(result.current.locked).toBe(true);
    }
    await send();
    expect(result.current.phase).toBe("saved");
    expect(new Set(sales().map((args) => JSON.stringify(args))).size).toBe(1);
  });

  it("a conflict reads the server status and becomes closeable but never editable", async () => {
    h.responses = [{ data: null, error: { message: "Policy request already saved different details", code: "PT409" }, status: 409 }];
    const { result } = renderHook(() => usePolicySaleSubmission());
    await act(async () => { await result.current.submit((attempt) => runPreparedSale(attempt, () => build(50))); });
    expect(result.current).toMatchObject({ phase: "conflict", locked: true, frozen: false });
    expect(result.current.message).toMatch(/already saved with different details/);
    expect(h.calls.some(([name]) => name === "get_policy_sale_operation_status")).toBe(true);
  });

  it("a confirmed sale is never presented as failed, even if later client code throws", async () => {
    h.responses = [success];
    const { result } = renderHook(() => usePolicySaleSubmission());
    let outcome!: Awaited<ReturnType<typeof result.current.submit>>;
    await act(async () => {
      outcome = await result.current.submit(async (attempt) => { await runPreparedSale(attempt, () => build(50)); throw new Error("render failed"); });
    });
    expect(outcome).toMatchObject({ saved: true, phase: "saved" });
    expect(outcome.result?.clientId).toBe(CLIENT);
  });

  it("reset discards a frozen submission and ignores a late answer", async () => {
    let release!: (value: unknown) => void;
    const { result } = renderHook(() => usePolicySaleSubmission());
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.submit(() => new Promise((resolve) => { release = resolve; }) as never);
    });
    expect(result.current.phase).toBe("sending");
    act(() => result.current.reset());
    await act(async () => { release(undefined); await pending; });
    expect(result.current.phase).toBe("editing");
    expect(await pending).toMatchObject({ saved: false });
  });

  it("never logs the submission", async () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error"), vi.spyOn(console, "info")];
    h.responses = [lost, success];
    const { result } = renderHook(() => usePolicySaleSubmission());
    await act(async () => { await result.current.submit((attempt) => runPreparedSale(attempt, () => build(50))); });
    await act(async () => { await result.current.submit((attempt) => runPreparedSale(attempt, () => build(50))); });
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain("Synthetic Carrier");
      spy.mockRestore();
    }
  });
});
