import { describe, it, expect, beforeEach, vi } from "vitest";

const { rec, state } = vi.hoisted(() => ({
  rec: {} as { winInsert?: any; rpcCalls?: Array<{ fn: string; args: any }> },
  state: {
    winResult: { data: { id: "w1" }, error: null as any },
    rpcResult: { data: 2, error: null as any },
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "wins") {
        return {
          insert: (payload: any) => {
            rec.winInsert = payload;
            return { select: () => ({ single: () => Promise.resolve(state.winResult) }) };
          },
        };
      }
      return {};
    },
    rpc: (fn: string, args: any) => {
      (rec.rpcCalls ??= []).push({ fn, args });
      return Promise.resolve(state.rpcResult);
    },
  },
}));

import { triggerWin } from "@/lib/win-trigger";

beforeEach(() => {
  rec.winInsert = undefined;
  rec.rpcCalls = undefined;
  state.winResult = { data: { id: "w1" }, error: null };
  state.rpcResult = { data: 2, error: null };
});

describe("triggerWin idempotency", () => {
  it("writes idempotency_key and broadcasts via the server-authoritative notify_win RPC", async () => {
    await triggerWin({
      agentId: "a1", agentName: "Dana Agent", contactName: "Pat Lee",
      contactId: "c1", organizationId: "org1", idempotencyKey: "conversion:L1",
    });
    expect(rec.winInsert.idempotency_key).toBe("conversion:L1");
    expect(rec.rpcCalls).toEqual([{ fn: "notify_win", args: { p_win_id: "w1" } }]);
  });

  it("treats a 23505 unique violation as already-celebrated: no duplicate broadcast", async () => {
    state.winResult = { data: null, error: { code: "23505", message: "duplicate key" } };
    await triggerWin({
      agentId: "a1", agentName: "Dana Agent", contactName: "Pat Lee",
      contactId: "c1", organizationId: "org1", idempotencyKey: "conversion:L1",
    });
    expect(rec.winInsert.idempotency_key).toBe("conversion:L1");
    expect(rec.rpcCalls).toBeUndefined(); // no RPC call on idempotent retry
  });

  it("passes a null idempotency_key for non-conversion wins (additional policies allowed)", async () => {
    await triggerWin({
      agentId: "a1", agentName: "Dana Agent", contactName: "Pat Lee",
      contactId: "c1", organizationId: "org1",
    });
    expect(rec.winInsert.idempotency_key).toBeNull();
    expect(rec.rpcCalls).toEqual([{ fn: "notify_win", args: { p_win_id: "w1" } }]);
  });

  it("a failed broadcast never rejects the win flow (celebration failure is non-fatal)", async () => {
    state.rpcResult = { data: null, error: { message: "not_authorized" } };
    await expect(
      triggerWin({
        agentId: "a1", agentName: "Dana Agent", contactName: "Pat Lee",
        contactId: "c1", organizationId: "org1",
      }),
    ).resolves.toBeUndefined();
    expect(rec.rpcCalls).toHaveLength(1);
  });
});
