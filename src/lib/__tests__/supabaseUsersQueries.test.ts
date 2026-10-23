/**
 * Query contracts of `usersSupabaseApi` touched by hierarchy stabilization:
 *  - F8  `getDownlineAgents(uplineId, organizationId)`: explicit org filter, direct reports
 *        only, no query without an organization;
 *  - F9  `getAll`'s schema-column fallback keeps the Deleted exclusion and the status, role,
 *        search and organization filters;
 *  - F5  `getByIds` role / status narrowing on the primary AND fallback query;
 *  - F4  `getUplineChainIds`: org-filtered every hop, walks through Deleted, cycle-safe,
 *        capped, rejects on error;
 *  - F6  `deleteUser` never starts the contact transfer unless the caller's own PROFILE row
 *        (not the JWT) is an Admin / Super Admin of the member's organization, and reports a
 *        zero-row soft delete as a failure;
 *  - F1  `updateProfile` with a payload that omits `uplineId` / `commissionLevel` never
 *        lists `upline_id` / `commission_level` in the PATCH;
 *  - `update`, `assignUpline` and `removeFromTeam` read the row back, so an UPDATE that RLS
 *        filtered to zero rows rejects with `PROFILE_UPDATE_REFUSED` instead of succeeding;
 *  - `getAll`'s search term goes through the same sanitizer as `getByIds`, which neutralises
 *    the PostgREST metacharacters `,` `(` `)` `*` `"` `\` but keeps the apostrophe, so a search
 *    for "O'Brien" sends `ilike.%o'brien%` and still matches.
 *
 * All ids are synthetic. No production identifier appears in this file.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Recorded = {
  table: string;
  op: "select" | "update";
  select?: string;
  returning?: string;
  payload?: Record<string, unknown>;
  eq: Record<string, unknown>;
  neq: Record<string, unknown>;
  inCol?: string;
  inVals?: string[];
  or?: string;
  order: { col: string; ascending?: boolean }[];
  range?: { from: number; to: number };
  single?: boolean;
};

type Result = { data: unknown; error: unknown };

const { recorded, state, reassignAllContacts } = vi.hoisted(() => ({
  recorded: [] as Recorded[],
  state: {
    respond: (() => ({ data: [], error: null })) as (q: Recorded, index: number) => Result,
    session: null as null | { user: { id: string; app_metadata?: Record<string, unknown> } },
  },
  reassignAllContacts: vi.fn(async () => ({ leads: 0, clients: 0, recruits: 0 })),
}));

vi.mock("@/integrations/supabase/client", () => {
  const makeBuilder = (table: string) => {
    const ctx: Recorded = { table, op: "select", eq: {}, neq: {}, order: [] };
    let settled: Promise<Result> | null = null;
    const settle = () => {
      if (!settled) {
        const index = recorded.length;
        recorded.push(ctx);
        settled = Promise.resolve(state.respond(ctx, index));
      }
      return settled;
    };
    const b: Record<string, unknown> = {
      select(cols: string) {
        if (ctx.op === "update") ctx.returning = cols;
        else ctx.select = cols;
        return b;
      },
      update(payload: Record<string, unknown>) { ctx.op = "update"; ctx.payload = payload; return b; },
      eq(col: string, val: unknown) { ctx.eq[col] = val; return b; },
      neq(col: string, val: unknown) { ctx.neq[col] = val; return b; },
      in(col: string, vals: unknown[]) { ctx.inCol = col; ctx.inVals = [...vals] as string[]; return b; },
      or(expr: string) { ctx.or = expr; return b; },
      order(col: string, opts?: { ascending?: boolean }) { ctx.order.push({ col, ...(opts ?? {}) }); return b; },
      range(from: number, to: number) { ctx.range = { from, to }; return b; },
      maybeSingle() { ctx.single = true; return b; },
      then(onF: unknown, onR: unknown) { return settle().then(onF as never, onR as never); },
    };
    return b;
  };
  return {
    supabase: {
      from: (table: string) => makeBuilder(table),
      auth: { getSession: async () => ({ data: { session: state.session }, error: null }) },
    },
  };
});

vi.mock("@/lib/supabase-contacts", () => ({ leadsSupabaseApi: { reassignAllContacts } }));

import { AGENT_SCOPE_MAX_ROUNDS, PROFILE_UPDATE_REFUSED, usersSupabaseApi } from "@/lib/supabase-users";

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";

const ok = (data: unknown): Result => ({ data, error: null });
const fail = (message: string): Result => ({ data: null, error: { message } });
const schemaError = fail("column profiles.billing_type does not exist");

beforeEach(() => {
  recorded.length = 0;
  state.respond = () => ok([]);
  state.session = null;
  reassignAllContacts.mockClear();
});

describe("getDownlineAgents (F8) — org-scoped direct reports", () => {
  it("constrains organization, direct upline and the Deleted exclusion, sorted by first name", async () => {
    state.respond = () =>
      ok([
        { id: uid(2), first_name: "Ada", last_name: "One" },
        { id: uid(3), first_name: "Bo", last_name: "Two" },
      ]);
    const agents = await usersSupabaseApi.getDownlineAgents(uid(1), ORG);
    expect(agents).toEqual([
      { id: uid(2), firstName: "Ada", lastName: "One" },
      { id: uid(3), firstName: "Bo", lastName: "Two" },
    ]);
    expect(recorded).toHaveLength(1);
    const q = recorded[0];
    expect(q.table).toBe("profiles");
    expect(q.select).toBe("id, first_name, last_name");
    expect(q.eq).toEqual({ organization_id: ORG, upline_id: uid(1) });
    expect(q.neq).toEqual({ status: "Deleted" });
    expect(q.inCol).toBeUndefined();
    expect(q.order).toEqual([{ col: "first_name", ascending: true }]);
  });

  it("issues no query and resolves to [] without an organization", async () => {
    expect(await usersSupabaseApi.getDownlineAgents(uid(1), null)).toEqual([]);
    expect(await usersSupabaseApi.getDownlineAgents(uid(1), undefined)).toEqual([]);
    expect(await usersSupabaseApi.getDownlineAgents(uid(1), "  ")).toEqual([]);
    expect(recorded).toHaveLength(0);
  });

  it("issues no query and resolves to [] without an upline", async () => {
    expect(await usersSupabaseApi.getDownlineAgents("", ORG)).toEqual([]);
    expect(recorded).toHaveLength(0);
  });

  it("keeps its fail-narrow error behaviour: an error resolves to []", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    state.respond = () => fail("boom");
    expect(await usersSupabaseApi.getDownlineAgents(uid(1), ORG)).toEqual([]);
    spy.mockRestore();
  });
});

describe("getAll (F9) — the schema fallback trims columns, never constraints", () => {
  const silenceWarn = () => vi.spyOn(console, "warn").mockImplementation(() => undefined);

  it("keeps the Deleted exclusion, role, search and organization on the fallback", async () => {
    const warn = silenceWarn();
    state.respond = (_q, i) => (i === 0 ? schemaError : ok([]));
    await usersSupabaseApi.getAll({ organizationId: ORG, role: "Agent", search: "Ada" });
    warn.mockRestore();

    expect(recorded).toHaveLength(2);
    const [primary, fallback] = recorded;
    for (const q of [primary, fallback]) {
      expect(q.eq.organization_id).toBe(ORG);
      expect(q.eq.role).toBe("Agent");
      expect(q.eq.status).toBeUndefined();
      expect(q.neq).toEqual({ status: "Deleted" });
      expect(q.or).toContain("first_name.ilike.%ada%");
      expect(q.or).toContain("email.ilike.%ada%");
      expect(q.order).toEqual([{ col: "first_name", ascending: true }]);
    }
    expect(fallback.select).not.toEqual(primary.select);
    expect(fallback.select).not.toContain("upline_id");
  });

  it("keeps an explicit status filter (and no Deleted exclusion) on the fallback", async () => {
    const warn = silenceWarn();
    state.respond = (_q, i) => (i === 0 ? schemaError : ok([]));
    await usersSupabaseApi.getAll({ organizationId: ORG, status: "Inactive", role: "All" });
    warn.mockRestore();
    const fallback = recorded[1];
    expect(fallback.eq.status).toBe("Inactive");
    expect(fallback.eq.role).toBeUndefined();
    expect(fallback.neq).toEqual({});
  });

  it("maps fallback rows with the safe defaults", async () => {
    const warn = silenceWarn();
    state.respond = (_q, i) =>
      i === 0 ? schemaError : ok([{ id: uid(5), first_name: "Ada", last_name: "L", role: "Agent", status: "Active" }]);
    const users = await usersSupabaseApi.getAll({ organizationId: ORG });
    warn.mockRestore();
    expect(users).toHaveLength(1);
    expect(users[0].id).toBe(uid(5));
    expect(users[0].profile.licensedStates).toEqual([]);
    expect(users[0].profile.monthlyCallGoal).toBe(0);
    expect(users[0].profile.uplineId).toBeUndefined();
  });

  it("propagates a fallback error", async () => {
    const warn = silenceWarn();
    state.respond = (_q, i) => (i === 0 ? schemaError : fail("still broken"));
    await expect(usersSupabaseApi.getAll({ organizationId: ORG })).rejects.toBeTruthy();
    warn.mockRestore();
  });

  it("sanitizes the search term like getByIds: no PostgREST metacharacter reaches .or()", async () => {
    await usersSupabaseApi.getAll({ organizationId: ORG, search: 'Ad,a)*\\"x' });
    expect(recorded[0].or).toBe("first_name.ilike.%ad a    x%,last_name.ilike.%ad a    x%,email.ilike.%ad a    x%");
    expect(recorded[0].eq.organization_id).toBe(ORG);
  });

  it("a term that sanitizes to nothing adds no .or() filter", async () => {
    await usersSupabaseApi.getAll({ organizationId: ORG, search: ' ,()* ' });
    expect(recorded[0].or).toBeUndefined();
  });
});

describe("search sanitizer — apostrophes kept, PostgREST metacharacters neutralised", () => {
  const SCOPE = [uid(1), uid(2), uid(3)];
  const orFor = (term: string) => `first_name.ilike.%${term}%,last_name.ilike.%${term}%,email.ilike.%${term}%`;

  it("getAll sends an apostrophe name as typed (lower-cased): O'Brien → ilike.%o'brien%", async () => {
    await usersSupabaseApi.getAll({ organizationId: ORG, search: "O'Brien" });
    expect(recorded).toHaveLength(1);
    expect(recorded[0].or).toBe(orFor("o'brien"));
    expect(recorded[0].eq.organization_id).toBe(ORG);
  });

  it("getByIds sends an apostrophe name as typed (lower-cased) inside the scoped set", async () => {
    await usersSupabaseApi.getByIds({ ids: SCOPE, organizationId: ORG, search: "O'Brien" });
    expect(recorded).toHaveLength(1);
    expect(recorded[0].or).toBe(orFor("o'brien"));
    expect(recorded[0].eq.organization_id).toBe(ORG);
    expect(recorded[0].inVals).toEqual(SCOPE);
  });

  it("the apostrophe survives the schema fallback query too", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    state.respond = (_q, i) => (i === 0 ? schemaError : ok([]));
    await usersSupabaseApi.getAll({ organizationId: ORG, search: "D'Angelo" });
    warn.mockRestore();
    expect(recorded).toHaveLength(2);
    for (const q of recorded) expect(q.or).toBe(orFor("d'angelo"));
  });

  it("( ) , \" \\ and * are still neutralised to spaces by getAll and getByIds", async () => {
    // Each reserved character becomes one space; the apostrophe stays.
    const raw = 'O\'B(r)i,e"n\\x*y';
    const expected = "o'b r i e n x y";
    await usersSupabaseApi.getAll({ organizationId: ORG, search: raw });
    await usersSupabaseApi.getByIds({ ids: SCOPE, organizationId: ORG, search: raw });
    expect(recorded).toHaveLength(2);
    for (const q of recorded) {
      expect(q.or).toBe(orFor(expected));
      // The interpolated term can never open a new logic-tree branch or quoted value.
      expect(q.or!.split(",")).toHaveLength(3);
      expect(q.or).not.toMatch(/[()"\\*]/);
    }
  });

  it("an apostrophe-only term is a real search, while a metacharacter-only term adds no .or()", async () => {
    await usersSupabaseApi.getAll({ organizationId: ORG, search: " ' " });
    await usersSupabaseApi.getByIds({ ids: SCOPE, organizationId: ORG, search: ' (,)"\\* ' });
    expect(recorded[0].or).toBe(orFor("'"));
    expect(recorded[1].or).toBeUndefined();
  });
});

describe("getByIds (F5) — optional role / status narrowing inside the scoped set", () => {
  const SCOPE = [uid(1), uid(2), uid(3)];

  it("applies role and status alongside the org, id and Deleted constraints", async () => {
    await usersSupabaseApi.getByIds({ ids: SCOPE, organizationId: ORG, role: "Agent", status: "Inactive" });
    const q = recorded[0];
    expect(q.eq).toEqual({ organization_id: ORG, role: "Agent", status: "Inactive" });
    expect(q.inCol).toBe("id");
    expect(q.inVals).toEqual(SCOPE);
    expect(q.neq).toEqual({ status: "Deleted" });
  });

  it("treats \"All\" and absent values as no narrowing", async () => {
    await usersSupabaseApi.getByIds({ ids: SCOPE, organizationId: ORG, role: "All", status: "All" });
    await usersSupabaseApi.getByIds({ ids: SCOPE, organizationId: ORG });
    for (const q of recorded) expect(q.eq).toEqual({ organization_id: ORG });
  });

  it("can never return Deleted rows, even when asked for status Deleted", async () => {
    await usersSupabaseApi.getByIds({ ids: SCOPE, organizationId: ORG, status: "Deleted" });
    const q = recorded[0];
    // status = 'Deleted' AND status <> 'Deleted' matches nothing.
    expect(q.eq.status).toBe("Deleted");
    expect(q.neq).toEqual({ status: "Deleted" });
  });

  it("keeps role and status on the schema fallback query", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    state.respond = (_q, i) => (i === 0 ? schemaError : ok([]));
    await usersSupabaseApi.getByIds({ ids: SCOPE, organizationId: ORG, role: "Team Leader", status: "Active", search: "x" });
    warn.mockRestore();
    expect(recorded).toHaveLength(2);
    const fallback = recorded[1];
    expect(fallback.eq).toEqual({ organization_id: ORG, role: "Team Leader", status: "Active" });
    expect(fallback.inVals).toEqual(SCOPE);
    expect(fallback.neq).toEqual({ status: "Deleted" });
    expect(fallback.or).toContain("first_name.ilike.%x%");
  });

  it("applies role and status to every batch of a large set", async () => {
    const many = Array.from({ length: 120 }, (_, i) => uid(1000 + i));
    await usersSupabaseApi.getByIds({ ids: many, organizationId: ORG, role: "Agent", status: "Active" });
    expect(recorded).toHaveLength(3);
    for (const q of recorded) {
      expect(q.eq).toEqual({ organization_id: ORG, role: "Agent", status: "Active" });
      expect(q.neq).toEqual({ status: "Deleted" });
    }
  });
});

describe("getUplineChainIds (F4) — the reporting line above a profile", () => {
  type P = { id: string; upline_id: string | null; organization_id: string };
  const serve = (rows: P[]) => {
    state.respond = (q) => {
      const hit = rows.find((r) => r.id === q.eq.id && r.organization_id === q.eq.organization_id);
      return ok(hit ? { id: hit.id, upline_id: hit.upline_id } : null);
    };
  };

  it("returns the ancestors nearest-first, excluding the profile itself", async () => {
    serve([
      { id: uid(1), upline_id: null, organization_id: ORG },
      { id: uid(2), upline_id: uid(1), organization_id: ORG },
      { id: uid(3), upline_id: uid(2), organization_id: ORG },
    ]);
    expect(await usersSupabaseApi.getUplineChainIds({ profileId: uid(3), organizationId: ORG })).toEqual([uid(2), uid(1)]);
    expect(recorded.map((q) => q.eq.id)).toEqual([uid(3), uid(2), uid(1)]);
  });

  it("filters every hop by organization and reads only id and upline_id", async () => {
    serve([
      { id: uid(1), upline_id: null, organization_id: ORG },
      { id: uid(2), upline_id: uid(1), organization_id: ORG },
    ]);
    await usersSupabaseApi.getUplineChainIds({ profileId: uid(2), organizationId: ORG });
    expect(recorded.length).toBeGreaterThan(0);
    for (const q of recorded) {
      expect(q.table).toBe("profiles");
      expect(q.select).toBe("id, upline_id");
      expect(q.eq.organization_id).toBe(ORG);
      expect(q.single).toBe(true);
      expect(q.op).toBe("select");
    }
  });

  it("a root profile has an empty chain", async () => {
    serve([{ id: uid(1), upline_id: null, organization_id: ORG }]);
    expect(await usersSupabaseApi.getUplineChainIds({ profileId: uid(1), organizationId: ORG })).toEqual([]);
  });

  it("walks through Deleted ancestors and returns them", async () => {
    // The status is not even selected: a Deleted manager is just another hop.
    serve([
      { id: uid(1), upline_id: null, organization_id: ORG },
      { id: uid(2), upline_id: uid(1), organization_id: ORG },
      { id: uid(3), upline_id: uid(2), organization_id: ORG },
    ]);
    const chain = await usersSupabaseApi.getUplineChainIds({ profileId: uid(3), organizationId: ORG });
    expect(chain).toContain(uid(2));
    for (const q of recorded) expect(q.eq.status).toBeUndefined();
  });

  it("ends the chain at an upline outside the organization and never returns it", async () => {
    serve([
      { id: uid(1), upline_id: null, organization_id: OTHER_ORG },
      { id: uid(2), upline_id: uid(1), organization_id: ORG },
    ]);
    expect(await usersSupabaseApi.getUplineChainIds({ profileId: uid(2), organizationId: ORG })).toEqual([]);
  });

  it("returns [] when the starting profile is not in the organization", async () => {
    serve([{ id: uid(2), upline_id: null, organization_id: OTHER_ORG }]);
    expect(await usersSupabaseApi.getUplineChainIds({ profileId: uid(2), organizationId: ORG })).toEqual([]);
    expect(recorded).toHaveLength(1);
  });

  it("terminates on a cycle without repeating an id", async () => {
    serve([
      { id: uid(1), upline_id: uid(3), organization_id: ORG },
      { id: uid(2), upline_id: uid(1), organization_id: ORG },
      { id: uid(3), upline_id: uid(2), organization_id: ORG },
    ]);
    const chain = await usersSupabaseApi.getUplineChainIds({ profileId: uid(3), organizationId: ORG });
    expect(chain).toEqual([uid(2), uid(1)]);
    expect(recorded.length).toBeLessThan(10);
  });

  it("terminates on a self-referencing upline", async () => {
    serve([{ id: uid(1), upline_id: uid(1), organization_id: ORG }]);
    expect(await usersSupabaseApi.getUplineChainIds({ profileId: uid(1), organizationId: ORG })).toEqual([]);
    expect(recorded).toHaveLength(1);
  });

  it("accepts a chain of exactly AGENT_SCOPE_MAX_ROUNDS ancestors", async () => {
    const ids = Array.from({ length: AGENT_SCOPE_MAX_ROUNDS + 1 }, (_, i) => uid(5000 + i));
    serve(ids.map((id, i) => ({ id, upline_id: i === 0 ? null : ids[i - 1], organization_id: ORG })));
    const chain = await usersSupabaseApi.getUplineChainIds({ profileId: ids[ids.length - 1], organizationId: ORG });
    expect(chain).toHaveLength(AGENT_SCOPE_MAX_ROUNDS);
  });

  it("throws rather than truncating when the chain exceeds the cap", async () => {
    const ids = Array.from({ length: AGENT_SCOPE_MAX_ROUNDS + 3 }, (_, i) => uid(6000 + i));
    serve(ids.map((id, i) => ({ id, upline_id: i === 0 ? null : ids[i - 1], organization_id: ORG })));
    await expect(
      usersSupabaseApi.getUplineChainIds({ profileId: ids[ids.length - 1], organizationId: ORG }),
    ).rejects.toThrow(/depth/i);
  });

  it("rejects on a query error — never a partial chain", async () => {
    state.respond = (_q, i) => (i === 0 ? ok({ id: uid(2), upline_id: uid(1) }) : fail("boom"));
    await expect(usersSupabaseApi.getUplineChainIds({ profileId: uid(2), organizationId: ORG })).rejects.toBeTruthy();
  });

  it("issues no query without a profile or organization", async () => {
    expect(await usersSupabaseApi.getUplineChainIds({ profileId: "", organizationId: ORG })).toEqual([]);
    expect(await usersSupabaseApi.getUplineChainIds({ profileId: uid(1), organizationId: null })).toEqual([]);
    expect(recorded).toHaveLength(0);
  });
});

describe("deleteUser (F6) — no contact transfer unless the caller's PROFILE administers the member", () => {
  const ACTOR = uid(10);
  const MEMBER = uid(11);
  const TARGET_AGENT = uid(12);

  type ActorRow = { role: string; organization_id: string; is_super_admin: boolean } | null;
  const serve = (actor: ActorRow, member: { organization_id: string } | null, softDeleteRows: unknown[] = [{ id: MEMBER }]) => {
    state.respond = (q) => {
      if (q.op === "update") return ok(softDeleteRows);
      if (q.eq.id === ACTOR) return ok(actor ? { id: ACTOR, ...actor } : null);
      if (q.eq.id === MEMBER) return ok(member ? { id: MEMBER, ...member } : null);
      return ok(null);
    };
  };
  const updates = () => recorded.filter((q) => q.op === "update");

  beforeEach(() => {
    state.session = { user: { id: ACTOR } };
  });

  it("an Admin of the member's organization transfers, then soft-deletes", async () => {
    serve({ role: "Admin", organization_id: ORG, is_super_admin: false }, { organization_id: ORG });
    await usersSupabaseApi.deleteUser(MEMBER, TARGET_AGENT);
    expect(reassignAllContacts).toHaveBeenCalledWith(MEMBER, TARGET_AGENT);
    const [softDelete] = updates();
    expect(softDelete.eq.id).toBe(MEMBER);
    expect(softDelete.payload).toMatchObject({ status: "Deleted", availability_status: "Offline" });
    expect(softDelete.returning).toBe("id");
  });

  it("reads the caller's and the member's profile rows — the database, never the JWT", async () => {
    serve({ role: "Admin", organization_id: ORG, is_super_admin: false }, { organization_id: ORG });
    await usersSupabaseApi.deleteUser(MEMBER, TARGET_AGENT);
    const reads = recorded.filter((q) => q.op === "select");
    expect(reads.map((q) => q.eq.id).sort()).toEqual([ACTOR, MEMBER].sort());
    const actorRead = reads.find((q) => q.eq.id === ACTOR);
    expect(actorRead?.select).toContain("role");
    expect(actorRead?.select).toContain("is_super_admin");
    expect(actorRead?.select).toContain("organization_id");
  });

  it("a Team Leader caller is refused before any write — no transfer, no soft delete", async () => {
    serve({ role: "Team Leader", organization_id: ORG, is_super_admin: false }, { organization_id: ORG });
    await expect(usersSupabaseApi.deleteUser(MEMBER, TARGET_AGENT)).rejects.toThrow(/Admin/);
    expect(reassignAllContacts).not.toHaveBeenCalled();
    expect(updates()).toHaveLength(0);
  });

  it("an Agent caller is refused before any write", async () => {
    serve({ role: "Agent", organization_id: ORG, is_super_admin: false }, { organization_id: ORG });
    await expect(usersSupabaseApi.deleteUser(MEMBER, TARGET_AGENT)).rejects.toThrow();
    expect(reassignAllContacts).not.toHaveBeenCalled();
    expect(updates()).toHaveLength(0);
  });

  it("a demoted Admin whose token still says Admin is refused (the profile decides)", async () => {
    state.session = { user: { id: ACTOR, app_metadata: { role: "Admin", organization_id: ORG } } };
    serve({ role: "Team Leader", organization_id: ORG, is_super_admin: false }, { organization_id: ORG });
    await expect(usersSupabaseApi.deleteUser(MEMBER, TARGET_AGENT)).rejects.toThrow();
    expect(reassignAllContacts).not.toHaveBeenCalled();
    expect(updates()).toHaveLength(0);
  });

  it("an Admin of ANOTHER organization is refused", async () => {
    serve({ role: "Admin", organization_id: OTHER_ORG, is_super_admin: false }, { organization_id: ORG });
    await expect(usersSupabaseApi.deleteUser(MEMBER, TARGET_AGENT)).rejects.toThrow();
    expect(reassignAllContacts).not.toHaveBeenCalled();
  });

  it("a Super Admin role in the member's organization, or an is_super_admin profile, is allowed", async () => {
    serve({ role: "Super Admin", organization_id: ORG, is_super_admin: false }, { organization_id: ORG });
    await usersSupabaseApi.deleteUser(MEMBER, TARGET_AGENT);
    serve({ role: "Agent", organization_id: OTHER_ORG, is_super_admin: true }, { organization_id: ORG });
    await usersSupabaseApi.deleteUser(MEMBER, TARGET_AGENT);
    expect(reassignAllContacts).toHaveBeenCalledTimes(2);
  });

  it("refuses when there is no session, or the caller's / member's row cannot be read", async () => {
    state.session = null;
    serve({ role: "Admin", organization_id: ORG, is_super_admin: false }, { organization_id: ORG });
    await expect(usersSupabaseApi.deleteUser(MEMBER, TARGET_AGENT)).rejects.toThrow();

    state.session = { user: { id: ACTOR } };
    serve(null, { organization_id: ORG });
    await expect(usersSupabaseApi.deleteUser(MEMBER, TARGET_AGENT)).rejects.toThrow();

    serve({ role: "Admin", organization_id: ORG, is_super_admin: false }, null);
    await expect(usersSupabaseApi.deleteUser(MEMBER, TARGET_AGENT)).rejects.toThrow();

    expect(reassignAllContacts).not.toHaveBeenCalled();
    expect(updates()).toHaveLength(0);
  });

  it("a profile read error rejects without any write", async () => {
    state.respond = (q) => (q.op === "select" ? fail("permission denied") : ok([{ id: MEMBER }]));
    await expect(usersSupabaseApi.deleteUser(MEMBER, TARGET_AGENT)).rejects.toBeTruthy();
    expect(reassignAllContacts).not.toHaveBeenCalled();
    expect(updates()).toHaveLength(0);
  });

  it("without a transfer, issues only the database-guarded soft delete", async () => {
    serve({ role: "Team Leader", organization_id: ORG, is_super_admin: false }, { organization_id: ORG });
    await usersSupabaseApi.deleteUser(MEMBER);
    expect(reassignAllContacts).not.toHaveBeenCalled();
    expect(recorded.filter((q) => q.op === "select")).toHaveLength(0);
    expect(updates()).toHaveLength(1);
  });

  it("a soft delete that RLS filtered to zero rows is a failure, not a false success", async () => {
    serve({ role: "Admin", organization_id: ORG, is_super_admin: false }, { organization_id: ORG }, []);
    await expect(usersSupabaseApi.deleteUser(MEMBER)).rejects.toThrow(/permission denied|not found/);
  });

  it("a soft delete error propagates", async () => {
    state.respond = (q) => (q.op === "update" ? fail("Only an Admin of this organization may change account-control fields") : ok(null));
    await expect(usersSupabaseApi.deleteUser(MEMBER)).rejects.toBeTruthy();
  });
});

describe("updateProfile (F1) — an omitted upline / commission is never in the PATCH", () => {
  const MEMBER = uid(20);

  it("omits upline_id and commission_level when the payload omits them", async () => {
    state.respond = () => ok([{ id: MEMBER, first_name: "A", last_name: "B" }]);
    await usersSupabaseApi.updateProfile(MEMBER, { npn: "123", timezone: "Central Time (US & Canada)", licensedStates: [] });
    const [patch] = recorded.filter((q) => q.op === "update");
    expect(patch.eq.id).toBe(MEMBER);
    expect(patch.payload).not.toHaveProperty("upline_id");
    expect(patch.payload).not.toHaveProperty("commission_level");
    expect(patch.payload).toMatchObject({ npn: "123", licensed_states: [] });
  });

  it("sends upline_id: null when the payload explicitly clears it", async () => {
    state.respond = () => ok([{ id: MEMBER }]);
    await usersSupabaseApi.updateProfile(MEMBER, { uplineId: null as unknown as string });
    const [patch] = recorded.filter((q) => q.op === "update");
    expect(patch.payload).toHaveProperty("upline_id", null);
  });

  it("still reports an RLS-filtered update as a failure", async () => {
    state.respond = () => ok([]);
    await expect(usersSupabaseApi.updateProfile(MEMBER, { npn: "1" })).rejects.toThrow(/permission denied/);
  });
});

describe("update / assignUpline / removeFromTeam — an RLS-filtered write is a failure, not a success", () => {
  const MEMBER = uid(30);
  const LEADER = uid(31);
  const writes = () => recorded.filter((q) => q.op === "update");

  it("update PATCHes the one row and reads it back", async () => {
    state.respond = () => ok([{ id: MEMBER }]);
    await usersSupabaseApi.update(MEMBER, { firstName: "Ada" });
    const [patch] = writes();
    expect(patch.eq).toEqual({ id: MEMBER });
    expect(patch.returning).toBe("id");
    expect(patch.payload).toMatchObject({ first_name: "Ada" });
  });

  it("assignUpline and removeFromTeam PATCH upline_id and read the row back", async () => {
    state.respond = () => ok([{ id: MEMBER }]);
    await usersSupabaseApi.assignUpline(MEMBER, LEADER);
    await usersSupabaseApi.removeFromTeam(MEMBER);
    const [assign, remove] = writes();
    expect(assign.payload).toMatchObject({ upline_id: LEADER });
    expect(remove.payload).toHaveProperty("upline_id", null);
    for (const q of [assign, remove]) {
      expect(q.eq).toEqual({ id: MEMBER });
      expect(q.returning).toBe("id");
    }
  });

  it.each([
    ["update", () => usersSupabaseApi.update(MEMBER, { firstName: "Ada" })],
    ["assignUpline", () => usersSupabaseApi.assignUpline(MEMBER, LEADER)],
    ["removeFromTeam", () => usersSupabaseApi.removeFromTeam(MEMBER)],
  ])("%s rejects with PROFILE_UPDATE_REFUSED when zero rows come back", async (_name, run) => {
    for (const empty of [[], null]) {
      state.respond = () => ok(empty);
      await expect(run()).rejects.toThrow(PROFILE_UPDATE_REFUSED);
    }
  });

  it("a database error still propagates unchanged", async () => {
    const guard = { message: "Only an Admin of this organization may change account-control fields", code: "42501" };
    state.respond = () => ({ data: null, error: guard });
    await expect(usersSupabaseApi.assignUpline(MEMBER, LEADER)).rejects.toBe(guard);
  });

  it("uses the deleteUser zero-row wording", () => {
    expect(PROFILE_UPDATE_REFUSED).toBe("Update failed: user profile not found or permission denied.");
  });
});
