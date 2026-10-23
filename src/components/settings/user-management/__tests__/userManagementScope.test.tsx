/**
 * F5 / F6 — Settings → User Management member scope (useUserManagementMembers) and the Team
 * Members table it feeds.
 *
 * Query scoping, NOT authorization: `profiles_select_org` permits same-org reads, so downline
 * scoping is query-enforced (AGENT_RULES §3) and must fail closed. The REAL
 * `usersSupabaseApi` (getAll / getAgentScopeTraversal / getByIds) and the real Manager-name
 * lookup run against an in-memory `profiles` table.
 *
 * Pins: Admin / Super Admin → `getAll`; Team Leader → traversal (through a Deleted
 * intermediate) → `getByIds` with role / status narrowing, NEVER `getAll`, traversal cached per
 * viewer / organization; Agent → self; a traversal failure → error state, no rows, no
 * organization-wide fallback; the Manager column is filled by id lookup independent of the
 * table filters (a Team Leader's own manager, managers hidden by an Admin role filter); the
 * Team Leader viewer gets no Deactivate and a read-only billing control (UI mirror only).
 * All ids are synthetic.
 */
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Profile = {
  id: string; first_name: string; last_name: string; email: string; role: string; status: string;
  organization_id: string; upline_id: string | null; is_super_admin: boolean; billing_type: string;
  availability_status: string;
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
  auth: { profile: null as Record<string, unknown> | null },
  toasts: [] as { title?: string; description?: string }[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const run = (q: Recorded) => {
    h.recorded.push(q);
    if (h.failWhen?.(q)) return { data: null, error: { message: "query failed" } };
    const get = (r: Profile, c: string) => (r as Record<string, unknown>)[c];
    let rows = h.rows.filter((r) =>
      Object.entries(q.eq).every(([c, v]) => get(r, c) === v) &&
      Object.entries(q.neq).every(([c, v]) => get(r, c) !== v) &&
      (!q.inCol || (q.inVals ?? []).includes(get(r, q.inCol))));
    for (const o of [...q.order].reverse()) {
      rows = [...rows].sort((a, b) =>
        String(get(a, o.col) ?? "").localeCompare(String(get(b, o.col) ?? "")) * (o.ascending === false ? -1 : 1));
    }
    if (q.range) rows = rows.slice(q.range.from, q.range.to + 1);
    const cols = (q.select ?? "*").split(",").map((c) => c.trim());
    const project = (r: Profile) => Object.fromEntries(cols.map((c) => [c, get(r, c)]));
    if (q.single) return { data: rows[0] ? project(rows[0]) : null, error: null };
    return { data: rows.map(project), error: null };
  };
  const from = (table: string) => {
    const q: Recorded = { table, eq: {}, neq: {}, order: [] };
    const b: Record<string, unknown> = {
      select(c: string) { q.select = c; return b; },
      eq(c: string, v: unknown) { q.eq[c] = v; return b; },
      neq(c: string, v: unknown) { q.neq[c] = v; return b; },
      in(c: string, v: unknown[]) { q.inCol = c; q.inVals = [...v]; return b; },
      or() { return b; },
      order(c: string, o?: { ascending?: boolean }) { q.order.push({ col: c, ...(o ?? {}) }); return b; },
      range(from: number, to: number) { q.range = { from, to }; return b; },
      maybeSingle() { q.single = true; return b; },
      then(onF: unknown, onR: unknown) { return Promise.resolve(run(q)).then(onF as never, onR as never); },
    };
    return b;
  };
  return { supabase: { from } };
});
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: h.auth.profile ? { id: h.auth.profile.id } : null,
    profile: h.auth.profile,
    realProfile: h.auth.profile,
    startImpersonation: vi.fn(),
  }),
}));
vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: (h.auth.profile?.organization_id as string) ?? null, isSuperAdmin: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: (t: { title?: string }) => { h.toasts.push(t); } }) }));
vi.mock("@/lib/activityLogger", () => ({ logActivity: vi.fn() }));
vi.mock("@/components/settings/HierarchyTree", () => ({ default: () => null }));
vi.mock("react-router-dom", () => ({ useNavigate: () => () => {} }));
vi.mock("@/components/ui/select", () => import("./nativeSelectMock"));
vi.mock("@/components/ui/dropdown-menu", () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children);
  return {
    DropdownMenu: Pass, DropdownMenuTrigger: Pass, DropdownMenuContent: Pass, DropdownMenuSeparator: () => null,
    DropdownMenuItem: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) =>
      React.createElement("button", { type: "button", onClick }, children),
  };
});

import { usersSupabaseApi } from "@/lib/supabase-users";
import UserManagement from "../../UserManagement";
import {
  loadMemberManagerNames,
  loadUserManagementMembers,
  memberScopeKind,
} from "@/hooks/useUserManagementMembers";

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";

const ADMIN = uid(1);
const TL = uid(2);
const AGENT_A = uid(3);
const DELETED_MID = uid(4);
const DEEP_AGENT = uid(5);
const INACTIVE_AGENT = uid(6);
const OTHER_TL = uid(7);
const OTHER_AGENT = uid(8);
const FOREIGN = uid(9);
const SUB_TL = uid(10);

const p = (id: string, first: string, role: string, upline: string | null, status = "Active", org = ORG): Profile => ({
  id, first_name: first, last_name: "Test", email: `${first.toLowerCase()}@example.test`, role, status,
  organization_id: org, upline_id: upline, is_super_admin: false, billing_type: "agency_covered", availability_status: "Offline",
});

const SHAPE = (): Profile[] => [
  p(ADMIN, "Ada", "Admin", null),
  p(TL, "Tess", "Team Leader", ADMIN),
  p(AGENT_A, "Abe", "Agent", TL),
  p(SUB_TL, "Sol", "Team Leader", TL),
  p(DELETED_MID, "Dee", "Team Leader", TL, "Deleted"),
  p(DEEP_AGENT, "Gus", "Agent", DELETED_MID),
  p(INACTIVE_AGENT, "Ivy", "Agent", SUB_TL, "Inactive"),
  p(OTHER_TL, "Ola", "Team Leader", ADMIN),
  p(OTHER_AGENT, "Oz", "Agent", OTHER_TL),
  p(FOREIGN, "Fay", "Agent", TL, "Active", OTHER_ORG),
];

const viewerOf = (id: string) => {
  const r = h.rows.find((x) => x.id === id)!;
  return { id: r.id, role: r.role, isSuperAdmin: r.is_super_admin };
};
const firstNames = (members: { firstName: string }[]) => members.map((m) => m.firstName).sort();
const traversalQueries = () => h.recorded.filter((q) => q.inCol === "upline_id");
const unscopedReads = () => h.recorded.filter((q) => q.table === "profiles" && !q.inCol && !q.single && q.select?.includes("commission_level"));

let getAllSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.rows = SHAPE();
  h.recorded = [];
  h.failWhen = null;
  h.toasts = [];
  h.auth.profile = null;
  getAllSpy = vi.spyOn(usersSupabaseApi, "getAll");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("memberScopeKind", () => {
  it.each([
    [{ id: ADMIN, role: "Admin" }, "organization"],
    [{ id: ADMIN, role: "Super Admin" }, "organization"],
    [{ id: TL, role: "Team Leader", isSuperAdmin: true }, "organization"],
    [{ id: TL, role: "Team Leader" }, "downline"],
    [{ id: AGENT_A, role: "Agent" }, "self"],
    [{ id: AGENT_A, role: "Team Lead" }, "self"],
    [{ id: AGENT_A, role: null }, "self"],
    [{ id: "", role: "Admin" }, "none"],
  ])("%o → %s", (viewer, kind) => {
    expect(memberScopeKind(viewer, ORG)).toBe(kind);
  });
  it("no organization → none", () => expect(memberScopeKind({ id: ADMIN, role: "Admin" }, null)).toBe("none"));
});

describe("loadUserManagementMembers", () => {
  it("Admin → getAll for the organization", async () => {
    const { scope, members } = await loadUserManagementMembers({ viewer: viewerOf(ADMIN), organizationId: ORG });
    expect(scope).toBe("organization");
    expect(getAllSpy).toHaveBeenCalledWith({ search: "", role: "All", status: "All", organizationId: ORG });
    expect(firstNames(members)).toEqual(["Abe", "Ada", "Gus", "Ivy", "Ola", "Oz", "Sol", "Tess"]);
  });

  it("Team Leader → traversal through a Deleted intermediate → getByIds; never getAll", async () => {
    const byIds = vi.spyOn(usersSupabaseApi, "getByIds");
    const { scope, members } = await loadUserManagementMembers({ viewer: viewerOf(TL), organizationId: ORG });
    expect(scope).toBe("downline");
    expect(getAllSpy).not.toHaveBeenCalled();
    expect(unscopedReads()).toHaveLength(0);
    expect(firstNames(members)).toEqual(["Abe", "Gus", "Ivy", "Sol", "Tess"]);
    expect(byIds.mock.calls[0][0]).toMatchObject({ organizationId: ORG, role: "All", status: "All" });
    expect(byIds.mock.calls[0][0].ids).not.toContain(DELETED_MID);
    expect(byIds.mock.calls[0][0].ids).not.toContain(FOREIGN);
    for (const q of traversalQueries()) expect(q.eq.organization_id).toBe(ORG);
  });

  it("Team Leader role / status filters narrow the scoped read, never widen it", async () => {
    const agents = await loadUserManagementMembers({ viewer: viewerOf(TL), organizationId: ORG, filters: { role: "Agent" } });
    expect(firstNames(agents.members)).toEqual(["Abe", "Gus", "Ivy"]);
    const inactive = await loadUserManagementMembers({ viewer: viewerOf(TL), organizationId: ORG, filters: { status: "Inactive" } });
    expect(firstNames(inactive.members)).toEqual(["Ivy"]);
    expect(getAllSpy).not.toHaveBeenCalled();
  });

  it("caches the traversal per viewer and organization", async () => {
    const cache = new Map();
    await loadUserManagementMembers({ viewer: viewerOf(TL), organizationId: ORG, traversalCache: cache });
    const walked = traversalQueries().length;
    expect(walked).toBeGreaterThan(0);
    await loadUserManagementMembers({ viewer: viewerOf(TL), organizationId: ORG, filters: { search: "ab" }, traversalCache: cache });
    expect(traversalQueries()).toHaveLength(walked);
    await loadUserManagementMembers({ viewer: viewerOf(OTHER_TL), organizationId: ORG, traversalCache: cache });
    expect(traversalQueries().length).toBeGreaterThan(walked);
  });

  it("a traversal failure rejects: no rows, no getAll fallback", async () => {
    h.failWhen = (q) => q.inCol === "upline_id";
    await expect(loadUserManagementMembers({ viewer: viewerOf(TL), organizationId: ORG })).rejects.toBeTruthy();
    expect(getAllSpy).not.toHaveBeenCalled();
    expect(h.recorded.filter((q) => q.inCol === "id")).toHaveLength(0);
  });

  it("Agent → own row only", async () => {
    const { scope, members } = await loadUserManagementMembers({ viewer: viewerOf(AGENT_A), organizationId: ORG });
    expect(scope).toBe("self");
    expect(firstNames(members)).toEqual(["Abe"]);
    expect(getAllSpy).not.toHaveBeenCalled();
    expect(traversalQueries()).toHaveLength(0);
  });

  it("no organization → no query", async () => {
    await expect(loadUserManagementMembers({ viewer: viewerOf(ADMIN), organizationId: null }))
      .resolves.toEqual({ scope: "none", members: [] });
    expect(h.recorded).toHaveLength(0);
  });

  it("manager names come from an id lookup, independent of scope and filters", async () => {
    const { members } = await loadUserManagementMembers({ viewer: viewerOf(TL), organizationId: ORG, filters: { role: "Team Leader" } });
    const names = await loadMemberManagerNames(members, ORG);
    expect(names[ADMIN]).toMatchObject({ firstName: "Ada" }); // the Team Leader's own manager, outside the scope
    expect(names[TL]).toMatchObject({ firstName: "Tess" });
  });
});

async function renderAs(id: string) {
  const r = h.rows.find((x) => x.id === id)!;
  h.auth.profile = { id: r.id, role: r.role, is_super_admin: r.is_super_admin, organization_id: r.organization_id, first_name: r.first_name, last_name: r.last_name };
  render(<UserManagement />);
  await act(async () => {});
}
const rowOf = (firstName: string) => screen.getByText(`${firstName} Test`, { selector: "span" }).closest("tr")!;
const listedNames = () => Array.from(document.querySelectorAll("tbody tr")).map((tr) => tr.querySelector("span.font-semibold")?.textContent);

describe("UserManagement table", () => {
  it("Team Leader: downline rows, own manager named, no Deactivate, billing read-only", async () => {
    await renderAs(TL);
    await waitFor(() => expect(listedNames()).toEqual(["Abe Test", "Gus Test", "Ivy Test", "Sol Test", "Tess Test"]));
    expect(getAllSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(within(rowOf("Tess")).getByText(/Ada Test/)).toBeInTheDocument());
    expect(within(rowOf("Gus")).getByText(/Dee Test \(Deleted\)/)).toBeInTheDocument();
    expect(within(rowOf("Abe")).getByRole("combobox")).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Deactivate/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Reactivate/ })).toBeNull();
  });

  it("Team Leader: a scope failure is an error state with no rows and no organization-wide fallback", async () => {
    h.failWhen = (q) => q.inCol === "upline_id";
    await renderAs(TL);
    expect(await screen.findByText("We couldn't load team members. Try again.")).toBeInTheDocument();
    expect(listedNames()).toEqual([]);
    expect(screen.queryByText("No team members found")).toBeNull();
    expect(getAllSpy).not.toHaveBeenCalled();
  });

  it("Admin: a role filter does not blank the Manager column; Deactivate and billing available", async () => {
    await renderAs(ADMIN);
    await waitFor(() => expect(listedNames()).toHaveLength(8));
    fireEvent.change(screen.getByLabelText("Filter by role"), { target: { value: "Agent" } });
    await waitFor(() => expect(listedNames()).toEqual(["Abe Test", "Gus Test", "Ivy Test", "Oz Test"]));
    await waitFor(() => expect(within(rowOf("Oz")).getByText(/Ola Test/)).toBeInTheDocument());
    expect(within(rowOf("Abe")).getByText(/Tess Test/)).toBeInTheDocument();
    expect(within(rowOf("Abe")).getByRole("combobox")).not.toBeDisabled();
    expect(within(rowOf("Abe")).getByRole("button", { name: /Deactivate/ })).toBeInTheDocument();
    expect(within(rowOf("Ivy")).getByRole("button", { name: /Reactivate/ })).toBeInTheDocument();
  });

  it("Invite managers come from the manager loader, independent of the table filters", async () => {
    await renderAs(ADMIN);
    fireEvent.change(screen.getByLabelText("Filter by role"), { target: { value: "Agent" } });
    await waitFor(() => expect(listedNames()).toEqual(["Abe Test", "Gus Test", "Ivy Test", "Oz Test"]));
    fireEvent.click(screen.getByRole("button", { name: /Invite New Agent/ }));
    const upline = (await screen.findByLabelText("Upline Manager")) as HTMLSelectElement;
    await waitFor(() => expect(Array.from(upline.options).map((o) => o.textContent))
      .toEqual(["None", "Ada Test", "Ola Test", "Sol Test", "Tess Test"]));
    const managerQuery = h.recorded.find((q) => Array.isArray(q.inVals) && q.inCol === "role")!;
    expect(managerQuery.eq).toMatchObject({ organization_id: ORG, status: "Active" });
  });

  it("Agent: only their own row", async () => {
    await renderAs(AGENT_A);
    await waitFor(() => expect(listedNames()).toEqual(["Abe Test"]));
    await waitFor(() => expect(within(rowOf("Abe")).getByText(/Tess Test/)).toBeInTheDocument());
    expect(getAllSpy).not.toHaveBeenCalled();
  });
});
