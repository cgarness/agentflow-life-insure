/**
 * F4 — `loadHierarchyTreeData`: the rows behind Settings → Hierarchy.
 *
 * Query scoping, not authorization (`profiles_select_org` permits same-org reads). These
 * tests lock that every request carries the explicit organization, selects display columns
 * only (never `hierarchy_path`, never the full `getByIds` projection), loads Deleted rows so
 * an Active member beneath a Deleted manager stays attached, keeps Team Leader / Agent
 * viewers to their own reporting line (upline chain + downline walk, no peers), fails closed
 * without an organization and rejects on any error.
 *
 * The real `usersSupabaseApi` walks run against an in-memory `profiles` table.
 * All ids are synthetic. No production identifier appears in this file.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Profile = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  status: string;
  organization_id: string;
  upline_id: string | null;
  avatar_url: string | null;
  hierarchy_path: string;
  commission_level: string;
  created_at: string;
};

type Recorded = {
  table: string;
  select?: string;
  eq: Record<string, unknown>;
  neq: Record<string, unknown>;
  inCol?: string;
  inVals?: unknown[];
  order: { col: string; ascending?: boolean }[];
  range?: { from: number; to: number };
  single?: boolean;
};

const { recorded, state } = vi.hoisted(() => ({
  recorded: [] as Recorded[],
  state: {
    rows: [] as Profile[],
    failWhen: null as null | ((q: Recorded) => boolean),
  },
}));

vi.mock("@/integrations/supabase/client", () => {
  const run = (q: Recorded) => {
    recorded.push(q);
    if (state.failWhen?.(q)) return { data: null, error: { message: "query failed" } };
    let rows = state.rows.filter(
      (r) =>
        Object.entries(q.eq).every(([c, v]) => (r as Record<string, unknown>)[c] === v) &&
        Object.entries(q.neq).every(([c, v]) => (r as Record<string, unknown>)[c] !== v) &&
        (!q.inCol || (q.inVals ?? []).includes((r as Record<string, unknown>)[q.inCol])),
    );
    for (const o of [...q.order].reverse()) {
      rows = [...rows].sort((a, b) => {
        const av = String((a as Record<string, unknown>)[o.col] ?? "");
        const bv = String((b as Record<string, unknown>)[o.col] ?? "");
        return (av < bv ? -1 : av > bv ? 1 : 0) * (o.ascending === false ? -1 : 1);
      });
    }
    if (q.range) rows = rows.slice(q.range.from, q.range.to + 1);
    const cols = (q.select ?? "*").split(",").map((c) => c.trim());
    const project = (r: Profile) => Object.fromEntries(cols.map((c) => [c, (r as Record<string, unknown>)[c]]));
    if (q.single) return { data: rows[0] ? project(rows[0]) : null, error: null };
    return { data: rows.map(project), error: null };
  };

  const makeBuilder = (table: string) => {
    const q: Recorded = { table, eq: {}, neq: {}, order: [] };
    let settled: Promise<unknown> | null = null;
    const b: Record<string, unknown> = {
      select(cols: string) { q.select = cols; return b; },
      eq(c: string, v: unknown) { q.eq[c] = v; return b; },
      neq(c: string, v: unknown) { q.neq[c] = v; return b; },
      in(c: string, v: unknown[]) { q.inCol = c; q.inVals = [...v]; return b; },
      order(c: string, o?: { ascending?: boolean }) { q.order.push({ col: c, ...(o ?? {}) }); return b; },
      range(from: number, to: number) { q.range = { from, to }; return b; },
      maybeSingle() { q.single = true; return b; },
      then(onF: unknown, onR: unknown) {
        if (!settled) settled = Promise.resolve(run(q));
        return settled.then(onF as never, onR as never);
      },
    };
    return b;
  };
  return { supabase: { from: (t: string) => makeBuilder(t) } };
});

import { AGENT_SCOPE_PAGE_SIZE } from "@/lib/supabase-users";
import { buildProfileOrgForest, type ProfileOrgNode } from "@/lib/profile-org-tree";
import { HIERARCHY_TREE_COLUMNS, loadHierarchyTreeData } from "@/lib/hierarchy/hierarchyTreeData";

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";

const ROOT_ADMIN = uid(1);
const TEAM_LEADER_A = uid(2);
const AGENT_A = uid(3);
const AGENT_B = uid(4);
const RETIRED_UNDER_TL = uid(5);
const AGENT_C = uid(6);
const RETIRED_TL = uid(7);
const RETIRED_AGENT = uid(8);
const DELETED_MID = uid(9);
const GRANDCHILD = uid(10);
const FOREIGN = uid(11);

let seq = 0;
const p = (id: string, role: string, upline: string | null, status = "Active", org = ORG): Profile => ({
  id,
  first_name: `F${id.slice(-2)}`,
  last_name: "Test",
  email: `${id.slice(-4)}@example.test`,
  role,
  status,
  organization_id: org,
  upline_id: upline,
  avatar_url: null,
  hierarchy_path: "stale",
  commission_level: "50%",
  created_at: `2026-01-01T00:00:${String(seq++ % 60).padStart(2, "0")}.000Z`,
});

/** Production `upline_id` shape (synthetic), plus a Deleted manager with an Active report. */
const SHAPE: Profile[] = [
  p(ROOT_ADMIN, "Admin", null),
  p(TEAM_LEADER_A, "Team Leader", ROOT_ADMIN),
  p(AGENT_A, "Agent", TEAM_LEADER_A),
  p(AGENT_B, "Agent", TEAM_LEADER_A),
  p(RETIRED_UNDER_TL, "Agent", TEAM_LEADER_A, "Deleted"),
  p(AGENT_C, "Agent", ROOT_ADMIN),
  p(RETIRED_TL, "Team Leader", ROOT_ADMIN, "Deleted"),
  p(RETIRED_AGENT, "Agent", RETIRED_TL, "Deleted"),
  p(DELETED_MID, "Team Leader", TEAM_LEADER_A, "Deleted"),
  p(GRANDCHILD, "Agent", DELETED_MID),
  p(FOREIGN, "Admin", null, "Active", OTHER_ORG),
];

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

beforeEach(() => {
  recorded.length = 0;
  state.rows = SHAPE;
  state.failWhen = null;
});

describe("every request", () => {
  const viewers = [
    { viewerId: ROOT_ADMIN, organizationId: ORG, role: "Admin" },
    { viewerId: TEAM_LEADER_A, organizationId: ORG, role: "Team Leader" },
    { viewerId: AGENT_A, organizationId: ORG, role: "Agent" },
  ];

  it("carries the explicit organization filter", async () => {
    for (const viewer of viewers) await loadHierarchyTreeData(viewer);
    expect(recorded.length).toBeGreaterThan(3);
    for (const q of recorded) {
      expect(q.table).toBe("profiles");
      expect(q.eq.organization_id).toBe(ORG);
    }
  });

  it("never selects hierarchy_path or the full profile projection", async () => {
    for (const viewer of viewers) await loadHierarchyTreeData(viewer);
    for (const q of recorded) {
      expect(q.select).not.toContain("hierarchy_path");
      expect(q.select).not.toContain("commission_level");
      expect(q.select).not.toContain("npn");
    }
  });

  it("never filters on status: Deleted rows are loaded for attachment", async () => {
    for (const viewer of viewers) await loadHierarchyTreeData(viewer);
    for (const q of recorded) {
      expect(q.eq.status).toBeUndefined();
      expect(q.neq).toEqual({});
    }
  });

  it("returns rows with exactly the display columns", async () => {
    const { rows } = await loadHierarchyTreeData(viewers[1]);
    const expected = HIERARCHY_TREE_COLUMNS.split(",").map((c) => c.trim()).sort();
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(expected);
    expect(expected).toEqual(["avatar_url", "email", "first_name", "id", "last_name", "role", "status", "upline_id"]);
  });
});

describe("fail closed", () => {
  it("issues no query without an organization", async () => {
    expect(await loadHierarchyTreeData({ viewerId: ROOT_ADMIN, organizationId: null, role: "Admin" })).toEqual({
      rows: [],
      scope: "none",
    });
    expect(await loadHierarchyTreeData({ viewerId: ROOT_ADMIN, organizationId: "  ", role: "Admin", isSuperAdmin: true })).toEqual({
      rows: [],
      scope: "none",
    });
    expect(recorded).toHaveLength(0);
  });

  it("issues no query without a viewer", async () => {
    expect(await loadHierarchyTreeData({ viewerId: null, organizationId: ORG, role: "Team Leader" })).toEqual({
      rows: [],
      scope: "none",
    });
    expect(recorded).toHaveLength(0);
  });

  it("rejects on an organization load error", async () => {
    state.failWhen = () => true;
    await expect(loadHierarchyTreeData({ viewerId: ROOT_ADMIN, organizationId: ORG, role: "Admin" })).rejects.toBeTruthy();
  });

  it("rejects on a downline walk, upline chain or row batch error — never a partial chart", async () => {
    const tl = { viewerId: TEAM_LEADER_A, organizationId: ORG, role: "Team Leader" };
    for (const failWhen of [
      (q: Recorded) => q.inCol === "upline_id",
      (q: Recorded) => q.single === true,
      (q: Recorded) => q.inCol === "id",
    ]) {
      state.failWhen = failWhen;
      await expect(loadHierarchyTreeData(tl)).rejects.toBeTruthy();
    }
  });
});

describe("Admin / Super Admin viewers — the whole organization", () => {
  it("loads every org profile, Deleted included, never another organization's", async () => {
    const { rows, scope } = await loadHierarchyTreeData({ viewerId: ROOT_ADMIN, organizationId: ORG, role: "Admin" });
    expect(scope).toBe("organization");
    expect(new Set(ids(rows))).toEqual(new Set(SHAPE.filter((r) => r.organization_id === ORG).map((r) => r.id)));
    expect(ids(rows)).not.toContain(FOREIGN);
    // The Active report beneath a Deleted manager and the manager itself are both present.
    expect(ids(rows)).toEqual(expect.arrayContaining([DELETED_MID, GRANDCHILD]));
  });

  it("is one org-filtered, created_at-ordered, paged query", async () => {
    await loadHierarchyTreeData({ viewerId: ROOT_ADMIN, organizationId: ORG, role: "Admin" });
    expect(recorded).toHaveLength(1);
    const [q] = recorded;
    expect(q.select).toBe(HIERARCHY_TREE_COLUMNS);
    expect(q.eq).toEqual({ organization_id: ORG });
    expect(q.inCol).toBeUndefined();
    expect(q.order).toEqual([
      { col: "created_at", ascending: true },
      { col: "id", ascending: true },
    ]);
    expect(q.range).toEqual({ from: 0, to: AGENT_SCOPE_PAGE_SIZE - 1 });
  });

  it("pages until a short page — a large organization is never truncated", async () => {
    const big = Array.from({ length: AGENT_SCOPE_PAGE_SIZE + 3 }, (_, i) => p(uid(10000 + i), "Agent", null));
    state.rows = big;
    const { rows } = await loadHierarchyTreeData({ viewerId: big[0].id, organizationId: ORG, role: "Admin" });
    expect(rows).toHaveLength(big.length);
    expect(recorded.map((q) => q.range)).toEqual([
      { from: 0, to: AGENT_SCOPE_PAGE_SIZE - 1 },
      { from: AGENT_SCOPE_PAGE_SIZE, to: AGENT_SCOPE_PAGE_SIZE * 2 - 1 },
    ]);
  });

  it("a Super Admin role, or an is_super_admin profile with any role, takes the organization path", async () => {
    expect((await loadHierarchyTreeData({ viewerId: ROOT_ADMIN, organizationId: ORG, role: "Super Admin" })).scope).toBe("organization");
    expect((await loadHierarchyTreeData({ viewerId: AGENT_A, organizationId: ORG, role: "Agent", isSuperAdmin: true })).scope).toBe(
      "organization",
    );
  });
});

describe("Team Leader / Agent viewers — their own reporting line only", () => {
  it("a Team Leader gets its upline chain, itself and its whole downline incl. Deleted rows — no peers", async () => {
    const { rows, scope } = await loadHierarchyTreeData({ viewerId: TEAM_LEADER_A, organizationId: ORG, role: "Team Leader" });
    expect(scope).toBe("reporting-line");
    expect(new Set(ids(rows))).toEqual(
      new Set([ROOT_ADMIN, TEAM_LEADER_A, AGENT_A, AGENT_B, RETIRED_UNDER_TL, DELETED_MID, GRANDCHILD]),
    );
    for (const peer of [AGENT_C, RETIRED_TL, RETIRED_AGENT, FOREIGN]) expect(ids(rows)).not.toContain(peer);
  });

  it("orders managers before their reports: chain root-first, then the walk", async () => {
    const { rows } = await loadHierarchyTreeData({ viewerId: TEAM_LEADER_A, organizationId: ORG, role: "Team Leader" });
    const order = ids(rows);
    expect(order[0]).toBe(ROOT_ADMIN);
    expect(order[1]).toBe(TEAM_LEADER_A);
    expect(order.indexOf(DELETED_MID)).toBeLessThan(order.indexOf(GRANDCHILD));
  });

  it("an Agent gets its upline chain and itself", async () => {
    const { rows } = await loadHierarchyTreeData({ viewerId: AGENT_A, organizationId: ORG, role: "Agent" });
    expect(ids(rows)).toEqual([ROOT_ADMIN, TEAM_LEADER_A, AGENT_A]);
  });

  it("an Active report beneath a Deleted manager keeps its Deleted manager in the rows", async () => {
    const { rows } = await loadHierarchyTreeData({ viewerId: GRANDCHILD, organizationId: ORG, role: "Agent" });
    expect(ids(rows)).toEqual([ROOT_ADMIN, TEAM_LEADER_A, DELETED_MID, GRANDCHILD]);
    expect(rows.find((r) => r.id === DELETED_MID)?.status).toBe("Deleted");
  });

  it("issues only org-constrained walk rounds, chain hops and id batches", async () => {
    await loadHierarchyTreeData({ viewerId: TEAM_LEADER_A, organizationId: ORG, role: "Team Leader" });
    for (const q of recorded) {
      const kind = q.inCol === "upline_id" ? "walk" : q.single ? "chain" : q.inCol === "id" ? "batch" : "other";
      expect(kind).not.toBe("other");
      expect(q.eq.organization_id).toBe(ORG);
      if (kind === "batch") expect(q.select).toBe(HIERARCHY_TREE_COLUMNS);
    }
    expect(recorded.filter((q) => q.inCol === "id")).toHaveLength(1);
  });

  it("batches a large reporting line by 50 ids", async () => {
    const reports = Array.from({ length: 70 }, (_, i) => p(uid(20000 + i), "Agent", TEAM_LEADER_A));
    state.rows = [...SHAPE, ...reports];
    const { rows } = await loadHierarchyTreeData({ viewerId: TEAM_LEADER_A, organizationId: ORG, role: "Team Leader" });
    expect(rows.length).toBe(7 + reports.length);
    const batches = recorded.filter((q) => q.inCol === "id");
    expect(batches.map((q) => (q.inVals ?? []).length)).toEqual([50, 27]);
  });
});

describe("rows feed the existing forest builder, Deleted managers attached", () => {
  const childrenOf = <T extends { id: string }>(roots: ProfileOrgNode<T & { upline_id: string | null }>[], id: string): string[] => {
    const stack = [...roots];
    while (stack.length) {
      const node = stack.pop()!;
      if (node.id === id) return node.children.map((c) => c.id);
      stack.push(...node.children);
    }
    return [];
  };

  it("for an Admin, the Active report stays under its Deleted manager in one tree", async () => {
    const { rows } = await loadHierarchyTreeData({ viewerId: ROOT_ADMIN, organizationId: ORG, role: "Admin" });
    const forest = buildProfileOrgForest(rows);
    expect(forest.map((r) => r.id)).toEqual([ROOT_ADMIN]);
    expect(childrenOf(forest, DELETED_MID)).toEqual([GRANDCHILD]);
    expect(childrenOf(forest, TEAM_LEADER_A)).toEqual(expect.arrayContaining([AGENT_A, AGENT_B, DELETED_MID]));
  });

  it("for a Team Leader, its reporting line is one tree rooted at the top of its chain", async () => {
    const { rows } = await loadHierarchyTreeData({ viewerId: TEAM_LEADER_A, organizationId: ORG, role: "Team Leader" });
    const forest = buildProfileOrgForest(rows);
    expect(forest.map((r) => r.id)).toEqual([ROOT_ADMIN]);
    expect(childrenOf(forest, ROOT_ADMIN)).toEqual([TEAM_LEADER_A]);
    expect(childrenOf(forest, DELETED_MID)).toEqual([GRANDCHILD]);
  });
});
