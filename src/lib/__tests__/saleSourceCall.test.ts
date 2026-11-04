import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: h }));

import { newSaleAttempt } from "@/lib/policySaleOutcome";
import { recordClientPolicyHandoff, resolveSourceCallId } from "@/lib/policySaleRecording";
import { conversionSupabaseApi } from "@/lib/supabase-conversion";
import {
  clearChipSelection, endTrackedCall, getActiveInboundCall, getChipSelection, getRecentEndedCalls, recordActiveInboundCall,
  resetTrackedCalls, setChipSelection, setTrackedCallIdentity, TRACKED_CALL_TTL_MS,
} from "@/lib/recentTrackedCall";
import { SALE_CALL_LINK_RETRY_DELAYS_MS, scheduleSaleCallLinkRetry } from "@/lib/saleCallLinkRetry";

const CALL = "00000000-0000-4000-8000-0000000000c1";
const CALL2 = "00000000-0000-4000-8000-0000000000c2";
const CLIENT = "00000000-0000-4000-8000-0000000000d1";
const policy = { policy_type: "Term", carrier: "Synthetic Life", premium: 50, sold_date: "2026-10-02", sale_mode: "new" as const };
const commission = { v: "policy-commission-v1", slots: [] } as never;
const saved = (link?: unknown) => ({ data: { client_id: CLIENT, win_ids: ["w1"], idempotent: false, commission: { status: "evidence_recorded", slots: [] },
  ...(link === undefined ? {} : { source_call_link: link }) }, error: null });

beforeEach(() => {
  resetTrackedCalls();
  h.rpc.mockReset();
  h.rpc.mockImplementation((name: string) => Promise.resolve(name === "notify_win" ? { data: 1, error: null } : saved({ status: "linked", recorded: true })));
});
afterEach(() => vi.useRealTimers());

describe("recentTrackedCall store (★6)", () => {
  it("keeps an ended call 30 minutes, newest first, and never returns another user's or organization's", () => {
    setTrackedCallIdentity("u1", "o1");
    recordActiveInboundCall(CALL, "Caller One", 1_000);
    expect(getActiveInboundCall("u1", "o1", 1_000)?.rowId).toBe(CALL);
    expect(getActiveInboundCall("u2", "o1", 1_000)).toBeNull();
    endTrackedCall(CALL, 2_000);
    recordActiveInboundCall(CALL2, "Caller Two", 3_000);
    endTrackedCall(CALL2, 4_000);
    expect(getRecentEndedCalls("u1", "o1", 5_000).map((c) => c.rowId)).toEqual([CALL2, CALL]);
    expect(getRecentEndedCalls("u1", "o1", 2_000 + TRACKED_CALL_TTL_MS + 1).map((c) => c.rowId)).toEqual([CALL2]);
    expect(getRecentEndedCalls("u1", "o2", 5_000)).toEqual([]);
  });

  it("is cleared on sign-out and on an organization change, selections included", () => {
    setTrackedCallIdentity("u1", "o1");
    recordActiveInboundCall(CALL, null);
    setChipSelection("req", CALL);
    setTrackedCallIdentity("u1", "o2");
    expect(getActiveInboundCall("u1", "o2")).toBeNull();
    expect(getChipSelection("req")).toBeUndefined();
    setTrackedCallIdentity("u1", "o2");
    recordActiveInboundCall(CALL, null);
    setTrackedCallIdentity(null, null);
    expect(getActiveInboundCall("u1", "o2")).toBeNull();
    recordActiveInboundCall(CALL2, null);
    expect(getActiveInboundCall(null, null)).toBeNull();
  });

  it("selections accept only call row ids and are cleared per request", () => {
    setTrackedCallIdentity("u1", "o1");
    setChipSelection("req", "not-a-uuid");
    expect(getChipSelection("req")).toBeUndefined();
    setChipSelection("req", null);
    expect(getChipSelection("req")).toBeNull();
    clearChipSelection("req");
    expect(getChipSelection("req")).toBeUndefined();
  });
});

describe("producing call on the sale submission (D3 §4)", () => {
  it("the forwarded prop wins; otherwise the chip selection under the same request id; anything else is null", () => {
    setTrackedCallIdentity("u1", "o1");
    setChipSelection("req", CALL2);
    expect(resolveSourceCallId(CALL, "req")).toBe(CALL);
    expect(resolveSourceCallId(null, "req")).toBeNull();
    expect(resolveSourceCallId(undefined, "req")).toBe(CALL2);
    expect(resolveSourceCallId(undefined, "other")).toBeNull();
    expect(resolveSourceCallId("junk", "req")).toBeNull();
  });

  it("routes to the capture companion with p_source_call_id, kept out of the sale args, and parses the link outcome", async () => {
    const attempt = newSaleAttempt();
    const result = await recordClientPolicyHandoff(attempt, "req-1", CLIENT, policy, false, commission, CALL);
    const [name, args] = h.rpc.mock.calls[0];
    expect(name).toBe("record_client_policy_handoff_v2");
    expect(args).toMatchObject({ p_request_id: "req-1", p_client_id: CLIENT, p_primary: false, p_source_call_id: CALL });
    expect(attempt.prepared?.saleArgs).not.toHaveProperty("p_source_call_id");
    expect(result.sourceCallLink).toEqual({ status: "linked", recorded: true });
  });

  it("without a producing call the unchanged companion is called; an absent outcome is not_requested", async () => {
    h.rpc.mockImplementation((name: string) => Promise.resolve(name === "notify_win" ? { data: 1, error: null } : saved()));
    const result = await recordClientPolicyHandoff(newSaleAttempt(), "req-2", CLIENT, policy, false, commission, null);
    expect(h.rpc.mock.calls[0][0]).toBe("record_client_policy_handoff");
    expect(h.rpc.mock.calls[0][1]).not.toHaveProperty("p_source_call_id");
    expect(result.sourceCallLink).toEqual({ status: "not_requested", recorded: false });
  });

  it("falls back once to the unchanged companion when the capture companion does not exist yet (PGRST202)", async () => {
    h.rpc.mockImplementationOnce(() => Promise.resolve({ data: null, error: { code: "PGRST202", message: "not found" } }));
    h.rpc.mockImplementation((name: string) => Promise.resolve(name === "notify_win" ? { data: 1, error: null } : saved()));
    await recordClientPolicyHandoff(newSaleAttempt(), "req-3", CLIENT, policy, false, commission, CALL);
    expect(h.rpc.mock.calls.slice(0, 2).map(([name]) => name)).toEqual(["record_client_policy_handoff_v2", "record_client_policy_handoff"]);
  });

  it("the selection is frozen with the submission: a retry reuses it after the chip or a newer call changed", async () => {
    setTrackedCallIdentity("u1", "o1");
    setChipSelection("req-4", CALL);
    h.rpc.mockImplementationOnce(() => Promise.reject(new Error("network")));
    const first = newSaleAttempt();
    await expect(recordClientPolicyHandoff(first, "req-4", CLIENT, policy, false, commission)).rejects.toThrow();
    setChipSelection("req-4", CALL2);
    const retry = newSaleAttempt(first.prepared);
    await recordClientPolicyHandoff(retry, "req-4", CLIENT, policy, false, commission);
    expect(h.rpc.mock.calls.filter(([name]) => name === "record_client_policy_handoff_v2").map(([, a]) => a.p_source_call_id)).toEqual([CALL, CALL]);
    expect(Object.isFrozen(first.prepared)).toBe(true);
  });

  it("a malformed outcome is unknown and never fails the sale; conversion routes to its capture companion", async () => {
    h.rpc.mockImplementation((name: string) => Promise.resolve(name === "notify_win" ? { data: 1, error: null } : saved({ status: "weird" })));
    const result = await conversionSupabaseApi.convertLeadToClientHandoff(newSaleAttempt(), { id: "lead-1" } as never, {} as never,
      "org-1", null, "req-5", commission, CALL);
    expect(result.sourceCallLink).toEqual({ status: "unknown", recorded: false });
    expect(h.rpc.mock.calls[0][0]).toBe("convert_lead_to_client_with_sales_handoff_v2");
    expect(h.rpc.mock.calls[0][1]).toMatchObject({ p_lead_id: "lead-1", p_source_call_id: CALL });
  });
});

describe("saleCallLinkRetry (D3 §2.12)", () => {
  it("makes 3 attempts at 1 s, 4 s and 15 s, stops on a final answer and is deduplicated per sale", async () => {
    const sleeps: number[] = [];
    const answers = ["capture_failed", "linked"];
    const retry = vi.fn(async () => answers.shift() as never);
    const deps = { retry, sleep: async (ms: number) => { sleeps.push(ms); } };
    const [a, b] = await Promise.all([scheduleSaleCallLinkRetry(["w1"], deps), scheduleSaleCallLinkRetry(["w1"], deps)]);
    expect([a, b]).toEqual([["linked"], ["linked"]]);
    expect(retry).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([1000, 4000]);
    expect(SALE_CALL_LINK_RETRY_DELAYS_MS).toEqual([1000, 4000, 15000]);
    const always = vi.fn(async () => "capture_failed" as never);
    expect(await scheduleSaleCallLinkRetry(["w2"], { retry: always, sleep: async () => {} })).toEqual(["capture_failed"]);
    expect(always).toHaveBeenCalledTimes(3);
  });

  it("a recorded capture failure schedules the retry after the sale is saved, independent of any modal (T-UNMOUNT)", async () => {
    vi.useFakeTimers();
    h.rpc.mockImplementation((name: string) => Promise.resolve(name === "notify_win" ? { data: 1, error: null }
      : name === "retry_policy_sale_call_link" ? { data: { status: "linked", recorded: true }, error: null }
      : saved({ status: "capture_failed", recorded: true })));
    const result = await recordClientPolicyHandoff(newSaleAttempt(), "req-6", CLIENT, policy, false, commission, CALL);
    expect(result.sourceCallLink?.status).toBe("capture_failed");
    expect(h.rpc.mock.calls.some(([name]) => name === "retry_policy_sale_call_link")).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.rpc.mock.calls.filter(([name]) => name === "retry_policy_sale_call_link")).toEqual([["retry_policy_sale_call_link", { p_win_id: "w1" }]]);
  });
});
