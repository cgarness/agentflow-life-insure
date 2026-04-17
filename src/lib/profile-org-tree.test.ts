import { describe, expect, it } from "vitest";
import { buildProfileOrgForest, countForestNodes, uplineChainReachesId } from "./profile-org-tree";

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
