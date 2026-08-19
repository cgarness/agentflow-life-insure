import { describe, it, expect, beforeEach, vi } from "vitest";

const { rec, state } = vi.hoisted(() => ({
  rec: {} as {
    winInsert?: any;
    rpcCalls?: Array<{ fn: string; args: any }>;
    lookupKeys?: string[];
  },
  state: {
    winResult: { data: { id: "w1" }, error: null as any },
    rpcResults: [] as Array<{ data: any; error: any }>,
    existingWinLookup: { data: null as any, error: null as any },
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
          select: () => ({
            eq: (_col: string, key: string) => {
              (rec.lookupKeys ??= []).push(key);
              return { maybeSingle: () => Promise.resolve(state.existingWinLookup) };
            },
          }),
        };
      }
      return {};
    },
    rpc: (fn: string, args: any) => {
      (rec.rpcCalls ??= []).push({ fn, args });
      const next = state.rpcResults.shift() ?? { data: 2, error: null };
      return Promise.resolve(next);
    },
  },
}));

import { triggerWin } from "@/lib/win-trigger";

beforeEach(() => {
  rec.winInsert = undefined;
  rec.rpcCalls = undefined;
  rec.lookupKeys = undefined;
  state.winResult = { data: { id: "w1" }, error: null };
  state.rpcResults = [];
  state.existingWinLookup = { data: null, error: null };
});

describe("triggerWin idempotency + broadcast recovery", () => {
  it("writes idempotency_key and broadcasts via the server-authoritative notify_win RPC", async () => {
    await triggerWin({
      agentId: "a1", agentName: "Dana Agent", contactName: "Pat Lee",
      contactId: "c1", organizationId: "org1", idempotencyKey: "conversion:L1",
    });
    expect(rec.winInsert.idempotency_key).toBe("conversion:L1");
    expect(rec.rpcCalls).toEqual([{ fn: "notify_win", args: { p_win_id: "w1" } }]);
  });

  it("a 23505 retry with an idempotency key resolves the existing win and RETRIES the RPC (recovers a failed broadcast)", async () => {
    // First attempt inserted the win but its RPC failed; this retry hits 23505.
    state.winResult = { data: null, error: { code: "23505", message: "duplicate key" } };
    state.existingWinLookup = { data: { id: "w-existing" }, error: null };
    await triggerWin({
      agentId: "a1", agentName: "Dana Agent", contactName: "Pat Lee",
      contactId: "c1", organizationId: "org1", idempotencyKey: "conversion:L1",
    });
    expect(rec.lookupKeys).toEqual(["conversion:L1"]);
    expect(rec.rpcCalls).toEqual([{ fn: "notify_win", args: { p_win_id: "w-existing" } }]);
  });

  it("full recovery sequence: insert ok → RPC fails → retry sees 23505 → win found → RPC retried successfully", async () => {
    // attempt 1: win insert succeeds, broadcast fails
    state.rpcResults = [{ data: null, error: { message: "network sadness" } }];
    await expect(
      triggerWin({
        agentId: "a1", agentName: "Dana Agent", contactName: "Pat Lee",
        contactId: "c1", organizationId: "org1", idempotencyKey: "conversion:L1",
      }),
    ).resolves.toBeUndefined();
    expect(rec.rpcCalls).toHaveLength(1);

    // attempt 2: the win row already exists → 23505 → resolve by key → RPC retried and succeeds
    state.winResult = { data: null, error: { code: "23505", message: "duplicate key" } };
    state.existingWinLookup = { data: { id: "w1" }, error: null };
    state.rpcResults = [{ data: 5, error: null }];
    await triggerWin({
      agentId: "a1", agentName: "Dana Agent", contactName: "Pat Lee",
      contactId: "c1", organizationId: "org1", idempotencyKey: "conversion:L1",
    });
    expect(rec.rpcCalls).toHaveLength(2);
    expect(rec.rpcCalls![1]).toEqual({ fn: "notify_win", args: { p_win_id: "w1" } });
    // the DB event key makes the second broadcast harmless if the first partially landed
  });

  it("a 23505 with a failed/absent existing-win lookup gives up quietly (no RPC, no throw)", async () => {
    state.winResult = { data: null, error: { code: "23505", message: "duplicate key" } };
    state.existingWinLookup = { data: null, error: { message: "rls says no" } };
    await expect(
      triggerWin({
        agentId: "a1", agentName: "Dana Agent", contactName: "Pat Lee",
        contactId: "c1", organizationId: "org1", idempotencyKey: "conversion:L1",
      }),
    ).resolves.toBeUndefined();
    expect(rec.rpcCalls).toBeUndefined();
  });

  it("a 23505 WITHOUT an idempotency key cannot resolve the win: no lookup, no RPC (quick-call path unchanged)", async () => {
    state.winResult = { data: null, error: { code: "23505", message: "duplicate key" } };
    await triggerWin({
      agentId: "a1", agentName: "Dana Agent", contactName: "Pat Lee",
      contactId: "c1", organizationId: "org1",
    });
    expect(rec.lookupKeys).toBeUndefined();
    expect(rec.rpcCalls).toBeUndefined();
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
    state.rpcResults = [{ data: null, error: { message: "not_authorized" } }];
    await expect(
      triggerWin({
        agentId: "a1", agentName: "Dana Agent", contactName: "Pat Lee",
        contactId: "c1", organizationId: "org1",
      }),
    ).resolves.toBeUndefined();
    expect(rec.rpcCalls).toHaveLength(1);
  });
});
