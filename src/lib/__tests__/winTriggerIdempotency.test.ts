import { describe, it, expect, beforeEach, vi } from "vitest";

const { rec, state } = vi.hoisted(() => ({
  rec: {} as { winInsert?: any; notifications?: any[] },
  state: {
    winResult: { data: { id: "w1" }, error: null as any },
    profiles: [{ id: "u1" }, { id: "u2" }] as any[],
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
      if (table === "profiles") {
        return { select: () => Promise.resolve({ data: state.profiles, error: null }) };
      }
      if (table === "notifications") {
        return { insert: (arr: any[]) => { rec.notifications = arr; return Promise.resolve({ error: null }); } };
      }
      return {};
    },
  },
}));

import { triggerWin } from "@/lib/win-trigger";

beforeEach(() => {
  rec.winInsert = undefined;
  rec.notifications = undefined;
  state.winResult = { data: { id: "w1" }, error: null };
  state.profiles = [{ id: "u1" }, { id: "u2" }];
});

describe("triggerWin idempotency", () => {
  it("writes idempotency_key and broadcasts on a fresh win", async () => {
    await triggerWin({
      agentId: "a1", agentName: "Dana Agent", contactName: "Pat Lee",
      contactId: "c1", organizationId: "org1", idempotencyKey: "conversion:L1",
    });
    expect(rec.winInsert.idempotency_key).toBe("conversion:L1");
    expect(rec.notifications).toHaveLength(2); // broadcast to both profiles
  });

  it("treats a 23505 unique violation as already-celebrated: no duplicate notifications", async () => {
    state.winResult = { data: null, error: { code: "23505", message: "duplicate key" } };
    await triggerWin({
      agentId: "a1", agentName: "Dana Agent", contactName: "Pat Lee",
      contactId: "c1", organizationId: "org1", idempotencyKey: "conversion:L1",
    });
    expect(rec.winInsert.idempotency_key).toBe("conversion:L1");
    expect(rec.notifications).toBeUndefined(); // no broadcast on idempotent retry
  });

  it("passes a null idempotency_key for non-conversion wins (additional policies allowed)", async () => {
    await triggerWin({
      agentId: "a1", agentName: "Dana Agent", contactName: "Pat Lee",
      contactId: "c1", organizationId: "org1",
    });
    expect(rec.winInsert.idempotency_key).toBeNull();
    expect(rec.notifications).toHaveLength(2);
  });
});
