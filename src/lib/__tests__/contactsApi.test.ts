import { describe, it, expect, beforeEach, vi } from "vitest";

// Hoisted shared state the mocked supabase client reads/records.
const { recorded, state } = vi.hoisted(() => ({
  recorded: [] as Array<{ table: string; op: string; payload: any; inVals?: unknown[] }>,
  state: { result: { data: null as unknown, error: null as unknown } },
}));

vi.mock("@/integrations/supabase/client", () => {
  const makeBuilder = (table: string) => {
    const ctx: { table: string; op?: string; payload?: any; inVals?: unknown[] } = { table };
    const b: any = {
      insert(p: any) { ctx.op = "insert"; ctx.payload = p; recorded.push(ctx as any); return b; },
      update(p: any) { ctx.op = "update"; ctx.payload = p; recorded.push(ctx as any); return b; },
      select() { return b; },
      eq() { return b; },
      in(_col: string, vals: unknown[]) { ctx.inVals = vals; return b; },
      single() { return Promise.resolve(state.result); },
      maybeSingle() { return Promise.resolve(state.result); },
      // Thenable so `await builder` (e.g. .update().in().select("id")) resolves to the result.
      then(onF: any, onR: any) { return Promise.resolve(state.result).then(onF, onR); },
    };
    return b;
  };
  return { supabase: { from: (table: string) => makeBuilder(table) } };
});

import { clientsSupabaseApi } from "@/lib/supabase-clients";
import { recruitsSupabaseApi } from "@/lib/supabase-recruits";
import { leadsSupabaseApi } from "@/lib/supabase-contacts";

const ORG = "org-1";
const clientRow = { id: "c1", first_name: "A", last_name: "B", created_at: "2024-01-01", updated_at: "2024-01-01" };
const recruitRow = { id: "r1", first_name: "A", last_name: "B", created_at: "2024-01-01", updated_at: "2024-01-01" };

beforeEach(() => {
  recorded.length = 0;
  state.result = { data: null, error: null };
});

describe("create requires organization context", () => {
  it("client create includes organization_id in the insert payload", async () => {
    state.result = { data: clientRow, error: null };
    await clientsSupabaseApi.create(
      { firstName: "A", lastName: "B", premiumAmount: "", faceAmount: "" } as any,
      ORG,
    );
    const ins = recorded.find((r) => r.table === "clients" && r.op === "insert");
    expect(ins?.payload.organization_id).toBe(ORG);
  });

  it("client create throws when org is missing — no insert attempted", async () => {
    await expect(
      clientsSupabaseApi.create({ firstName: "A", lastName: "B" } as any, null),
    ).rejects.toThrow(/organization/i);
    expect(recorded.find((r) => r.table === "clients" && r.op === "insert")).toBeUndefined();
  });

  it("recruit create includes organization_id; throws when missing", async () => {
    state.result = { data: recruitRow, error: null };
    await recruitsSupabaseApi.create({ firstName: "A", lastName: "B" } as any, ORG);
    expect(recorded.find((r) => r.table === "recruits" && r.op === "insert")?.payload.organization_id).toBe(ORG);

    recorded.length = 0;
    await expect(
      recruitsSupabaseApi.create({ firstName: "A", lastName: "B" } as any, null),
    ).rejects.toThrow(/organization/i);
    expect(recorded.find((r) => r.table === "recruits" && r.op === "insert")).toBeUndefined();
  });
});

describe("bulk assignment persistence", () => {
  it("lead bulkAssign writes assigned_agent_id AND user_id", async () => {
    state.result = { data: [{ id: "l1" }, { id: "l2" }], error: null };
    const n = await leadsSupabaseApi.bulkAssign(["l1", "l2"], "agent-9");
    expect(n).toBe(2);
    const upd = recorded.find((r) => r.table === "leads" && r.op === "update");
    expect(upd?.payload.assigned_agent_id).toBe("agent-9");
    expect(upd?.payload.user_id).toBe("agent-9");
    expect(upd?.inVals).toEqual(["l1", "l2"]);
  });

  it("client bulkAssign writes assigned_agent_id (and no user_id)", async () => {
    state.result = { data: [{ id: "c1" }], error: null };
    await clientsSupabaseApi.bulkAssign(["c1"], "agent-9");
    const upd = recorded.find((r) => r.table === "clients" && r.op === "update");
    expect(upd?.payload.assigned_agent_id).toBe("agent-9");
    expect(upd?.payload).not.toHaveProperty("user_id");
  });

  it("recruit bulkAssign writes assigned_agent_id", async () => {
    state.result = { data: [{ id: "r1" }], error: null };
    await recruitsSupabaseApi.bulkAssign(["r1"], "agent-9");
    expect(recorded.find((r) => r.table === "recruits" && r.op === "update")?.payload.assigned_agent_id).toBe("agent-9");
  });

  it("a failed assignment throws — caller keeps selection and shows no success", async () => {
    state.result = { data: null, error: { message: "RLS denied" } };
    await expect(leadsSupabaseApi.bulkAssign(["l1"], "agent-9")).rejects.toThrow(/RLS denied/);
  });

  it("an empty id list is a no-op (no update issued)", async () => {
    const n = await clientsSupabaseApi.bulkAssign([], "agent-9");
    expect(n).toBe(0);
    expect(recorded.length).toBe(0);
  });
});

describe("zero-row getById is safe (no mapper crash)", () => {
  it("client getById throws not-found instead of mapping null", async () => {
    state.result = { data: null, error: null };
    await expect(clientsSupabaseApi.getById("missing")).rejects.toThrow(/not found/i);
  });

  it("recruit getById throws not-found instead of mapping null", async () => {
    state.result = { data: null, error: null };
    await expect(recruitsSupabaseApi.getById("missing")).rejects.toThrow(/not found/i);
  });

  it("lead getById throws not-found instead of mapping null", async () => {
    state.result = { data: null, error: null };
    await expect(leadsSupabaseApi.getById("missing")).rejects.toThrow(/not found/i);
  });
});
