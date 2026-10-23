import { describe, expect, it } from "vitest";
import {
  buildProfileOrgForest,
  countForestNodes,
  filterReportingLineHierarchy,
  isDeletedProfile,
  isLiveProfileNode,
  pruneDeletedLeaves,
  uplineChainReachesId,
  type ProfileOrgNode,
} from "./profile-org-tree";
import { buildOrgTreeView, type OrgTreeNode } from "@/lib/profile/profile-org-view";
import type { DownlineProfile } from "@/lib/profile/profile-queries";

describe("uplineChainReachesId", () => {
  it("detects self as parent", () => {
    const m = new Map<string, string | null>([["a", "a"]]);
    expect(uplineChainReachesId("a", "a", m)).toBe(true);
  });

  it("detects cycle A -> B -> A", () => {
    const m = new Map<string, string | null>([
      ["a", "b"],
      ["b", "a"],
    ]);
    expect(uplineChainReachesId("a", "b", m)).toBe(true);
    expect(uplineChainReachesId("b", "a", m)).toBe(true);
  });

  it("returns false for clean chain", () => {
    const m = new Map<string, string | null>([
      ["c", "b"],
      ["b", "a"],
      ["a", null],
    ]);
    expect(uplineChainReachesId("c", "b", m)).toBe(false);
  });
});

describe("filterReportingLineHierarchy", () => {
  const rows = [
    { id: "chris", upline_id: null },
    { id: "nick", upline_id: "chris" },
    { id: "justin", upline_id: "chris" },
    { id: "sub", upline_id: "nick" },
  ];

  it("agent sees full upline chain and self, not peer under same manager", () => {
    const slice = filterReportingLineHierarchy(rows, "nick");
    expect(slice.map((r) => r.id).sort()).toEqual(["chris", "nick", "sub"]);
  });

  it("upline sees all downline branches, not unrelated peers above", () => {
    const chrisSlice = filterReportingLineHierarchy(rows, "chris");
    expect(chrisSlice.map((r) => r.id).sort()).toEqual(["chris", "justin", "nick", "sub"]);
  });

  it("deep downline sees entire upline chain", () => {
    const subSlice = filterReportingLineHierarchy(rows, "sub");
    expect(subSlice.map((r) => r.id).sort()).toEqual(["chris", "nick", "sub"]);
  });

  it("peer under same manager is hidden from agent view", () => {
    const justinSlice = filterReportingLineHierarchy(rows, "justin");
    expect(justinSlice.map((r) => r.id).sort()).toEqual(["chris", "justin"]);
    const nickSlice = filterReportingLineHierarchy(rows, "nick");
    expect(nickSlice.some((r) => r.id === "justin")).toBe(false);
  });

  it("returns empty when viewer id missing", () => {
    expect(filterReportingLineHierarchy(rows, null)).toEqual([]);
    expect(filterReportingLineHierarchy(rows, undefined)).toEqual([]);
  });
});

describe("buildProfileOrgForest", () => {
  it("places child under parent", () => {
    const rows = [
      { id: "1", upline_id: null, name: "Admin" },
      { id: "2", upline_id: "1", name: "Agent" },
    ];
    const roots = buildProfileOrgForest(rows);
    expect(roots).toHaveLength(1);
    expect(roots[0].id).toBe("1");
    expect(roots[0].children).toHaveLength(1);
    expect(roots[0].children[0].id).toBe("2");
    expect(countForestNodes(roots)).toBe(2);
  });

  it("dedupes duplicate ids", () => {
    const rows = [
      { id: "1", upline_id: null },
      { id: "1", upline_id: null },
    ];
    expect(countForestNodes(buildProfileOrgForest(rows))).toBe(1);
  });

  it("breaks cycle so both nodes remain as roots", () => {
    const rows = [
      { id: "a", upline_id: "b" },
      { id: "b", upline_id: "a" },
    ];
    const roots = buildProfileOrgForest(rows);
    expect(roots).toHaveLength(2);
    expect(countForestNodes(roots)).toBe(2);
    expect(roots.every((r) => r.children.length === 0)).toBe(true);
  });

  it("treats self-upline as root", () => {
    const rows = [{ id: "x", upline_id: "x" }];
    const roots = buildProfileOrgForest(rows);
    expect(roots).toHaveLength(1);
    expect(roots[0].children.length).toBe(0);
  });

  it("orphans missing upline as root", () => {
    const rows = [{ id: "c", upline_id: "missing" }];
    const roots = buildProfileOrgForest(rows);
    expect(roots).toHaveLength(1);
    expect(roots[0].id).toBe("c");
  });
});

/**
 * The Deleted-intermediate rule — ONE rule for both org charts (Settings → Hierarchy draws
 * `pruneDeletedLeaves(buildProfileOrgForest(rows))`; the Team Profile tree goes through
 * `buildOrgTreeView`). A soft delete keeps `upline_id`, so a Deleted manager stays in the chart
 * as a muted connector while someone live reports beneath it; otherwise it is dropped, and it is
 * never counted as a member. All ids are synthetic.
 */
describe("Deleted-intermediate rule", () => {
  type Row = { id: string; upline_id: string | null; status: string; role: string };
  const row = (id: string, upline: string | null, status = "Active", role = "Agent"): Row => ({ id, upline_id: upline, status, role });
  const shape = (roots: ProfileOrgNode<Row>[]): unknown =>
    roots.map((n) => ({ id: n.id, children: shape(n.children) }));
  const find = (roots: ProfileOrgNode<Row>[], id: string): ProfileOrgNode<Row> | undefined => {
    for (const r of roots) {
      if (r.id === id) return r;
      const hit = find(r.children, id);
      if (hit) return hit;
    }
    return undefined;
  };
  const chart = (rows: Row[], keep?: string[]) => pruneDeletedLeaves(buildProfileOrgForest(rows), keep ? new Set(keep) : undefined);

  // Admin → Team Leader → {live agent, Deleted leaf, Deleted manager → live grandchild};
  // Admin → Deleted Team Leader → Deleted agent (an all-Deleted branch).
  const ROWS: Row[] = [
    row("admin", null, "Active", "Admin"),
    row("tl", "admin", "Active", "Team Leader"),
    row("agent", "tl"),
    row("deleted-leaf", "tl", "Deleted"),
    row("deleted-mid", "tl", "Deleted", "Team Leader"),
    row("grandchild", "deleted-mid"),
    row("deleted-tl", "admin", "Deleted", "Team Leader"),
    row("deleted-under-deleted", "deleted-tl", "Deleted"),
  ];

  it("only status 'Deleted' is Deleted — Inactive members stay ordinary nodes", () => {
    expect(isDeletedProfile({ status: "Deleted" })).toBe(true);
    for (const status of ["Active", "Inactive", "deleted", null, undefined]) expect(isDeletedProfile({ status })).toBe(false);
    expect(isDeletedProfile(null)).toBe(false);
    expect(chart([row("a", null), row("b", "a", "Inactive")])[0].children.map((c) => c.id)).toEqual(["b"]);
  });

  it("keeps a Deleted manager as a connector with its live report attached beneath it", () => {
    const roots = chart(ROWS);
    expect(roots.map((r) => r.id)).toEqual(["admin"]);
    expect(find(roots, "tl")!.children.map((c) => c.id)).toEqual(["agent", "deleted-mid"]);
    expect(find(roots, "deleted-mid")!.children.map((c) => c.id)).toEqual(["grandchild"]);
  });

  it("drops Deleted leaves and all-Deleted branches", () => {
    const roots = chart(ROWS);
    for (const id of ["deleted-leaf", "deleted-tl", "deleted-under-deleted"]) expect(find(roots, id)).toBeUndefined();
    expect(countForestNodes(roots)).toBe(5);
  });

  it("keeps a chain of Deleted connectors above one live report, and drops it when nobody live is left", () => {
    const deep = [row("root", null), row("d1", "root", "Deleted"), row("d2", "d1", "Deleted"), row("live", "d2")];
    expect(shape(chart(deep))).toEqual([{ id: "root", children: [{ id: "d1", children: [{ id: "d2", children: [{ id: "live", children: [] }] }] }] }]);
    expect(shape(chart(deep.map((r) => (r.id === "live" ? { ...r, status: "Deleted" } : r))))).toEqual([{ id: "root", children: [] }]);
  });

  it("keeps a Deleted root only while someone live reports beneath it", () => {
    expect(chart([row("d", null, "Deleted"), row("live", "d")]).map((r) => r.id)).toEqual(["d"]);
    expect(chart([row("d", null, "Deleted")])).toEqual([]);
  });

  it("keepIds keeps a childless Deleted node (the viewer's own)", () => {
    expect(chart([row("me", null, "Deleted")], ["me"]).map((r) => r.id)).toEqual(["me"]);
  });

  it("does not mutate the forest it is given", () => {
    const forest = buildProfileOrgForest(ROWS);
    const before = JSON.stringify(forest);
    pruneDeletedLeaves(forest);
    expect(JSON.stringify(forest)).toBe(before);
  });

  it("never counts a Deleted connector as a member", () => {
    const roots = chart(ROWS);
    expect(countForestNodes(roots, isLiveProfileNode)).toBe(4);
    expect(countForestNodes(roots)).toBe(5);
  });

  describe("the Team Profile tree applies the same rule", () => {
    const roster = (rows: Row[]): DownlineProfile[] =>
      rows.map((r) => ({ id: r.id, first_name: r.id, last_name: "Synthetic", role: r.role, status: r.status, upline_id: r.upline_id }));
    const ids = (nodes: OrgTreeNode[]): unknown => nodes.map((n) => ({ id: n.id, children: ids(n.children) }));
    const viewRows = ROWS.filter((r) => r.id !== "admin").map((r) => (r.id === "tl" ? { ...r, upline_id: null } : r));

    it("attaches the live report under its Deleted manager, flags the manager, and does not count it", () => {
      const view = buildOrgTreeView(roster(viewRows), "tl");
      expect(view.unattached).toEqual([]);
      expect(ids(view.directReports)).toEqual([
        { id: "agent", children: [] },
        { id: "deleted-mid", children: [{ id: "grandchild", children: [] }] },
      ]);
      const mid = view.directReports.find((n) => n.id === "deleted-mid")!;
      expect(mid.isDeleted).toBe(true);
      expect(mid.descendantCount).toBe(1);
      expect(view.directReports.find((n) => n.id === "agent")!.isDeleted).toBe(false);
      // agent + grandchild; the Deleted connector and the Deleted leaf are not downline.
      expect(view.totalDownline).toBe(2);
      expect(view.maxDepth).toBe(3);
    });

    it("draws the same live members, attached the same way, as the Settings chart", () => {
      const settings = chart(viewRows, ["tl"]);
      const team = buildOrgTreeView(roster(viewRows), "tl");
      expect(ids(team.root ? [team.root] : [])).toEqual(shape(settings));
      expect(team.totalDownline + 1).toBe(countForestNodes(settings, isLiveProfileNode));
    });

    it("without the Deleted manager in the roster the report is still surfaced as unattached, never lost", () => {
      const view = buildOrgTreeView(roster(viewRows.filter((r) => r.id !== "deleted-mid")), "tl");
      expect(view.unattached.map((n) => n.id)).toEqual(["grandchild"]);
      expect(view.totalDownline).toBe(1);
    });
  });
});
