/**
 * F2 / F5 — upline and invite-manager candidates, and the Manager-column name lookup.
 *
 * Query scoping, not authorization (`profiles_select_org` permits same-org reads). These
 * tests lock that the pickers ask only for Active Admins / Team Leaders of the explicit
 * organization, independent of any table filter; that the member and everyone beneath them
 * (through a Deleted intermediate too) are never offered; that a scope failure rejects
 * instead of offering an unfiltered list; and that a current upline outside the offered set
 * is still reported.
 *
 * The real `usersSupabaseApi` traversal runs against an in-memory `profiles` table.
 * All ids are synthetic. No production identifier appears in this file.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Profile = {
  id: string;
  first_name: string;
  last_name: string;
  role: string;
  status: string;
  organization_id: string;
  upline_id: string | null;
};

type Recorded = {
  table: string;
  select?: string;
  eq: Record<string, unknown>;
  neq: Record<string, unknown>;
  inCol?: string;
  inVals?: unknown[];
  or?: string;
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
    const project = (r: Profile) =>
      cols[0] === "*" ? { ...r } : Object.fromEntries(cols.map((c) => [c, (r as Record<string, unknown>)[c]]));
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
      or(e: string) { q.or = e; return b; },
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

import {
  loadInviteManagerCandidates,
  loadUplineCandidates,
  managerNamesById,
  UPLINE_CANDIDATE_ROLES,
} from "@/lib/hierarchy/uplineCandidates";

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";

const ADMIN = uid(1);
const TARGET_TL = uid(2);
const DELETED_MID = uid(3);
const GRANDCHILD_TL = uid(4);
const DIRECT_TL_CHILD = uid(5);
const OTHER_TL = uid(6);
const INACTIVE_TL = uid(7);
const AGENT = uid(8);
const FOREIGN_ADMIN = uid(9);
const DELETED_ADMIN = uid(10);

const p = (
  id: string,
  first: string,
  role: string,
  upline: string | null,
  status = "Active",
  org = ORG,
): Profile => ({ id, first_name: first, last_name: "Test", role, status, organization_id: org, upline_id: upline });

const SHAPE: Profile[] = [
  p(ADMIN, "Ada", "Admin", null),
  p(TARGET_TL, "Tess", "Team Leader", ADMIN),
  p(DELETED_MID, "Dee", "Team Leader", TARGET_TL, "Deleted"),
  p(GRANDCHILD_TL, "Gus", "Team Leader", DELETED_MID),
  p(DIRECT_TL_CHILD, "Cal", "Team Leader", TARGET_TL),
  p(OTHER_TL, "Ola", "Team Leader", ADMIN),
  p(INACTIVE_TL, "Ivy", "Team Leader", ADMIN, "Inactive"),
  p(AGENT, "Abe", "Agent", OTHER_TL),
  p(FOREIGN_ADMIN, "Fay", "Admin", null, "Active", OTHER_ORG),
  p(DELETED_ADMIN, "Del", "Admin", null, "Deleted"),
];

const candidateQueries = () => recorded.filter((q) => q.inCol === "role");

beforeEach(() => {
  recorded.length = 0;
  state.rows = SHAPE;
  state.failWhen = null;
});

describe("loadUplineCandidates — who may be offered", () => {
  it("offers only Active Admins / Team Leaders of the organization, minus the member and their subtree", async () => {
    const { candidates, currentOutsideSet } = await loadUplineCandidates({
      targetId: TARGET_TL,
      organizationId: ORG,
      currentUplineId: ADMIN,
    });
    expect(candidates.map((c) => c.id)).toEqual([ADMIN, OTHER_TL]);
    expect(currentOutsideSet).toBeNull();
  });

  it("never offers a descendant reached through a Deleted intermediate (no cycle can be picked)", async () => {
    const { candidates } = await loadUplineCandidates({ targetId: TARGET_TL, organizationId: ORG });
    const ids = candidates.map((c) => c.id);
    expect(ids).not.toContain(GRANDCHILD_TL);
    expect(ids).not.toContain(DIRECT_TL_CHILD);
    expect(ids).not.toContain(TARGET_TL);
  });

  it("issues an org-, status- and role-constrained candidate query with display columns only", async () => {
    await loadUplineCandidates({ targetId: TARGET_TL, organizationId: ORG });
    const [q] = candidateQueries();
    expect(q.table).toBe("profiles");
    expect(q.eq).toEqual({ organization_id: ORG, status: "Active" });
    expect(q.inVals).toEqual([...UPLINE_CANDIDATE_ROLES]);
    expect(q.select).toBe("id, first_name, last_name, role, status");
    expect(q.select).not.toContain("hierarchy_path");
    expect(q.or).toBeUndefined();
    expect(q.order).toEqual([{ col: "first_name", ascending: true }]);
  });

  it("is independent of the table's search / role / status filters (it takes none)", async () => {
    // A leaf Agent: every Active Admin / Team Leader of the org, first-name order.
    const { candidates } = await loadUplineCandidates({ targetId: AGENT, organizationId: ORG });
    expect(candidates.map((c) => c.id)).toEqual([ADMIN, DIRECT_TL_CHILD, GRANDCHILD_TL, OTHER_TL, TARGET_TL]);
    for (const q of recorded) {
      expect(q.or).toBeUndefined();
      expect(q.eq.role).toBeUndefined();
    }
  });

  it("walks the member's subtree org-scoped, through Deleted rows", async () => {
    await loadUplineCandidates({ targetId: TARGET_TL, organizationId: ORG });
    const walk = recorded.filter((q) => q.inCol === "upline_id");
    expect(walk.length).toBeGreaterThan(1);
    for (const q of walk) {
      expect(q.eq.organization_id).toBe(ORG);
      expect(q.eq.status).toBeUndefined();
    }
    expect(walk.some((q) => (q.inVals ?? []).includes(DELETED_MID))).toBe(true);
  });

  it("never offers another organization's Admin", async () => {
    const { candidates } = await loadUplineCandidates({ targetId: AGENT, organizationId: ORG });
    expect(candidates.map((c) => c.id)).not.toContain(FOREIGN_ADMIN);
    expect(candidates.map((c) => c.id)).not.toContain(DELETED_ADMIN);
    expect(candidates.map((c) => c.id)).not.toContain(INACTIVE_TL);
  });
});

describe("loadUplineCandidates — fail closed", () => {
  it("rejects when the subtree walk fails — never an unfiltered list", async () => {
    state.failWhen = (q) => q.inCol === "upline_id";
    await expect(loadUplineCandidates({ targetId: TARGET_TL, organizationId: ORG })).rejects.toBeTruthy();
  });

  it("rejects when the candidate query fails", async () => {
    state.failWhen = (q) => q.inCol === "role";
    await expect(loadUplineCandidates({ targetId: TARGET_TL, organizationId: ORG })).rejects.toBeTruthy();
  });

  it("issues no query without an organization or a member", async () => {
    expect(await loadUplineCandidates({ targetId: TARGET_TL, organizationId: null })).toEqual({
      candidates: [],
      currentOutsideSet: null,
    });
    expect(await loadUplineCandidates({ targetId: "", organizationId: ORG })).toEqual({
      candidates: [],
      currentOutsideSet: null,
    });
    expect(recorded).toHaveLength(0);
  });
});

describe("loadUplineCandidates — a current upline outside the offered set", () => {
  it("reports an Inactive current upline with its name, for a disabled \"current\" option", async () => {
    const { candidates, currentOutsideSet } = await loadUplineCandidates({
      targetId: AGENT,
      organizationId: ORG,
      currentUplineId: INACTIVE_TL,
    });
    expect(candidates.map((c) => c.id)).not.toContain(INACTIVE_TL);
    expect(currentOutsideSet).toEqual({ id: INACTIVE_TL, firstName: "Ivy", lastName: "Test", role: "Team Leader", status: "Inactive" });
    const lookup = recorded.find((q) => q.single);
    expect(lookup?.eq).toEqual({ organization_id: ORG, id: INACTIVE_TL });
  });

  it("reports an Agent current upline (no longer a valid choice)", async () => {
    const { currentOutsideSet } = await loadUplineCandidates({ targetId: ADMIN, organizationId: ORG, currentUplineId: AGENT });
    expect(currentOutsideSet?.id).toBe(AGENT);
    expect(currentOutsideSet?.role).toBe("Agent");
  });

  it("reports an unreadable / foreign current upline by id only", async () => {
    const { currentOutsideSet } = await loadUplineCandidates({
      targetId: AGENT,
      organizationId: ORG,
      currentUplineId: FOREIGN_ADMIN,
    });
    expect(currentOutsideSet).toEqual({ id: FOREIGN_ADMIN, firstName: "", lastName: "", role: null, status: null });
  });

  it("does no lookup when the current upline is offered, or there is none", async () => {
    for (const currentUplineId of [OTHER_TL, null, "_none", undefined]) {
      recorded.length = 0;
      const { currentOutsideSet } = await loadUplineCandidates({ targetId: AGENT, organizationId: ORG, currentUplineId });
      expect(currentOutsideSet).toBeNull();
      expect(recorded.some((q) => q.single)).toBe(false);
    }
  });

  it("rejects when the current-upline lookup fails", async () => {
    state.failWhen = (q) => q.single === true;
    await expect(
      loadUplineCandidates({ targetId: AGENT, organizationId: ORG, currentUplineId: INACTIVE_TL }),
    ).rejects.toBeTruthy();
  });
});

describe("loadInviteManagerCandidates — InviteUserModal managers", () => {
  it("offers every Active Admin / Team Leader of the organization, with no exclusions", async () => {
    const managers = await loadInviteManagerCandidates({ organizationId: ORG });
    expect(managers.map((m) => m.id)).toEqual([ADMIN, DIRECT_TL_CHILD, GRANDCHILD_TL, OTHER_TL, TARGET_TL]);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].eq).toEqual({ organization_id: ORG, status: "Active" });
    expect(recorded[0].inVals).toEqual([...UPLINE_CANDIDATE_ROLES]);
  });

  it("issues no query without an organization", async () => {
    expect(await loadInviteManagerCandidates({ organizationId: null })).toEqual([]);
    expect(recorded).toHaveLength(0);
  });

  it("rejects on error", async () => {
    state.failWhen = () => true;
    await expect(loadInviteManagerCandidates({ organizationId: ORG })).rejects.toBeTruthy();
  });
});

describe("managerNamesById — the filter-independent Manager column lookup", () => {
  it("returns names (and status) for the given ids in the organization", async () => {
    const names = await managerNamesById([OTHER_TL, ADMIN], ORG);
    expect(names).toEqual({
      [OTHER_TL]: { firstName: "Ola", lastName: "Test", status: "Active" },
      [ADMIN]: { firstName: "Ada", lastName: "Test", status: "Active" },
    });
    expect(recorded).toHaveLength(1);
    expect(recorded[0].eq).toEqual({ organization_id: ORG });
    expect(recorded[0].inCol).toBe("id");
    expect(recorded[0].select).toBe("id, first_name, last_name, status");
  });

  it("includes a Deleted manager with its status, and omits another organization's profile", async () => {
    const names = await managerNamesById([DELETED_MID, FOREIGN_ADMIN], ORG);
    expect(names[DELETED_MID]).toEqual({ firstName: "Dee", lastName: "Test", status: "Deleted" });
    expect(names[FOREIGN_ADMIN]).toBeUndefined();
  });

  it("dedupes, drops empty ids and issues no query for nothing", async () => {
    await managerNamesById([ADMIN, ADMIN, "", null, undefined], ORG);
    expect(recorded[0].inVals).toEqual([ADMIN]);
    recorded.length = 0;
    expect(await managerNamesById([null, ""], ORG)).toEqual({});
    expect(await managerNamesById([ADMIN], null)).toEqual({});
    expect(recorded).toHaveLength(0);
  });

  it("batches a large id set by 50", async () => {
    const many = Array.from({ length: 120 }, (_, i) => uid(1000 + i));
    await managerNamesById(many, ORG);
    expect(recorded.map((q) => (q.inVals ?? []).length)).toEqual([50, 50, 20]);
    for (const q of recorded) expect(q.eq.organization_id).toBe(ORG);
  });

  it("rejects when any batch fails", async () => {
    const many = Array.from({ length: 60 }, (_, i) => uid(2000 + i));
    let calls = 0;
    state.failWhen = () => ++calls === 2;
    await expect(managerNamesById(many, ORG)).rejects.toBeTruthy();
  });
});
