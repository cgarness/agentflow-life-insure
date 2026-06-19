import { describe, it, expect, beforeEach, vi } from "vitest";
import type { LeadFilterPayload } from "@/lib/contactsFilters";

// Hoisted shared state the mocked supabase client reads/records.
const { recorded, rpcResults, fromResult } = vi.hoisted(() => ({
  recorded: [] as Array<Record<string, unknown>>,
  rpcResults: {} as Record<string, { data: unknown; error: unknown }>,
  fromResult: { value: { data: null as unknown, error: null as unknown } },
}));

vi.mock("@/integrations/supabase/client", () => {
  const makeBuilder = (table: string) => {
    const ctx: Record<string, unknown> = { table };
    const b: Record<string, unknown> = {
      select(p?: unknown) { ctx.select = p; return b; },
      // Record ctx by reference so later chain calls (.in()) remain visible.
      insert(p: unknown) { ctx.op = "insert"; ctx.payload = p; recorded.push(ctx); return b; },
      update(p: unknown) { ctx.op = "update"; ctx.payload = p; recorded.push(ctx); return b; },
      delete() { ctx.op = "delete"; recorded.push(ctx); return b; },
      eq() { return b; },
      in(_c: string, vals: unknown[]) { ctx.inVals = vals; return b; },
      or() { return b; },
      order() { return b; },
      range() { return b; },
      maybeSingle() { return Promise.resolve(fromResult.value); },
      single() { return Promise.resolve(fromResult.value); },
      then(onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) {
        return Promise.resolve(fromResult.value).then(onF, onR);
      },
    };
    return b;
  };
  return {
    supabase: {
      from: (t: string) => makeBuilder(t),
      // Returns a builder that is awaitable directly (jsonb RPCs) AND supports
      // .range() (set-returning RPCs paginated by the caller).
      rpc: (name: string, args: unknown) => {
        recorded.push({ rpc: name, args });
        const res = rpcResults[name] ?? { data: null, error: null };
        const builder: Record<string, unknown> = {
          order() { return builder; }, // .order("ord") is chainable before .range()
          range(from: number, to: number) {
            const full = Array.isArray(res.data) ? (res.data as unknown[]) : [];
            return Promise.resolve(
              res.error ? { data: null, error: res.error } : { data: full.slice(from, to + 1), error: null },
            );
          },
          then(onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) {
            return Promise.resolve(res).then(onF, onR);
          },
        };
        return builder;
      },
    },
  };
});

import { leadsSupabaseApi } from "@/lib/supabase-contacts";
import { clientsSupabaseApi } from "@/lib/supabase-clients";
import { recruitsSupabaseApi } from "@/lib/supabase-recruits";

const payload: LeadFilterPayload = {
  scope: "team",
  agent_ids: ["a"],
  search: "x",
  timezone_states: ["CA"],
  callable_states: ["CA"],
  attempt_buckets: ["4+"],
  last_disposition: "Busy",
  page: 0,
  page_size: 50,
};

const rpcCalls = (name: string) => recorded.filter((r) => r.rpc === name);

beforeEach(() => {
  recorded.length = 0;
  for (const k of Object.keys(rpcResults)) delete rpcResults[k];
  fromResult.value = { data: null, error: null };
});

describe("leads getAll — RPC-backed rows + exact total", () => {
  it("maps rows with server aggregates and the exact total_count", async () => {
    rpcResults["search_contacts_leads"] = {
      data: {
        total_count: 2,
        rows: [
          { id: "l1", first_name: "A", last_name: "B", attempt_count: 4, last_disposition: "Interested" },
          { id: "l2", first_name: "C", last_name: "D", attempt_count: 0, last_disposition: null },
        ],
      },
      error: null,
    };
    const res = await leadsSupabaseApi.getAll(payload);
    expect(res.totalCount).toBe(2);
    expect(res.data).toHaveLength(2);
    expect(res.data[0].attemptCount).toBe(4);
    expect(res.data[0].lastDisposition).toBe("Interested");
    expect(res.data[1].attemptCount).toBe(0);
    expect(res.data[1].lastDisposition).toBeUndefined();
    // The page query carries the exact canonical payload.
    expect(rpcCalls("search_contacts_leads")[0].args).toEqual({ p_filters: payload });
  });

  it("throws on RPC error (no silent empty result)", async () => {
    rpcResults["search_contacts_leads"] = { data: null, error: { message: "boom" } };
    await expect(leadsSupabaseApi.getAll(payload)).rejects.toThrow("boom");
  });
});

describe("filter parity — matching IDs use the SAME canonical payload as the list", () => {
  it("getAllLeadIdsMatching forwards the identical payload the list used", async () => {
    rpcResults["search_contacts_leads"] = { data: { total_count: 0, rows: [] }, error: null };
    // The matching-ids RPC returns (id, ord) rows in the canonical sort order.
    rpcResults["contacts_lead_ids_matching"] = {
      data: [{ id: "l1", ord: 1 }, { id: "l2", ord: 2 }, { id: "l3", ord: 3 }],
      error: null,
    };

    await leadsSupabaseApi.getAll(payload);
    const ids = await leadsSupabaseApi.getAllLeadIdsMatching(payload);

    expect(ids).toEqual(["l1", "l2", "l3"]);
    // Same p_filters → rows / count / ids cannot drift.
    expect(rpcCalls("search_contacts_leads")[0].args).toEqual({ p_filters: payload });
    expect(rpcCalls("contacts_lead_ids_matching")[0].args).toEqual({ p_filters: payload });
    expect(rpcCalls("contacts_lead_ids_matching")[0].args).toEqual(rpcCalls("search_contacts_leads")[0].args);
  });

  it("tolerates scalar or object id rows from PostgREST", async () => {
    rpcResults["contacts_lead_ids_matching"] = { data: [{ id: "l1" }, "l2"], error: null };
    const ids = await leadsSupabaseApi.getAllLeadIdsMatching(payload);
    expect(ids).toEqual(["l1", "l2"]);
  });

  it("retrieves >1000 matching ids via paginated ranges (uncapped), then bulk-assigns in bounded chunks", async () => {
    // (id, ord) rows in canonical sort order, spanning 3 ranges.
    const bigRows = Array.from({ length: 2500 }, (_, i) => ({ id: `l${i}`, ord: i }));
    rpcResults["contacts_lead_ids_matching"] = { data: bigRows, error: null };

    const ids = await leadsSupabaseApi.getAllLeadIdsMatching(payload);
    expect(ids).toHaveLength(2500);
    expect(ids[0]).toBe("l0");
    expect(ids[2499]).toBe("l2499");
    expect(new Set(ids).size).toBe(2500); // no duplicates across ranges
    // Retrieval used 3 bounded range requests (0-999, 1000-1999, 2000-2999), not one call.
    expect(rpcCalls("contacts_lead_ids_matching")).toHaveLength(3);

    // Bulk assign chunks the 2500 ids into bounded 1000-row updates and sums the
    // ACTUAL affected rows returned per chunk (never the pre-action total).
    fromResult.value = { data: [{ id: "x" }], error: null }; // 1 affected per chunk
    const n = await leadsSupabaseApi.bulkAssign(ids, "agent-9");
    const updateChunks = recorded.filter((r) => r.table === "leads" && r.op === "update");
    expect(updateChunks).toHaveLength(3);
    expect((updateChunks[0] as { inVals?: unknown[] }).inVals).toHaveLength(1000);
    expect((updateChunks[1] as { inVals?: unknown[] }).inVals).toHaveLength(1000);
    expect((updateChunks[2] as { inVals?: unknown[] }).inVals).toHaveLength(500);
    expect(n).toBe(3);
  });
});

describe("bulk status / delete — actual affected rows, errors surfaced", () => {
  it("updateStatusAllMatching returns the ACTUAL affected-row count", async () => {
    rpcResults["contacts_lead_ids_matching"] = { data: ["l1", "l2"], error: null };
    fromResult.value = { data: [{ id: "l1" }, { id: "l2" }], error: null };
    const n = await leadsSupabaseApi.updateStatusAllMatching("Contacted", payload);
    expect(n).toBe(2);
    // The lead update was scoped to exactly the matching ids.
    const upd = recorded.find((r) => r.table === "leads" && r.op === "update");
    expect(upd?.inVals).toEqual(["l1", "l2"]);
  });

  it("deleteAllMatching throws when a chunk delete errors (never false success)", async () => {
    rpcResults["contacts_lead_ids_matching"] = { data: ["l1"], error: null };
    fromResult.value = { data: null, error: { message: "delete denied" } };
    await expect(leadsSupabaseApi.deleteAllMatching(payload)).rejects.toThrow("delete denied");
  });

  it("deleteAllMatching short-circuits to 0 with no matching ids", async () => {
    rpcResults["contacts_lead_ids_matching"] = { data: [], error: null };
    expect(await leadsSupabaseApi.deleteAllMatching(payload)).toBe(0);
  });
});

describe("clients / recruits — select-all ids (RPC) + scope-safe bulk", () => {
  it("clients getAllIdsMatching (RPC) returns ids; bulkAssign reports affected count", async () => {
    // ids come from the sort-aware RPC (id, ord); bulkAssign still updates the base table.
    rpcResults["contacts_client_ids_matching"] = { data: [{ id: "c1", ord: 1 }, { id: "c2", ord: 2 }], error: null };
    const ids = await clientsSupabaseApi.getAllIdsMatching({ assignedAgentIds: ["me"] });
    expect(ids).toEqual(["c1", "c2"]);
    fromResult.value = { data: [{ id: "c1" }, { id: "c2" }], error: null };
    const n = await clientsSupabaseApi.bulkAssign(["c1", "c2"], "agent-9");
    expect(n).toBe(2);
    const upd = recorded.find((r) => r.table === "clients" && r.op === "update");
    expect((upd?.payload as { assigned_agent_id?: string })?.assigned_agent_id).toBe("agent-9");
    expect(upd?.inVals).toEqual(["c1", "c2"]);
  });

  it("recruits deleteAllMatching (RPC ids) surfaces delete errors", async () => {
    rpcResults["contacts_recruit_ids_matching"] = { data: [{ id: "r1", ord: 1 }], error: null };
    const ids = await recruitsSupabaseApi.getAllIdsMatching({ assignedAgentIds: ["me"] });
    expect(ids).toEqual(["r1"]);
    fromResult.value = { data: null, error: { message: "nope" } };
    await expect(recruitsSupabaseApi.deleteAllMatching({ assignedAgentIds: ["me"] })).rejects.toThrow("nope");
  });
});
