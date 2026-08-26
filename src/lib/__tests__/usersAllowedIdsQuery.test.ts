/**
 * Fix 2 (row fetch) — `usersSupabaseApi.getByIds` loads full profile rows for an
 * explicit scoped id set, and can never widen past it.
 *
 * Every query it issues — the primary one AND the schema-column fallback — must carry
 * the organization boundary, the explicit id set, and the existing non-deleted
 * visibility rule, with search applied inside the set and the existing sort preserved.
 * An empty id set must issue no query at all.
 *
 * The second half is the non-regression half: `getAll` is the organization-wide method
 * used by Settings → User Management and View As, and this change must not touch it.
 *
 * All ids are synthetic. No production identifier appears in this file.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Recorded = {
  table: string;
  select?: string;
  eq: Record<string, unknown>;
  neq?: { col: string; val: unknown };
  inCol?: string;
  inVals?: string[];
  or?: string;
  order?: { col: string; ascending?: boolean };
};

const { recorded, state } = vi.hoisted(() => ({
  recorded: [] as Recorded[],
  state: {
    results: [] as { data: unknown; error: unknown }[],
    fallback: { data: null as unknown, error: null as unknown },
  },
}));

vi.mock("@/integrations/supabase/client", () => {
  const settle = (ctx: Recorded) => {
    const index = recorded.length;
    recorded.push(ctx);
    const result = state.results[index] ?? { data: [], error: null };
    return Promise.resolve(result);
  };

  const makeBuilder = (table: string) => {
    const ctx: Recorded = { table, eq: {} };
    const b: Record<string, unknown> = {
      select(cols: string) { ctx.select = cols; return b; },
      eq(col: string, val: unknown) { ctx.eq[col] = val; return b; },
      neq(col: string, val: unknown) { ctx.neq = { col, val }; return b; },
      in(col: string, vals: unknown[]) { ctx.inCol = col; ctx.inVals = [...vals] as string[]; return b; },
      or(expr: string) { ctx.or = expr; return b; },
      order(col: string, opts?: { ascending?: boolean }) {
        ctx.order = { col, ...(opts ?? {}) };
        return settle(ctx);
      },
      then(onF: unknown, onR: unknown) { return settle(ctx).then(onF as never, onR as never); },
    };
    return b;
  };

  return { supabase: { from: (table: string) => makeBuilder(table) } };
});

import { usersSupabaseApi } from "@/lib/supabase-users";

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = "11111111-1111-4111-8111-111111111111";

const VIEWER = uid(1);
const DOWNLINE_A = uid(2);
const DOWNLINE_B = uid(3);
const SCOPE = [VIEWER, DOWNLINE_A, DOWNLINE_B];

const profileRow = (id: string) => ({
  id,
  first_name: "Test",
  last_name: "Profile",
  email: `${id}@example.test`,
  role: "Agent",
  status: "Active",
  created_at: "2026-01-01T00:00:00.000Z",
});

const ok = (rows: unknown[]) => ({ data: rows, error: null });
const schemaError = { data: null, error: { message: 'column profiles.billing_type does not exist' } };

beforeEach(() => {
  recorded.length = 0;
  state.results = [];
});

describe("getByIds — no scoped ids means no query", () => {
  it("an empty id array resolves to [] and never touches supabase", async () => {
    expect(await usersSupabaseApi.getByIds({ ids: [], organizationId: ORG })).toEqual([]);
    expect(recorded).toHaveLength(0);
  });

  it("an id array of only falsy entries resolves to [] and never touches supabase", async () => {
    expect(
      await usersSupabaseApi.getByIds({ ids: ["", null as never, undefined as never], organizationId: ORG }),
    ).toEqual([]);
    expect(recorded).toHaveLength(0);
  });

  it("a missing organization resolves to [] and never touches supabase", async () => {
    expect(await usersSupabaseApi.getByIds({ ids: SCOPE, organizationId: null })).toEqual([]);
    expect(await usersSupabaseApi.getByIds({ ids: SCOPE, organizationId: "  " })).toEqual([]);
    expect(recorded).toHaveLength(0);
  });
});

describe("getByIds — every constraint is present on the query", () => {
  it("applies the organization, the explicit id set, the Deleted exclusion and the existing sort", async () => {
    state.results = [ok(SCOPE.map(profileRow))];
    const users = await usersSupabaseApi.getByIds({ ids: SCOPE, organizationId: ORG });
    expect(users.map((u) => u.id)).toEqual(SCOPE);

    expect(recorded).toHaveLength(1);
    const q = recorded[0];
    expect(q.table).toBe("profiles");
    expect(q.eq.organization_id).toBe(ORG);
    expect(q.inCol).toBe("id");
    expect(q.inVals).toEqual(SCOPE);
    expect(q.neq).toEqual({ col: "status", val: "Deleted" });
    expect(q.order).toEqual({ col: "first_name", ascending: true });
  });

  it("de-duplicates ids and drops falsy entries without widening the set", async () => {
    state.results = [ok([])];
    await usersSupabaseApi.getByIds({
      ids: [VIEWER, DOWNLINE_A, VIEWER, "", DOWNLINE_A, DOWNLINE_B],
      organizationId: ORG,
    });
    expect(recorded[0].inVals).toEqual(SCOPE);
  });
});

describe("getByIds — search narrows, never widens", () => {
  it("adds an or() filter alongside — never instead of — the id, org and status filters", async () => {
    state.results = [ok([])];
    await usersSupabaseApi.getByIds({ ids: SCOPE, organizationId: ORG, search: "ada" });
    const q = recorded[0];
    expect(q.or).toContain("first_name.ilike.%ada%");
    expect(q.or).toContain("last_name.ilike.%ada%");
    expect(q.or).toContain("email.ilike.%ada%");
    expect(q.inVals).toEqual(SCOPE);
    expect(q.eq.organization_id).toBe(ORG);
    expect(q.neq).toEqual({ col: "status", val: "Deleted" });
  });

  it("a search term carrying PostgREST filter metacharacters cannot alter the scoped id set", async () => {
    state.results = [ok([])];
    await usersSupabaseApi.getByIds({
      ids: SCOPE,
      organizationId: ORG,
      search: 'a,b(c)*d\\e"f',
    });
    const q = recorded[0];
    expect(q.inVals).toEqual(SCOPE);
    expect(q.eq.organization_id).toBe(ORG);
    // The injected separators must not survive into the raw or() expression.
    const injected = q.or?.slice(q.or.indexOf("first_name.ilike.%") + "first_name.ilike.%".length) ?? "";
    expect(injected).not.toContain("(");
    expect(injected).not.toContain(")");
    expect(injected).not.toContain("\\");
  });

  it("the recorded id set is byte-identical with and without a search term", async () => {
    state.results = [ok([]), ok([])];
    await usersSupabaseApi.getByIds({ ids: SCOPE, organizationId: ORG });
    await usersSupabaseApi.getByIds({ ids: SCOPE, organizationId: ORG, search: "anything" });
    expect(recorded[1].inVals).toEqual(recorded[0].inVals);
  });
});

describe("getByIds — the schema fallback cannot widen the scope", () => {
  it("retries with the safe column set carrying the identical org, id and status constraints", async () => {
    state.results = [schemaError, ok(SCOPE.map(profileRow))];
    const users = await usersSupabaseApi.getByIds({ ids: SCOPE, organizationId: ORG });
    expect(users.map((u) => u.id)).toEqual(SCOPE);

    expect(recorded).toHaveLength(2);
    const [primary, fallback] = recorded;
    expect(fallback.eq.organization_id).toBe(primary.eq.organization_id);
    expect(fallback.inCol).toBe("id");
    expect(fallback.inVals).toEqual(SCOPE);
    expect(fallback.inVals?.length).toBeGreaterThan(0);
    expect(fallback.neq).toEqual({ col: "status", val: "Deleted" });
    expect(fallback.order).toEqual({ col: "first_name", ascending: true });
    // The fallback trims columns, never constraints.
    expect(fallback.select).not.toEqual(primary.select);
  });

  it("keeps the search filter on the fallback query too", async () => {
    state.results = [schemaError, ok([])];
    await usersSupabaseApi.getByIds({ ids: SCOPE, organizationId: ORG, search: "ada" });
    expect(recorded[1].or).toContain("first_name.ilike.%ada%");
    expect(recorded[1].inVals).toEqual(SCOPE);
  });

  it("propagates a non-schema error instead of silently resolving to an empty list", async () => {
    state.results = [{ data: null, error: { message: "permission denied for table profiles" } }];
    await expect(usersSupabaseApi.getByIds({ ids: SCOPE, organizationId: ORG })).rejects.toBeTruthy();
    expect(recorded).toHaveLength(1);
  });

  it("propagates a fallback error rather than returning partial rows", async () => {
    state.results = [schemaError, { data: null, error: { message: "still broken" } }];
    await expect(usersSupabaseApi.getByIds({ ids: SCOPE, organizationId: ORG })).rejects.toBeTruthy();
  });
});

describe("getByIds — a large scoped set is batched, never truncated", () => {
  // Review finding D1: `.in("id", ids)` is serialized into the PostgREST query string
  // and a response is capped server-side at a row limit. An unbatched several-hundred-id
  // set would produce an oversized URL and could silently return a truncated agent list —
  // a correctness defect on the Agents tab, which renders a single unpaginated fetch.
  const many = Array.from({ length: 120 }, (_, i) => uid(1000 + i));

  it("splits 120 scoped ids into 50/50/20 and requests every id exactly once", async () => {
    state.results = [ok([]), ok([]), ok([])];
    await usersSupabaseApi.getByIds({ ids: many, organizationId: ORG });

    expect(recorded).toHaveLength(3);
    expect(recorded.map((q) => (q.inVals ?? []).length)).toEqual([50, 50, 20]);
    const union = recorded.flatMap((q) => q.inVals ?? []);
    expect(union).toHaveLength(many.length);
    expect(new Set(union)).toEqual(new Set(many));
  });

  it("carries every constraint on every batch, not just the first", async () => {
    state.results = [ok([]), ok([]), ok([])];
    await usersSupabaseApi.getByIds({ ids: many, organizationId: ORG, search: "ada" });
    for (const q of recorded) {
      expect(q.table).toBe("profiles");
      expect(q.eq.organization_id).toBe(ORG);
      expect(q.neq).toEqual({ col: "status", val: "Deleted" });
      expect(q.or).toContain("first_name.ilike.%ada%");
      expect(q.order).toEqual({ col: "first_name", ascending: true });
      expect((q.inVals ?? []).length).toBeGreaterThan(0);
    }
  });

  it("returns every row from every batch, ordered by first name", async () => {
    // Deliberately out of order across batches so a naive concatenation is visible.
    state.results = [
      ok([{ ...profileRow(many[0]), first_name: "Zoe" }]),
      ok([{ ...profileRow(many[60]), first_name: "Ada" }]),
      ok([{ ...profileRow(many[110]), first_name: "Mo" }]),
    ];
    const users = await usersSupabaseApi.getByIds({ ids: many, organizationId: ORG });
    expect(users).toHaveLength(3);
    expect(users.map((u) => u.firstName)).toEqual(["Ada", "Mo", "Zoe"]);
  });

  it("a failing batch rejects instead of returning the batches that succeeded", async () => {
    state.results = [ok([profileRow(many[0])]), { data: null, error: { message: "boom" } }, ok([])];
    await expect(usersSupabaseApi.getByIds({ ids: many, organizationId: ORG })).rejects.toBeTruthy();
  });

  it("batches cannot widen the scope — the union never exceeds the requested ids", async () => {
    state.results = [ok([]), ok([]), ok([])];
    await usersSupabaseApi.getByIds({ ids: many, organizationId: ORG });
    const union = new Set(recorded.flatMap((q) => q.inVals ?? []));
    for (const id of union) expect(many).toContain(id);
  });
});

describe("getAll — unscoped and behaviourally unchanged", () => {
  it("never applies an id-set filter", async () => {
    state.results = [ok([])];
    await usersSupabaseApi.getAll({ organizationId: ORG });
    expect(recorded).toHaveLength(1);
    expect(recorded[0].inCol).toBeUndefined();
    expect(recorded[0].inVals).toBeUndefined();
  });

  it("keeps its organization filter, Deleted exclusion and first_name sort", async () => {
    state.results = [ok([])];
    await usersSupabaseApi.getAll({ organizationId: ORG });
    const q = recorded[0];
    expect(q.table).toBe("profiles");
    expect(q.eq.organization_id).toBe(ORG);
    expect(q.neq).toEqual({ col: "status", val: "Deleted" });
    expect(q.order).toEqual({ col: "first_name", ascending: true });
  });

  it("keeps its role/status filter behaviour, including the explicit-status branch", async () => {
    state.results = [ok([]), ok([])];
    await usersSupabaseApi.getAll({ organizationId: ORG, role: "Admin", status: "Active" });
    expect(recorded[0].eq.role).toBe("Admin");
    expect(recorded[0].eq.status).toBe("Active");
    expect(recorded[0].neq).toBeUndefined();

    await usersSupabaseApi.getAll({ organizationId: ORG, role: "All", status: "All" });
    expect(recorded[1].eq.role).toBeUndefined();
    expect(recorded[1].eq.status).toBeUndefined();
    expect(recorded[1].neq).toEqual({ col: "status", val: "Deleted" });
  });

  it("keeps its search behaviour, and still issues an organization-wide query with no org filter when none is given", async () => {
    state.results = [ok([])];
    await usersSupabaseApi.getAll({ search: "Ada", status: "Active" });
    const q = recorded[0];
    expect(q.or).toContain("first_name.ilike.%ada%");
    expect(q.eq.organization_id).toBeUndefined();
    expect(q.inVals).toBeUndefined();
  });
});
