/**
 * Fix 2 (traversal) — `usersSupabaseApi.getAgentScopeIds`.
 *
 * The Contacts → Agents tab must show the signed-in viewer plus every direct and
 * indirect downline profile, resolved recursively through `profiles.upline_id`.
 * `profiles.hierarchy_path` is NOT used: its production values are depth-1
 * self-labels, so `is_ancestor_of` is false for every distinct pair.
 *
 * This is Contacts-page query scoping, not a database authorization boundary — the
 * permissive organization-wide SELECT policy on `profiles` is unchanged. What these
 * tests lock is that the page asks for exactly the right ids and can never widen.
 *
 * All ids are synthetic. No production identifier appears in this file.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; status: string | null; orgId: string; uplineId: string | null };

type Recorded = {
  table: string;
  select?: string;
  eq: Record<string, unknown>;
  inCol?: string;
  inVals?: string[];
  neq?: { col: string; val: unknown };
  order?: { col: string };
  range?: { from: number; to: number };
};

const { recorded, state } = vi.hoisted(() => ({
  recorded: [] as Recorded[],
  state: {
    rows: [] as { id: string; status: string | null; orgId: string; uplineId: string | null }[],
    /** Reject the query at this 0-based index (-1 = never). */
    failAtQuery: -1,
  },
}));

vi.mock("@/integrations/supabase/client", () => {
  const settle = (ctx: Recorded) => {
    const index = recorded.length;
    recorded.push(ctx);
    if (index === state.failAtQuery) {
      return Promise.resolve({ data: null, error: { message: "traversal boom" } });
    }
    let rows = state.rows.filter(
      (r) =>
        r.orgId === ctx.eq.organization_id &&
        r.uplineId !== null &&
        (ctx.inVals ?? []).includes(r.uplineId),
    );
    rows = [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (ctx.range) rows = rows.slice(ctx.range.from, ctx.range.to + 1);
    return Promise.resolve({
      data: rows.map((r) => ({ id: r.id, status: r.status })),
      error: null,
    });
  };

  const makeBuilder = (table: string) => {
    const ctx: Recorded = { table, eq: {} };
    const b: Record<string, unknown> = {
      select(cols: string) { ctx.select = cols; return b; },
      eq(col: string, val: unknown) { ctx.eq[col] = val; return b; },
      neq(col: string, val: unknown) { ctx.neq = { col, val }; return b; },
      or() { return b; },
      in(col: string, vals: unknown[]) { ctx.inCol = col; ctx.inVals = [...vals] as string[]; return b; },
      order(col: string) { ctx.order = { col }; return b; },
      range(from: number, to: number) { ctx.range = { from, to }; return settle(ctx); },
      then(onF: unknown, onR: unknown) {
        return settle(ctx).then(onF as never, onR as never);
      },
    };
    return b;
  };

  return { supabase: { from: (table: string) => makeBuilder(table) } };
});

import {
  AGENT_SCOPE_ID_BATCH_SIZE,
  AGENT_SCOPE_MAX_PAGES_PER_BATCH,
  AGENT_SCOPE_MAX_ROUNDS,
  AGENT_SCOPE_PAGE_SIZE,
  usersSupabaseApi,
} from "@/lib/supabase-users";

/** Synthetic, deterministic, obviously-not-production ids. */
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";

/** §4.3 aliases. */
const ROOT_ADMIN = uid(1);
const RETIRED_ADMIN = uid(2);
const TEAM_LEADER_A = uid(3);
const AGENT_A = uid(4);
const AGENT_B = uid(5);
const AGENT_C = uid(6);
const RETIRED_TEAM_LEADER = uid(7);
const RETIRED_AGENT = uid(8);

const row = (
  id: string,
  uplineId: string | null,
  status: string | null = "Active",
  orgId = ORG,
): Row => ({ id, uplineId, status, orgId });

/** The verified production shape, expressed with synthetic ids. */
const PRODUCTION_SHAPE: Row[] = [
  row(ROOT_ADMIN, null),
  row(RETIRED_ADMIN, null, "Deleted"),
  row(TEAM_LEADER_A, ROOT_ADMIN),
  row(AGENT_A, ROOT_ADMIN),
  row(AGENT_B, ROOT_ADMIN),
  row(AGENT_C, ROOT_ADMIN),
  row(RETIRED_TEAM_LEADER, ROOT_ADMIN, "Deleted"),
  row(RETIRED_AGENT, RETIRED_TEAM_LEADER, "Deleted"),
];

const scopeOf = (viewerId: string, organizationId: string | null = ORG) =>
  usersSupabaseApi.getAgentScopeIds({ viewerId, organizationId });

beforeEach(() => {
  recorded.length = 0;
  state.rows = [];
  state.failAtQuery = -1;
});

describe("self inclusion", () => {
  it("always includes the signed-in viewer", async () => {
    state.rows = PRODUCTION_SHAPE;
    for (const viewer of [ROOT_ADMIN, TEAM_LEADER_A, AGENT_A]) {
      recorded.length = 0;
      expect(await scopeOf(viewer)).toContain(viewer);
    }
  });

  it("a viewer with no edges at all still sees themselves", async () => {
    const lonely = uid(90);
    state.rows = [row(lonely, null)];
    expect(await scopeOf(lonely)).toEqual([lonely]);
  });

  it("a leaf viewer resolves to exactly themselves in one query", async () => {
    state.rows = PRODUCTION_SHAPE;
    expect(await scopeOf(AGENT_A)).toEqual([AGENT_A]);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].inVals).toEqual([AGENT_A]);
  });
});

describe("descendant discovery", () => {
  it("includes direct descendants", async () => {
    state.rows = PRODUCTION_SHAPE;
    const scope = await scopeOf(ROOT_ADMIN);
    expect(scope).toEqual(expect.arrayContaining([TEAM_LEADER_A, AGENT_A, AGENT_B, AGENT_C]));
  });

  it("includes multi-level descendants across a deep chain", async () => {
    const chain = [uid(10), uid(11), uid(12), uid(13)];
    state.rows = [
      row(chain[0], null),
      row(chain[1], chain[0]),
      row(chain[2], chain[1]),
      row(chain[3], chain[2]),
    ];
    const scope = await scopeOf(chain[0]);
    expect(new Set(scope)).toEqual(new Set(chain));
    // One round per level that discovered something, plus the terminating round.
    expect(recorded).toHaveLength(4);
  });
});

describe("exclusions", () => {
  it("excludes the viewer's own manager (ancestor)", async () => {
    state.rows = PRODUCTION_SHAPE;
    expect(await scopeOf(AGENT_A)).not.toContain(ROOT_ADMIN);
  });

  it("excludes peers sharing the viewer's manager", async () => {
    state.rows = PRODUCTION_SHAPE;
    const scope = await scopeOf(AGENT_A);
    expect(scope).not.toContain(AGENT_B);
    expect(scope).not.toContain(AGENT_C);
    expect(scope).not.toContain(TEAM_LEADER_A);
  });

  it("excludes a sibling branch (cousin subtree)", async () => {
    const viewer = uid(20);
    const cousinParent = uid(21);
    const cousin = uid(22);
    state.rows = [
      row(uid(19), null),
      row(viewer, uid(19)),
      row(cousinParent, uid(19)),
      row(cousin, cousinParent),
    ];
    const scope = await scopeOf(viewer);
    expect(scope).toEqual([viewer]);
    expect(scope).not.toContain(cousin);
  });

  it("excludes unrelated same-organization members", async () => {
    const viewer = uid(30);
    const unrelatedRoot = uid(31);
    const unrelatedChild = uid(32);
    state.rows = [row(viewer, null), row(unrelatedRoot, null), row(unrelatedChild, unrelatedRoot)];
    expect(await scopeOf(viewer)).toEqual([viewer]);
  });

  it("never follows a cross-organization relationship", async () => {
    const viewer = uid(40);
    const foreignChild = uid(41);
    state.rows = [row(viewer, null), row(foreignChild, viewer, "Active", OTHER_ORG)];
    expect(await scopeOf(viewer)).toEqual([viewer]);
    for (const q of recorded) expect(q.eq.organization_id).toBe(ORG);
  });

  it("scopes every traversal round to the viewer's organization", async () => {
    state.rows = PRODUCTION_SHAPE;
    await scopeOf(ROOT_ADMIN);
    expect(recorded.length).toBeGreaterThan(1);
    for (const q of recorded) {
      expect(q.table).toBe("profiles");
      expect(q.eq.organization_id).toBe(ORG);
      expect(q.inCol).toBe("upline_id");
    }
  });
});

describe("Deleted profiles", () => {
  it("excludes a Deleted descendant from the visible scope", async () => {
    state.rows = PRODUCTION_SHAPE;
    const scope = await scopeOf(ROOT_ADMIN);
    expect(scope).not.toContain(RETIRED_TEAM_LEADER);
    expect(scope).not.toContain(RETIRED_AGENT);
  });

  it("traverses THROUGH a Deleted intermediate to reach an active descendant beneath it", async () => {
    const viewer = uid(50);
    const deletedMid = uid(51);
    const activeGrandchild = uid(52);
    const activeGreatGrandchild = uid(53);
    state.rows = [
      row(viewer, null),
      row(deletedMid, viewer, "Deleted"),
      row(activeGrandchild, deletedMid),
      row(activeGreatGrandchild, activeGrandchild),
    ];
    const scope = await scopeOf(viewer);
    expect(new Set(scope)).toEqual(new Set([viewer, activeGrandchild, activeGreatGrandchild]));
    expect(scope).not.toContain(deletedMid);
  });

  it("applies no status filter during traversal — a Deleted branch is walked, never cut", async () => {
    state.rows = PRODUCTION_SHAPE;
    await scopeOf(ROOT_ADMIN);
    for (const q of recorded) {
      expect(q.neq).toBeUndefined();
      expect(q.eq.status).toBeUndefined();
    }
    // The Deleted intermediate was genuinely enqueued and queried for children.
    const askedForRetiredTlChildren = recorded.some((q) =>
      (q.inVals ?? []).includes(RETIRED_TEAM_LEADER),
    );
    expect(askedForRetiredTlChildren).toBe(true);
  });
});

describe("cycle safety", () => {
  it("terminates on a cycle that points back at an ancestor", async () => {
    const a = uid(60);
    const b = uid(61);
    const c = uid(62);
    // a → b → c → a: c is recorded as a's manager, closing the loop.
    state.rows = [row(a, c), row(b, a), row(c, b)];
    const scope = await scopeOf(a);
    expect(new Set(scope)).toEqual(new Set([a, b, c]));
    expect(recorded.length).toBeLessThan(10);
  });

  it("terminates on a self-referencing upline_id", async () => {
    const viewer = uid(70);
    const child = uid(71);
    state.rows = [row(viewer, viewer), row(child, viewer)];
    const scope = await scopeOf(viewer);
    expect(new Set(scope)).toEqual(new Set([viewer, child]));
    expect(recorded.length).toBeLessThan(10);
  });

  it("never enqueues the same id twice", async () => {
    const viewer = uid(80);
    const shared = uid(81);
    state.rows = [row(viewer, null), row(shared, viewer)];
    await scopeOf(viewer);
    const allRequested = recorded.flatMap((q) => q.inVals ?? []);
    expect(allRequested).toHaveLength(new Set(allRequested).size);
  });
});

describe("batching and pagination — a large result set can never be silently truncated", () => {
  it("splits a 120-parent frontier into 50/50/20 and requests every id exactly once", async () => {
    expect(AGENT_SCOPE_ID_BATCH_SIZE).toBe(50);
    const viewer = uid(100);
    const children = Array.from({ length: 120 }, (_, i) => uid(1000 + i));
    state.rows = [row(viewer, null), ...children.map((id) => row(id, viewer))];

    const scope = await scopeOf(viewer);
    expect(scope).toHaveLength(121);

    // Round 1 = the viewer's own single batch. Round 2 = the 120-wide frontier.
    const roundTwo = recorded.slice(1);
    expect(roundTwo.map((q) => (q.inVals ?? []).length)).toEqual([50, 50, 20]);
    const union = roundTwo.flatMap((q) => q.inVals ?? []);
    expect(new Set(union)).toEqual(new Set(children));
    expect(union).toHaveLength(children.length);
  });

  it("pages a single batch until it is exhausted when the row limit is reached", async () => {
    const viewer = uid(200);
    const children = Array.from({ length: AGENT_SCOPE_PAGE_SIZE + 7 }, (_, i) => uid(20000 + i));
    state.rows = [row(viewer, null), ...children.map((id) => row(id, viewer))];

    const scope = await scopeOf(viewer);
    expect(scope).toHaveLength(children.length + 1);
    expect(new Set(scope)).toEqual(new Set([viewer, ...children]));

    // The viewer's batch needed two pages: a full one, then the short remainder.
    const viewerBatchPages = recorded.filter((q) => (q.inVals ?? []).includes(viewer));
    expect(viewerBatchPages).toHaveLength(2);
    expect(viewerBatchPages[0].range).toEqual({ from: 0, to: AGENT_SCOPE_PAGE_SIZE - 1 });
    expect(viewerBatchPages[1].range).toEqual({
      from: AGENT_SCOPE_PAGE_SIZE,
      to: AGENT_SCOPE_PAGE_SIZE * 2 - 1,
    });
  });

  it("stops paging a batch as soon as a short page comes back", async () => {
    state.rows = PRODUCTION_SHAPE;
    await scopeOf(ROOT_ADMIN);
    const firstBatchPages = recorded.filter((q) => (q.inVals ?? []).includes(ROOT_ADMIN));
    expect(firstBatchPages).toHaveLength(1);
    expect(firstBatchPages[0].range).toEqual({ from: 0, to: AGENT_SCOPE_PAGE_SIZE - 1 });
  });

  it("orders by a stable key so paging cannot drop or duplicate a row", async () => {
    state.rows = PRODUCTION_SHAPE;
    await scopeOf(ROOT_ADMIN);
    for (const q of recorded) expect(q.order).toEqual({ col: "id" });
  });
});

describe("fail closed", () => {
  it("returns an empty scope without querying when the viewer id is missing", async () => {
    state.rows = PRODUCTION_SHAPE;
    expect(await scopeOf("")).toEqual([]);
    expect(recorded).toHaveLength(0);
  });

  it("returns an empty scope without querying when the organization is missing", async () => {
    state.rows = PRODUCTION_SHAPE;
    expect(await scopeOf(ROOT_ADMIN, null)).toEqual([]);
    expect(recorded).toHaveLength(0);
  });

  it("rejects on a traversal query error — never a partial result", async () => {
    state.rows = PRODUCTION_SHAPE;
    state.failAtQuery = 1; // fail the SECOND round, after a partial set was discovered
    await expect(scopeOf(ROOT_ADMIN)).rejects.toThrow();
  });

  it("issues no query that lacks the organization and upline_id constraints", async () => {
    state.rows = PRODUCTION_SHAPE;
    state.failAtQuery = 1;
    await scopeOf(ROOT_ADMIN).catch(() => undefined);
    expect(recorded.length).toBeGreaterThan(0);
    for (const q of recorded) {
      expect(q.eq.organization_id).toBe(ORG);
      expect(q.inCol).toBe("upline_id");
      expect((q.inVals ?? []).length).toBeGreaterThan(0);
    }
  });

  it("throws rather than truncating when the depth cap is exceeded", async () => {
    const chain = Array.from({ length: AGENT_SCOPE_MAX_ROUNDS + 5 }, (_, i) => uid(30000 + i));
    state.rows = chain.map((id, i) => row(id, i === 0 ? null : chain[i - 1]));
    await expect(scopeOf(chain[0])).rejects.toThrow(/depth/i);
  });

  it("exposes a positive page cap so an unbounded batch cannot loop forever", () => {
    expect(AGENT_SCOPE_MAX_PAGES_PER_BATCH).toBeGreaterThan(0);
    expect(AGENT_SCOPE_MAX_ROUNDS).toBeGreaterThan(0);
    expect(AGENT_SCOPE_PAGE_SIZE).toBeGreaterThan(0);
  });
});

describe("production-shape parity (synthetic ids, verified graph)", () => {
  beforeEach(() => {
    state.rows = PRODUCTION_SHAPE;
  });

  it("the active root Admin sees self plus four active descendants", async () => {
    const scope = await scopeOf(ROOT_ADMIN);
    expect(new Set(scope)).toEqual(new Set([ROOT_ADMIN, TEAM_LEADER_A, AGENT_A, AGENT_B, AGENT_C]));
    expect(scope).toHaveLength(5);
  });

  it("the active Team Leader sees only themselves", async () => {
    expect(await scopeOf(TEAM_LEADER_A)).toEqual([TEAM_LEADER_A]);
  });

  it("each active Agent sees only themselves", async () => {
    for (const agent of [AGENT_A, AGENT_B, AGENT_C]) {
      recorded.length = 0;
      expect(await scopeOf(agent)).toEqual([agent]);
    }
  });

  it("no Deleted profile appears in any viewer's scope", async () => {
    for (const viewer of [ROOT_ADMIN, TEAM_LEADER_A, AGENT_A, AGENT_B, AGENT_C]) {
      recorded.length = 0;
      const scope = await scopeOf(viewer);
      expect(scope).not.toContain(RETIRED_ADMIN);
      expect(scope).not.toContain(RETIRED_TEAM_LEADER);
      expect(scope).not.toContain(RETIRED_AGENT);
    }
  });
});
