/**
 * Scope resolution and org-tree shaping — the security-sensitive half of the Team Profile.
 *
 * Downline scoping in AgentFlow is QUERY-ENFORCED, not RLS-enforced (AGENT_RULES section 3):
 * `profiles_select_org` is `TO public` with `organization_id = get_user_org_id()`, and permissive
 * policies combine with OR, so every authenticated user can read every profile in their
 * organization. The only thing keeping a Team Profile honest is the query, which is why these
 * cases exist and why every one of them must FAIL CLOSED.
 *
 * TS/SQL PARITY: the same hierarchy shapes are asserted against the SQL resolver in
 * supabase/tests/profile_book_stats_rpc.sql (T8). The two implementations exist because the
 * business aggregate cannot run client-side at all — `clients` RLS returns nothing for a Team
 * Leader's downline — and this shared fixture table is what stops them drifting.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildOrgTreeView, displayNameFor, initialsFor } from "@/lib/profile/profile-org-view";
import type { DownlineProfile } from "@/lib/profile/profile-queries";

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
