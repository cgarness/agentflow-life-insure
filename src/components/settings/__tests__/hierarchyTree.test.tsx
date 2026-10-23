/**
 * F4 — Settings → User Management → Hierarchy (`HierarchyTree` + `VisualOrgNode`).
 *
 * Query scoping, not authorization (`profiles_select_org` permits same-org reads). The REAL
 * component, `loadHierarchyTreeData` and the `usersSupabaseApi` walks run against an
 * in-memory `profiles` table that applies only the filters the request carries — there is no
 * RLS in this double, so a request without an `organization_id` filter would see every
 * organization (which is exactly how the old chart's cross-org admission showed up).
 *
 * Pins: an Admin's chart is one org-filtered query and draws the whole organization; no
 * organization → no query and a distinct notice; another organization's row is never drawn,
 * even when its `upline_id` points into this organization; Team Leader / Agent viewers issue
 * only org-constrained walk rounds, upline-chain hops and id batches and see their reporting
 * line only; a Deleted manager with a live report beneath it is drawn muted with the report
 * attached under it (Admin, Team Leader and Agent viewers), Deleted leaves are not drawn and
 * Deleted members are never counted; a load failure is an error state with a retry, never
 * an empty chart; `hierarchy_path` is never selected.
 *
 * Shapes come from the shared synthetic file `supabase/tests/fixtures/hierarchy_shapes.json`
 * (the same rows the SQL suites seed). All ids and names are synthetic.
 */
import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Profile = {
  id: string; first_name: string; last_name: string; email: string; role: string; status: string;
  organization_id: string; upline_id: string | null; avatar_url: string | null; hierarchy_path: string;
  commission_level: string; created_at: string;
};
type Recorded = {
  table: string; select?: string; eq: Record<string, unknown>; neq: Record<string, unknown>;
  inCol?: string; inVals?: unknown[]; order: { col: string; ascending?: boolean }[];
  range?: { from: number; to: number }; single?: boolean;
};

const h = vi.hoisted(() => ({
  rows: [] as Profile[],
  recorded: [] as Recorded[],
  failWhen: null as null | ((q: Recorded) => boolean),
  profile: null as null | { id: string; role: string; is_super_admin: boolean; organization_id: string | null },
  organizationId: null as string | null,
}));

vi.mock("@/integrations/supabase/client", () => {
  const get = (r: Profile, c: string) => (r as Record<string, unknown>)[c];
  const run = (q: Recorded) => {
    h.recorded.push(q);
    if (h.failWhen?.(q)) return { data: null, error: { message: "query failed" } };
    let rows = h.rows.filter((r) =>
      Object.entries(q.eq).every(([c, v]) => get(r, c) === v) &&
      Object.entries(q.neq).every(([c, v]) => get(r, c) !== v) &&
      (!q.inCol || (q.inVals ?? []).includes(get(r, q.inCol))));
    for (const o of [...q.order].reverse()) {
      rows = [...rows].sort((a, b) => {
        const av = String(get(a, o.col) ?? "");
        const bv = String(get(b, o.col) ?? "");
        return (av < bv ? -1 : av > bv ? 1 : 0) * (o.ascending === false ? -1 : 1);
      });
    }
    if (q.range) rows = rows.slice(q.range.from, q.range.to + 1);
    const cols = (q.select ?? "*").split(",").map((c) => c.trim());
    const project = (r: Profile) => Object.fromEntries(cols.map((c) => [c, get(r, c)]));
    if (q.single) return { data: rows[0] ? project(rows[0]) : null, error: null };
    return { data: rows.map(project), error: null };
  };
  const from = (table: string) => {
    const q: Recorded = { table, eq: {}, neq: {}, order: [] };
    let settled: Promise<unknown> | null = null;
    const b: Record<string, unknown> = {
      select(c: string) { q.select = c; return b; },
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
  return { supabase: { from } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: h.profile }) }));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: h.organizationId }) }));

import HierarchyTree from "../HierarchyTree";
import { HIERARCHY_TREE_COLUMNS } from "@/lib/hierarchy/hierarchyTreeData";

type ShapeProfile = { key: string; id: string; org: string; role: string; status: string; upline: string | null };
const SHAPES = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../supabase/tests/fixtures/hierarchy_shapes.json"), "utf8"),
) as {
  organizations: { key: string; id: string }[];
  shapes: { production: { profiles: ShapeProfile[] }; invalid: { deleted_intermediate: { profiles: ShapeProfile[] } } };
};
const ORG = Object.fromEntries(SHAPES.organizations.map((o) => [o.key, o.id])) as Record<string, string>;

let seq = 0;
const toRows = (shape: ShapeProfile[], extra: ShapeProfile[] = []): Profile[] => {
  const all = [...shape, ...extra];
  const idByKey = new Map(all.map((s) => [s.key, s.id]));
  return all.map((s) => ({
    id: s.id,
    first_name: s.key,
    last_name: "Synthetic",
    email: `${s.key.toLowerCase()}@example.test`,
    role: s.role,
    status: s.status,
    organization_id: ORG[s.org],
    upline_id: s.upline ? idByKey.get(s.upline) ?? s.upline : null,
    avatar_url: null,
    hierarchy_path: "stale",
    commission_level: "50%",
    created_at: `2026-01-01T00:${String(Math.floor(seq / 60) % 60).padStart(2, "0")}:${String(seq++ % 60).padStart(2, "0")}.000Z`,
  }));
};

const PRODUCTION = SHAPES.shapes.production.profiles;
const DELETED_INTERMEDIATE = SHAPES.shapes.invalid.deleted_intermediate.profiles;
const idOf = (key: string) => [...PRODUCTION, ...DELETED_INTERMEDIATE, ...EXTRA].find((p) => p.key === key)!.id;
const name = (key: string) => `${key} Synthetic`;

/** Test-local rows: a Deleted Team Leader under T with an Active agent beneath it. */
const EXTRA: ShapeProfile[] = [
  { key: "TD", id: "aa000000-0000-4000-8000-0000000000d1", org: "A", role: "Team Leader", status: "Deleted", upline: "T" },
  { key: "TG", id: "aa000000-0000-4000-8000-0000000000d2", org: "A", role: "Agent", status: "Active", upline: "TD" },
];

const viewAs = (key: string, role: string, organizationId: string | null, isSuperAdmin = false) => {
  h.profile = { id: idOf(key), role, is_super_admin: isSuperAdmin, organization_id: organizationId };
  h.organizationId = organizationId;
};

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const kindOf = (q: Recorded) =>
  q.inCol === "upline_id" ? "walk" : q.single ? "chain" : q.inCol === "id" ? "batch" : q.range ? "organization" : "other";

beforeEach(() => {
  h.rows = toRows(PRODUCTION, DELETED_INTERMEDIATE);
  h.recorded.length = 0;
  h.failWhen = null;
  h.profile = null;
  h.organizationId = null;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Admin viewer — the whole organization", () => {
  it("is one org-filtered display-column query and draws every live member of the organization", async () => {
    viewAs("R", "Admin", ORG.A);
    render(<HierarchyTree />);
    expect(await screen.findByText(name("R"))).toBeInTheDocument();

    expect(h.recorded).toHaveLength(1);
    expect(kindOf(h.recorded[0])).toBe("organization");
    expect(h.recorded[0].eq).toEqual({ organization_id: ORG.A });
    expect(h.recorded[0].select).toBe(HIERARCHY_TREE_COLUMNS);
    for (const key of ["R", "T", "A1", "A2", "K1", "K2", "K3", "K4", "K5"]) {
      expect(screen.getByText(name(key))).toBeInTheDocument();
    }
    // T's reports are drawn under T.
    for (const key of ["A1", "A2"]) expect(within(screen.getByTestId(`hierarchy-node-${idOf("T")}`)).getByText(name(key))).toBeInTheDocument();
    expect(screen.getByText("9 members")).toBeInTheDocument();
    expect(screen.getByText(/Everyone in your organization/)).toBeInTheDocument();
  });

  it("does not draw Deleted leaves or an all-Deleted branch (nobody live reports through them)", async () => {
    viewAs("R", "Admin", ORG.A);
    render(<HierarchyTree />);
    await screen.findByText(name("R"));
    for (const key of ["D1", "T2", "D2"]) expect(screen.queryByText(name(key))).not.toBeInTheDocument();
    expect(screen.queryByText(/Deleted members appear muted/)).not.toBeInTheDocument();
  });

  it("never draws another organization's row, even one whose upline_id points into this organization", async () => {
    // The old chart queried without an organization filter and admitted foreign rows linked by
    // upline_id; this row is exactly that shape.
    h.rows = [
      ...h.rows,
      ...toRows([{ key: "XB", id: "bb000000-0000-4000-8000-0000000000f1", org: "B", role: "Agent", status: "Active", upline: null }])
        .map((r) => ({ ...r, upline_id: idOf("R") })),
    ];
    viewAs("R", "Admin", ORG.A);
    render(<HierarchyTree />);
    await screen.findByText(name("R"));
    for (const key of ["XB", "BA", "CA", "CG", "DA", "M", "MG"]) expect(screen.queryByText(name(key))).not.toBeInTheDocument();
    for (const q of h.recorded) expect(q.eq.organization_id).toBe(ORG.A);
  });

  it("an is_super_admin profile with a non-Admin role still takes the organization path", async () => {
    viewAs("K1", "Agent", ORG.A, true);
    render(<HierarchyTree />);
    expect(await screen.findByText(name("K5"))).toBeInTheDocument();
    expect(h.recorded.map(kindOf)).toEqual(["organization"]);
  });

  it("draws a Deleted manager muted with its live report attached beneath it, and does not count it", async () => {
    viewAs("M", "Admin", ORG.F);
    render(<HierarchyTree />);
    const mt = await screen.findByTestId(`hierarchy-node-${idOf("MT")}`);
    expect(within(mt).getByText(name("MG"))).toBeInTheDocument();
    expect(within(mt).getByText("Deleted · Team Leader")).toBeInTheDocument();
    expect(within(screen.getByTestId(`hierarchy-node-${idOf("M")}`)).getByTestId(`hierarchy-node-${idOf("MT")}`)).toBe(mt);
    expect(screen.getByText("2 members")).toBeInTheDocument();
    expect(screen.getByText(/Deleted members appear muted only where someone still reports through them/)).toBeInTheDocument();
  });
});

describe("fail closed", () => {
  it("issues no query without an organization and says so — not an empty organization", async () => {
    viewAs("R", "Admin", null);
    render(<HierarchyTree />);
    await flush();
    expect(h.recorded).toHaveLength(0);
    expect(screen.getByText(/organization could not be determined/)).toBeInTheDocument();
    expect(screen.queryByText(/No team members/)).not.toBeInTheDocument();
  });

  it("treats a blank organization as none", async () => {
    viewAs("R", "Admin", "   ", true);
    render(<HierarchyTree />);
    await flush();
    expect(h.recorded).toHaveLength(0);
    expect(screen.getByText(/organization could not be determined/)).toBeInTheDocument();
  });

  it("issues no query before the viewer's profile is known", async () => {
    h.organizationId = ORG.A;
    render(<HierarchyTree />);
    await flush();
    expect(h.recorded).toHaveLength(0);
    expect(screen.getByLabelText("Loading")).toBeInTheDocument();
  });

  it("an organization load error is an error state with a retry, never an empty chart", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    h.failWhen = () => true;
    viewAs("R", "Admin", ORG.A);
    render(<HierarchyTree />);
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't load the team structure.");
    expect(screen.queryByText(/No team members/)).not.toBeInTheDocument();
    expect(screen.queryByText(name("R"))).not.toBeInTheDocument();
    expect(logged).toHaveBeenCalled();

    h.failWhen = null;
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(await screen.findByText(name("R"))).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a Team Leader walk, chain or batch error is an error state — never a partial chart", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const failWhen of [
      (q: Recorded) => q.inCol === "upline_id",
      (q: Recorded) => q.single === true,
      (q: Recorded) => q.inCol === "id",
    ]) {
      h.failWhen = failWhen;
      viewAs("T", "Team Leader", ORG.A);
      render(<HierarchyTree />);
      expect(await screen.findByRole("alert")).toBeInTheDocument();
      expect(screen.queryByText(name("T"))).not.toBeInTheDocument();
      cleanup();
    }
  });

  it("a successful load with nobody in it is a truthful empty state, distinct from an error", async () => {
    h.rows = [];
    viewAs("R", "Admin", ORG.E);
    render(<HierarchyTree />);
    expect(await screen.findByText("No team members in this organization yet.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("never draws the previous organization's chart for a new one", async () => {
    viewAs("R", "Admin", ORG.A);
    const { rerender } = render(<HierarchyTree />);
    await screen.findByText(name("K1"));
    viewAs("M", "Admin", ORG.F);
    rerender(<HierarchyTree />);
    expect(screen.queryByText(name("K1"))).not.toBeInTheDocument();
    expect(await screen.findByText(name("MG"))).toBeInTheDocument();
    expect(screen.queryByText(name("K1"))).not.toBeInTheDocument();
  });
});

describe("Team Leader / Agent viewers — their reporting line only", () => {
  it("a Team Leader issues only org-constrained walk rounds, chain hops and id batches", async () => {
    viewAs("T", "Team Leader", ORG.A);
    render(<HierarchyTree />);
    await screen.findByText(name("T"));
    const kinds = h.recorded.map(kindOf);
    expect(kinds).not.toContain("organization");
    expect(kinds).not.toContain("other");
    expect(kinds).toEqual(expect.arrayContaining(["walk", "chain", "batch"]));
    for (const q of h.recorded) {
      expect(q.eq.organization_id).toBe(ORG.A);
      expect(q.select).not.toContain("hierarchy_path");
      if (kindOf(q) === "batch") expect(q.select).toBe(HIERARCHY_TREE_COLUMNS);
    }
  });

  it("a Team Leader sees its upline chain, itself and its downline — no peers, no Deleted leaves", async () => {
    viewAs("T", "Team Leader", ORG.A);
    render(<HierarchyTree />);
    await screen.findByText(name("T"));
    for (const key of ["R", "T", "A1", "A2"]) expect(screen.getByText(name(key))).toBeInTheDocument();
    for (const key of ["K1", "K2", "K3", "K4", "K5", "T2", "D2", "D1"]) expect(screen.queryByText(name(key))).not.toBeInTheDocument();
    expect(within(screen.getByTestId(`hierarchy-node-${idOf("R")}`)).getByText(name("A2"))).toBeInTheDocument();
    expect(screen.getByText("4 members")).toBeInTheDocument();
    expect(screen.getByText(/Your full upline chain and everyone in your downline/)).toBeInTheDocument();
  });

  it("a Team Leader's Deleted intermediate is drawn muted with the live report attached beneath it", async () => {
    h.rows = toRows(PRODUCTION, EXTRA);
    viewAs("T", "Team Leader", ORG.A);
    render(<HierarchyTree />);
    const td = await screen.findByTestId(`hierarchy-node-${idOf("TD")}`);
    expect(within(td).getByText(name("TG"))).toBeInTheDocument();
    expect(within(td).getByText("Deleted · Team Leader")).toBeInTheDocument();
    expect(within(screen.getByTestId(`hierarchy-node-${idOf("T")}`)).getByTestId(`hierarchy-node-${idOf("TD")}`)).toBe(td);
    // R, T, A1, A2, TG — the Deleted connector is not a member.
    expect(screen.getByText("5 members")).toBeInTheDocument();
  });

  it("an Agent sees its upline chain and itself", async () => {
    viewAs("K1", "Agent", ORG.A);
    render(<HierarchyTree />);
    await screen.findByText(name("K1"));
    expect(screen.getByText(name("R"))).toBeInTheDocument();
    for (const key of ["T", "A1", "K2"]) expect(screen.queryByText(name(key))).not.toBeInTheDocument();
    expect(screen.getByText("2 members")).toBeInTheDocument();
  });

  it("an Agent beneath a Deleted manager sees the chain through it, the Deleted manager muted", async () => {
    viewAs("MG", "Agent", ORG.F);
    render(<HierarchyTree />);
    const mt = await screen.findByTestId(`hierarchy-node-${idOf("MT")}`);
    expect(within(mt).getByText(name("MG"))).toBeInTheDocument();
    expect(within(mt).getByText("Deleted · Team Leader")).toBeInTheDocument();
    expect(within(screen.getByTestId(`hierarchy-node-${idOf("M")}`)).getByTestId(`hierarchy-node-${idOf("MT")}`)).toBe(mt);
    for (const q of h.recorded) expect(q.eq.organization_id).toBe(ORG.F);
  });
});
