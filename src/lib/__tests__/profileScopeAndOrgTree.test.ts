/**
 * Scope resolution and org-tree shaping — the security-sensitive half of the Team Profile.
 *
 * Downline scoping in AgentFlow is QUERY-ENFORCED, not RLS-enforced (AGENT_RULES section 3):
 * `profiles_select_org` is `TO public` with `organization_id = get_user_org_id()`, and permissive
 * policies combine with OR, so every authenticated user can read every profile in their
 * organization. The only thing keeping a Team Profile honest is the query, which is why these
 * cases exist and why every one of them must FAIL CLOSED.
 *
 * TS/SQL PARITY: the hand-written fixture below mirrors the fixture map at the top of
 * supabase/tests/profile_book_stats_rpc.sql (T8, `private.resolve_downline_ids`). The "shared
 * hierarchy shapes" cases load supabase/tests/fixtures/hierarchy_shapes.json — the same file
 * scripts/hierarchy_fixture.py seeds into the hierarchy stabilization SQL suites — through
 * src/lib/__tests__/hierarchyFixture.ts, and run the REAL `getAgentScopeIds` walk and
 * `fetchTeamRoster` against an in-memory `profiles` table. Two implementations exist because the
 * business aggregate cannot be trusted client-side — `clients` RLS reaches a downline only through
 * a Team Leader's role and the path-based `is_ancestor_of` — and the shared shapes are what stop
 * them drifting.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildOrgTreeView, displayNameFor, initialsFor } from "@/lib/profile/profile-org-view";
import type { DownlineProfile } from "@/lib/profile/profile-queries";
import {
  PRODUCTION_EXPECTED,
  hierarchyShape,
  shapeDownlineKeys,
  type HierarchyProfileRow,
  type HierarchyShapeName,
} from "./hierarchyFixture";

/**
 * THE SHARED HIERARCHY FIXTURE. Mirrors the fixture map at the top of
 * supabase/tests/profile_book_stats_rpc.sql, so a change to one is visible against the other.
 */
const ROOT = "root";
const CHILD = "child";
const GRAND = "grand";
const DELETED_MID = "deleted-mid";
const BELOW_DELETED = "below-deleted";
const PEER = "peer";
const OTHER_MANAGER = "other-manager";

const profile = (
  id: string,
  upline: string | null,
  overrides: Partial<DownlineProfile> = {},
): DownlineProfile => ({
  id,
  first_name: id,
  last_name: "Agent",
  role: "Agent",
  status: "Active",
  upline_id: upline,
  ...overrides,
});

describe("buildOrgTreeView — the shape the preview and the dialog render", () => {
  it("counts descendants at every level and excludes the root from the downline total", () => {
    const view = buildOrgTreeView(
      [profile(ROOT, null), profile(CHILD, ROOT), profile(GRAND, CHILD)],
      ROOT,
    );

    expect(view.root!.id).toBe(ROOT);
    expect(view.directReports.map((n) => n.id)).toEqual([CHILD]);
    // "Total Downline" EXCLUDES self — a brief requirement, and the reason this is not just a
    // roster length.
    expect(view.totalDownline).toBe(2);
    expect(view.directReports[0].descendantCount).toBe(1);
    expect(view.maxDepth).toBe(3);
  });

  it("does NOT sever a branch beneath a deleted intermediate manager", () => {
    // getAgentScopeIds walks THROUGH a status='Deleted' profile while excluding it from the
    // returned scope, so the roster contains BELOW_DELETED but not DELETED_MID. The tree must
    // still surface the orphan rather than losing an authorized agent.
    const view = buildOrgTreeView(
      [profile(ROOT, null), profile(BELOW_DELETED, DELETED_MID)],
      ROOT,
    );

    const allIds = [
      ...view.directReports.map((n) => n.id),
      ...view.unattached.map((n) => n.id),
    ];
    expect(allIds).toContain(BELOW_DELETED);
    expect(view.unattached.map((n) => n.id)).toEqual([BELOW_DELETED]);
  });

  it("never renders a peer as part of the viewer's organization", () => {
    const view = buildOrgTreeView(
      [profile(ROOT, null), profile(CHILD, ROOT), profile(PEER, OTHER_MANAGER)],
      ROOT,
    );
    expect(view.directReports.map((n) => n.id)).toEqual([CHILD]);
    expect(view.totalDownline).toBe(1);
    // The peer is not silently swallowed either — it is surfaced as unattached.
    expect(view.unattached.map((n) => n.id)).toEqual([PEER]);
  });

  it("terminates on a self-edge, and surfaces the affected branch rather than losing it", () => {
    // `buildProfileOrgForest` treats "the upline chain revisits a node I have already seen" as a
    // cycle and promotes the node to a root. A self-edge on the ROOT therefore detaches its
    // children too — which is conservative, not wrong, and the property that matters is that the
    // build TERMINATES and no authorized agent disappears. `unattached` is what makes that visible,
    // and TeamDownlinePreview renders a warning line for exactly this case.
    const view = buildOrgTreeView([profile(ROOT, ROOT), profile(CHILD, ROOT)], ROOT);
    expect(view.root!.id).toBe(ROOT);
    const placed = [view.root!.id, ...view.directReports.map((n) => n.id), ...view.unattached.map((n) => n.id)];
    expect(placed).toContain(CHILD);
    expect(view.unattached.map((n) => n.id)).toEqual([CHILD]);
  });

  it("terminates on a two-node cycle instead of recursing forever", () => {
    const a = profile("a", "b");
    const b = profile("b", "a");
    const view = buildOrgTreeView([profile(ROOT, null), a, b], ROOT);
    // The cycle members cannot attach to the root, so they surface as unattached — but the build
    // completes, which is the property under test.
    expect(view.root!.id).toBe(ROOT);
    expect(view.unattached.length).toBeGreaterThan(0);
  });

  it("returns a null root when the viewer is absent from the roster", () => {
    // Fails closed: the preview renders an explanation, never an empty organization presented as
    // fact.
    const view = buildOrgTreeView([profile(CHILD, ROOT)], ROOT);
    expect(view.root).toBeNull();
    expect(view.totalDownline).toBe(0);
  });

  it("deduplicates repeated ids", () => {
    const view = buildOrgTreeView(
      [profile(ROOT, null), profile(CHILD, ROOT), profile(CHILD, ROOT)],
      ROOT,
    );
    expect(view.totalDownline).toBe(1);
  });

  it("handles a deep chain without blowing up the descendant counts", () => {
    const rows = [profile(ROOT, null)];
    for (let i = 0; i < 50; i += 1) {
      rows.push(profile(`n${i}`, i === 0 ? ROOT : `n${i - 1}`));
    }
    const view = buildOrgTreeView(rows, ROOT);
    expect(view.totalDownline).toBe(50);
    expect(view.maxDepth).toBe(51);
  });
});

describe("roster display helpers", () => {
  it("derives initials, which is what the roster renders instead of avatars", () => {
    // avatar_url holds a base64 data URL (ProfileAvatarUploader.tsx:48), so a roster that loaded
    // avatars would pull megabytes to draw small circles.
    expect(initialsFor({ firstName: "Amanda", lastName: "Lewis" })).toBe("AL");
    expect(initialsFor({ firstName: "", lastName: "" })).toBe("?");
  });

  it("falls back to a neutral placeholder rather than rendering an empty name", () => {
    expect(displayNameFor({ firstName: "Jason", lastName: "Keller" })).toBe("Jason Keller");
    expect(displayNameFor({ firstName: "", lastName: "" })).toBe("Unnamed agent");
  });
});

describe("fetchTeamRoster — fails closed", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("throws rather than returning an empty roster when scope resolution yields nothing", async () => {
    // getAgentScopeIds seeds its set with the viewer, so an empty array can only mean a missing
    // viewerId/organizationId. Rendering that as "you have no team" would be a lie.
    vi.doMock("@/lib/supabase-users", () => ({
      usersSupabaseApi: { getAgentScopeIds: vi.fn().mockResolvedValue([]) },
    }));
    vi.doMock("@/integrations/supabase/client", () => ({ supabase: {} }));

    const { fetchTeamRoster } = await import("@/lib/profile/profile-queries");
    await expect(fetchTeamRoster("viewer", "org")).rejects.toThrow();
  });

  it("propagates a scope-traversal failure instead of widening to the organization", async () => {
    const boom = new Error("Agent scope traversal exceeded its maximum depth.");
    vi.doMock("@/lib/supabase-users", () => ({
      usersSupabaseApi: { getAgentScopeIds: vi.fn().mockRejectedValue(boom) },
    }));
    vi.doMock("@/integrations/supabase/client", () => ({ supabase: {} }));

    const { fetchTeamRoster } = await import("@/lib/profile/profile-queries");
    await expect(fetchTeamRoster("viewer", "org")).rejects.toThrow(boom);
  });

  it("constrains the profiles read to the resolved id set AND the organization", async () => {
    const eq = vi.fn().mockReturnThis();
    const inFn = vi.fn().mockReturnThis();
    const order = vi.fn().mockResolvedValue({ data: [], error: null });
    const select = vi.fn(() => ({ eq, in: inFn, order }));
    // Chainable builder: every call returns the same object so the chain can be inspected.
    const builder: Record<string, unknown> = { select, eq, in: inFn, order };
    eq.mockReturnValue(builder);
    inFn.mockReturnValue(builder);

    vi.doMock("@/lib/supabase-users", () => ({
      usersSupabaseApi: { getAgentScopeIds: vi.fn().mockResolvedValue(["viewer", "child"]) },
    }));
    vi.doMock("@/integrations/supabase/client", () => ({
      supabase: { from: vi.fn(() => builder) },
    }));

    const { fetchTeamRoster } = await import("@/lib/profile/profile-queries");
    await fetchTeamRoster("viewer", "org-a");

    expect(eq).toHaveBeenCalledWith("organization_id", "org-a");
    expect(inFn).toHaveBeenCalledWith("id", ["viewer", "child"]);
    // avatar_url must NOT be selected across a roster.
    const columns = String(select.mock.calls[0][0]);
    expect(columns).not.toContain("avatar_url");
  });
});

// ---------------------------------------------------------------------------------------------
// Shared hierarchy shapes (hierarchy_shapes.json) through the REAL resolver and roster query
// ---------------------------------------------------------------------------------------------

const ALL_SHAPES: HierarchyShapeName[] = [
  "production", "two_cycle", "self_loop", "cross_org_edge", "deep_chain", "deleted_intermediate",
];

/** Every shape in one table, as one database holds them. */
const SHAPE_TABLE: HierarchyProfileRow[] = ALL_SHAPES.flatMap((name) => hierarchyShape(name).rows());

/**
 * A `profiles` table emulator for exactly the filters the scope walk and the roster query emit
 * (`eq`, `in`, `order`, `range`). Anything else throws, so a query that starts emitting an
 * unsupported filter fails loudly instead of being silently ignored.
 */
function profilesEmulator(rows: HierarchyProfileRow[]) {
  return {
    from(table: string) {
      if (table !== "profiles") throw new Error(`unexpected table ${table}`);
      const eq: Record<string, unknown> = {};
      let inFilter: { col: string; vals: unknown[] } | null = null;
      let orderCol: string | null = null;
      let range: [number, number] | null = null;
      let columns = "*";
      const b: Record<string, unknown> = {
        select(cols: string) { columns = cols; return b; },
        eq(col: string, v: unknown) { eq[col] = v; return b; },
        in(col: string, vals: unknown[]) { inFilter = { col, vals: [...vals] }; return b; },
        order(col: string) { orderCol = col; return b; },
        range(from: number, to: number) { range = [from, to]; return b; },
        then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
          let out = rows.filter((r) =>
            Object.entries(eq).every(([c, v]) => (r as unknown as Record<string, unknown>)[c] === v) &&
            (!inFilter || inFilter.vals.includes((r as unknown as Record<string, unknown>)[inFilter.col])));
          if (orderCol) {
            const col = orderCol;
            out = [...out].sort((x, y) =>
              String((x as unknown as Record<string, unknown>)[col]).localeCompare(String((y as unknown as Record<string, unknown>)[col])));
          }
          if (range) out = out.slice(range[0], range[1] + 1);
          const cols = columns.split(",").map((c) => c.trim());
          const data = out.map((r) => Object.fromEntries(cols.map((c) => [c, (r as unknown as Record<string, unknown>)[c]])));
          return Promise.resolve({ data, error: null }).then(onF, onR);
        },
      };
      return b;
    },
  };
}

describe("shared hierarchy shapes — getAgentScopeIds + fetchTeamRoster + the org tree", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // The fail-closed cases above register a fake resolver; these cases need the real one.
    vi.doUnmock("@/lib/supabase-users");
    vi.doMock("@/integrations/supabase/client", () => ({ supabase: profilesEmulator(SHAPE_TABLE) }));
  });

  async function modules() {
    const [{ usersSupabaseApi }, { fetchTeamRoster }] = await Promise.all([
      import("@/lib/supabase-users"),
      import("@/lib/profile/profile-queries"),
    ]);
    return { usersSupabaseApi, fetchTeamRoster };
  }

  const prod = hierarchyShape("production");
  const keys = (shape: { keyOf(id: string): string }, ids: string[]) => ids.map((id) => shape.keyOf(id)).sort();

  it("the Team Leader's Team Profile is the live team beneath them, a Deleted report excluded", async () => {
    const { fetchTeamRoster } = await modules();
    const roster = await fetchTeamRoster(prod.id("T"), prod.orgOf("T"));
    expect(keys(prod, roster.profiles.map((p) => p.id))).toEqual(["A1", "A2", "T"]);

    const view = buildOrgTreeView(roster.profiles, prod.id("T"));
    expect(keys(prod, view.directReports.map((n) => n.id))).toEqual(["A1", "A2"]);
    expect(view.totalDownline).toBe(2);
    expect(view.unattached).toEqual([]);
  });

  it("the Admin root's Team Profile covers the whole live organization, Deleted branches dropped", async () => {
    const { fetchTeamRoster } = await modules();
    const roster = await fetchTeamRoster(prod.id("R"), prod.orgOf("R"));
    expect(keys(prod, roster.profiles.map((p) => p.id))).toEqual(["A1", "A2", "K1", "K2", "K3", "K4", "K5", "R", "T"]);

    const view = buildOrgTreeView(roster.profiles, prod.id("R"));
    expect(keys(prod, view.directReports.map((n) => n.id))).toEqual(["K1", "K2", "K3", "K4", "K5", "T"]);
    expect(view.totalDownline).toBe(8);
    expect(view.maxDepth).toBe(PRODUCTION_EXPECTED.longest_chain);
    expect(view.unattached).toEqual([]);
  });

  it("matches the repaired canonical paths for both Team Leaders (the Deleted difference documented)", async () => {
    // team_leader_descendants_after_repair is what is_ancestor_of recognises once M3 has made every
    // stored path canonical. The upline_id walk TRAVERSES exactly that set; its SCOPE drops the
    // Deleted members (as private.resolve_downline_ids does).
    const { usersSupabaseApi } = await modules();
    for (const [tl, expected] of Object.entries(PRODUCTION_EXPECTED.team_leader_descendants_after_repair)) {
      const t = await usersSupabaseApi.getAgentScopeTraversal({ viewerId: prod.id(tl), organizationId: prod.orgOf(tl) });
      expect(keys(prod, t.traversedIds.slice(1))).toEqual([...expected].sort());
      const live = expected.filter((k) => prod.profiles.find((p) => p.key === k)?.status !== "Deleted");
      expect(keys(prod, t.scopedIds.slice(1))).toEqual([...live].sort());
    }
  });

  it("every production-shape profile resolves exactly the reference upline walk", async () => {
    const { usersSupabaseApi } = await modules();
    for (const p of prod.profiles) {
      const t = await usersSupabaseApi.getAgentScopeTraversal({ viewerId: p.id, organizationId: prod.orgOf(p.key) });
      expect(t.scopedIds[0]).toBe(p.id);
      expect(keys(prod, t.scopedIds.slice(1))).toEqual(shapeDownlineKeys(prod, p.key, { includeDeleted: false }).sort());
      expect(keys(prod, t.traversedIds.slice(1))).toEqual(shapeDownlineKeys(prod, p.key, { includeDeleted: true }).sort());
    }
  });

  it("an Active member beneath a Deleted Team Leader stays in scope and surfaces as unattached", async () => {
    const shape = hierarchyShape("deleted_intermediate");
    const { fetchTeamRoster } = await modules();
    const roster = await fetchTeamRoster(shape.id("M"), shape.orgOf("M"));
    expect(keys(shape, roster.profiles.map((p) => p.id))).toEqual(["M", "MG"]);
    const view = buildOrgTreeView(roster.profiles, shape.id("M"));
    expect(view.unattached.map((n) => n.id)).toEqual([shape.id("MG")]);
  });

  it("walks a 25-level chain completely (the preimage SQL path builder stopped at 20)", async () => {
    const shape = hierarchyShape("deep_chain");
    const { fetchTeamRoster } = await modules();
    const roster = await fetchTeamRoster(shape.id("L01"), shape.orgOf("L01"));
    expect(roster.profiles).toHaveLength(25);
    const view = buildOrgTreeView(roster.profiles, shape.id("L01"));
    expect(view.totalDownline).toBe(24);
    expect(view.maxDepth).toBe(25);
  });

  it("terminates on a 2-cycle and a self-loop with exactly the SQL T8 membership", async () => {
    const { usersSupabaseApi } = await modules();
    const cycle = hierarchyShape("two_cycle");
    const cycleIds = await usersSupabaseApi.getAgentScopeIds({ viewerId: cycle.id("X"), organizationId: cycle.orgOf("X") });
    expect(keys(cycle, cycleIds)).toEqual(["X", "Y"]);

    const loop = hierarchyShape("self_loop");
    expect(await usersSupabaseApi.getAgentScopeIds({ viewerId: loop.id("S"), organizationId: loop.orgOf("S") })).toEqual([
      loop.id("S"),
    ]);
  });

  it("a cross-organization upline edge never pulls a foreign profile into scope", async () => {
    const shape = hierarchyShape("cross_org_edge");
    const { usersSupabaseApi } = await modules();
    expect(await usersSupabaseApi.getAgentScopeIds({ viewerId: shape.id("P"), organizationId: shape.orgOf("P") })).toEqual([
      shape.id("P"),
    ]);
  });

  it("the right viewer in the WRONG organization resolves no roster — fails closed", async () => {
    const { fetchTeamRoster } = await modules();
    const roster = await fetchTeamRoster(prod.id("T"), hierarchyShape("cross_org_edge").orgOf("Q"));
    expect(roster.profiles).toEqual([]);
    expect(buildOrgTreeView(roster.profiles, prod.id("T")).root).toBeNull();
  });
});
