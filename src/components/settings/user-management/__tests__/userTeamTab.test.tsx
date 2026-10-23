/**
 * F3 — User Management → Team Leader profile → "My Team" tab (UserTeamTab + useTeamMembers).
 *
 * Query scoping, not authorization (`profiles_select_org` permits same-org reads; the upline
 * writes are Admin-only in the database). The REAL hook, loaders and `getUplineChainIds` run
 * against an in-memory `profiles` table; only the two upline writes are doubles that mutate
 * that table the way the database would.
 *
 * Pins: explicit organization filter and Deleted excluded on the team read; a load error is an
 * error state, never "No agents assigned"; "Add Agent" offers only Active, unassigned Agents
 * of the organization and never the leader's own upline chain (a cycle); a chain or roster
 * failure shows an error instead of a list; Add / Remove re-read the team from the database,
 * call `onTeamChanged`, and surface database messages; non-Admin viewers get no controls.
 * All ids are synthetic.
 */
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Profile = {
  id: string; first_name: string; last_name: string; email: string; role: string; status: string;
  organization_id: string; upline_id: string | null; avatar_url: string | null;
};
type Recorded = {
  table: string; select?: string; eq: Record<string, unknown>; neq: Record<string, unknown>;
  is: Record<string, unknown>; inCol?: string; inVals?: unknown[]; single?: boolean;
};

const h = vi.hoisted(() => ({
  rows: [] as Profile[],
  recorded: [] as Recorded[],
  failWhen: null as null | ((q: Recorded) => boolean),
  toasts: [] as { title?: string; description?: string; variant?: string }[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const run = (q: Recorded) => {
    h.recorded.push(q);
    if (h.failWhen?.(q)) return { data: null, error: { message: "query failed" } };
    const get = (r: Profile, c: string) => (r as Record<string, unknown>)[c];
    let rows = h.rows.filter((r) =>
      Object.entries(q.eq).every(([c, v]) => get(r, c) === v) &&
      Object.entries(q.neq).every(([c, v]) => get(r, c) !== v) &&
      Object.entries(q.is).every(([c, v]) => (get(r, c) ?? null) === v) &&
      (!q.inCol || (q.inVals ?? []).includes(get(r, q.inCol))));
    rows = [...rows].sort((a, b) => a.first_name.localeCompare(b.first_name));
    const cols = (q.select ?? "*").split(",").map((c) => c.trim());
    const project = (r: Profile) => Object.fromEntries(cols.map((c) => [c, get(r, c)]));
    if (q.single) return { data: rows[0] ? project(rows[0]) : null, error: null };
    return { data: rows.map(project), error: null };
  };
  const from = (table: string) => {
    const q: Recorded = { table, eq: {}, neq: {}, is: {} };
    const b: Record<string, unknown> = {
      select(c: string) { q.select = c; return b; },
      eq(c: string, v: unknown) { q.eq[c] = v; return b; },
      neq(c: string, v: unknown) { q.neq[c] = v; return b; },
      is(c: string, v: unknown) { q.is[c] = v; return b; },
      in(c: string, v: unknown[]) { q.inCol = c; q.inVals = [...v]; return b; },
      order() { return b; },
      range() { return b; },
      maybeSingle() { q.single = true; return b; },
      then(onF: unknown, onR: unknown) { return Promise.resolve(run(q)).then(onF as never, onR as never); },
    };
    return b;
  };
  return { supabase: { from } };
});
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: (t: { title?: string; description?: string; variant?: string }) => { h.toasts.push(t); } }),
}));

import { PROFILE_UPDATE_REFUSED, usersSupabaseApi } from "@/lib/supabase-users";
import UserTeamTab from "../UserTeamTab";
import { loadTeamAssignableAgents, loadTeamMembers } from "@/hooks/useTeamMembers";

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";

const ROOT_AGENT = uid(1); // an Agent at the top of the leader's chain (no upline): never offerable
const ADMIN = uid(2);
const LEADER = uid(3);
const MEMBER_A = uid(4);
const MEMBER_DELETED = uid(5);
const FREE_AGENT = uid(6);
const FREE_INACTIVE = uid(7);
const FOREIGN_AGENT = uid(8);
const FOREIGN_REPORT = uid(9);
const ASSIGNED_ELSEWHERE = uid(10);

const p = (id: string, first: string, role: string, upline: string | null, status = "Active", org = ORG): Profile =>
  ({ id, first_name: first, last_name: "Test", email: `${first.toLowerCase()}@example.test`, role, status,
    organization_id: org, upline_id: upline, avatar_url: null });

const SHAPE = (): Profile[] => [
  p(ROOT_AGENT, "Rex", "Agent", null),
  p(ADMIN, "Ada", "Admin", ROOT_AGENT),
  p(LEADER, "Lee", "Team Leader", ADMIN),
  p(MEMBER_A, "Amy", "Agent", LEADER),
  p(MEMBER_DELETED, "Dan", "Agent", LEADER, "Deleted"),
  p(FREE_AGENT, "Fay", "Agent", null),
  p(FREE_INACTIVE, "Ivo", "Agent", null, "Inactive"),
  p(FOREIGN_AGENT, "Zed", "Agent", null, "Active", OTHER_ORG),
  // Corrupt cross-org edge: must never appear on this organization's team.
  p(FOREIGN_REPORT, "Xia", "Agent", LEADER, "Active", OTHER_ORG),
  p(ASSIGNED_ELSEWHERE, "Bea", "Agent", ADMIN),
];

let assignSpy: ReturnType<typeof vi.spyOn>;
let removeSpy: ReturnType<typeof vi.spyOn>;

async function show(canManage = true) {
  const onTeamChanged = vi.fn();
  render(<UserTeamTab userId={LEADER} organizationId={ORG} canManage={canManage} onTeamChanged={onTeamChanged} />);
  await act(async () => {});
  return { onTeamChanged };
}
const lastToast = () => h.toasts[h.toasts.length - 1];
const memberNames = () => screen.queryAllByText(/^[A-Z][a-z]+ Test$/).map((n) => n.textContent);

beforeEach(() => {
  h.rows = SHAPE();
  h.recorded = [];
  h.failWhen = null;
  h.toasts = [];
  assignSpy = vi.spyOn(usersSupabaseApi, "assignUpline").mockImplementation(async (userId: string, uplineId: string | null) => {
    h.rows = h.rows.map((r) => (r.id === userId ? { ...r, upline_id: uplineId } : r));
  });
  removeSpy = vi.spyOn(usersSupabaseApi, "removeFromTeam").mockImplementation(async (userId: string) => {
    h.rows = h.rows.map((r) => (r.id === userId ? { ...r, upline_id: null } : r));
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("team list", () => {
  it("lists direct reports of this organization only, Deleted excluded, with an explicit org filter", async () => {
    await show();
    expect(memberNames()).toEqual(["Amy Test"]);
    expect(screen.getByText("1 agent assigned")).toBeInTheDocument();
    const teamQuery = h.recorded.find((q) => q.eq.upline_id === LEADER)!;
    expect(teamQuery.eq.organization_id).toBe(ORG);
    expect(teamQuery.neq.status).toBe("Deleted");
  });

  it("a load error is an error state, not an empty team", async () => {
    h.failWhen = (q) => q.eq.upline_id === LEADER;
    await show();
    expect(screen.getByText("We couldn't load this team. Try again.")).toBeInTheDocument();
    expect(screen.queryByText(/No agents assigned/)).toBeNull();
    expect(screen.queryByText(/agents? assigned/)).toBeNull();
  });

  it("an empty team says so", async () => {
    h.rows = h.rows.filter((r) => r.upline_id !== LEADER);
    await show();
    expect(screen.getByText("No agents assigned to this team leader yet.")).toBeInTheDocument();
  });

  it("issues no query without an organization", async () => {
    await expect(loadTeamMembers({ leaderId: LEADER, organizationId: null })).resolves.toEqual([]);
    await expect(loadTeamAssignableAgents({ leaderId: LEADER, organizationId: "" })).resolves.toEqual([]);
    expect(h.recorded).toHaveLength(0);
  });
});

describe("Add Agent", () => {
  it("offers Active unassigned Agents of the org, never the leader's upline chain", async () => {
    await show();
    fireEvent.click(screen.getByRole("button", { name: /Add Agent/ }));
    await screen.findByText("Fay Test");
    const menu = screen.getByPlaceholderText("Search agents...").closest("div")!.parentElement!;
    expect(within(menu).queryByText("Rex Test")).toBeNull(); // ancestor of the leader → would be a cycle
    expect(within(menu).queryByText("Ivo Test")).toBeNull(); // Inactive
    expect(within(menu).queryByText("Zed Test")).toBeNull(); // other organization
    expect(within(menu).queryByText("Bea Test")).toBeNull(); // already has an upline
    const roster = h.recorded.find((q) => q.eq.role === "Agent")!;
    expect(roster.eq).toMatchObject({ organization_id: ORG, status: "Active" });
    expect(roster.is).toEqual({ upline_id: null });
  });

  it("assigning re-reads the team from the database and refreshes the parent list", async () => {
    const { onTeamChanged } = await show();
    fireEvent.click(screen.getByRole("button", { name: /Add Agent/ }));
    fireEvent.click(await screen.findByText("Fay Test"));
    await waitFor(() => expect(memberNames()).toEqual(["Amy Test", "Fay Test"]));
    expect(assignSpy).toHaveBeenCalledWith(FREE_AGENT, LEADER);
    expect(onTeamChanged).toHaveBeenCalledTimes(1);
    expect(lastToast()).toMatchObject({ title: "Agent assigned successfully" });
  });

  it("a refused assignment shows the database message and changes nothing", async () => {
    assignSpy.mockRejectedValueOnce({ message: "Hierarchy: this upline would create a reporting cycle" });
    const { onTeamChanged } = await show();
    fireEvent.click(screen.getByRole("button", { name: /Add Agent/ }));
    fireEvent.click(await screen.findByText("Fay Test"));
    await waitFor(() => expect(lastToast()).toMatchObject({
      title: "Failed to assign agent", description: "Hierarchy: this upline would create a reporting cycle", variant: "destructive",
    }));
    expect(onTeamChanged).not.toHaveBeenCalled();
    expect(memberNames()).toContain("Amy Test");
  });

  it("an upline-chain failure fails closed: an error, no agents offered", async () => {
    h.failWhen = (q) => q.single === true; // getUplineChainIds' per-hop read
    await show();
    fireEvent.click(screen.getByRole("button", { name: /Add Agent/ }));
    expect(await screen.findByText("We couldn't load agents to add. Try again.")).toBeInTheDocument();
    expect(screen.queryByText("Fay Test")).toBeNull();
    expect(screen.queryByText("No unassigned agents found.")).toBeNull();
  });
});

describe("Remove and viewer controls", () => {
  it("removing re-reads the team and refreshes the parent list", async () => {
    const { onTeamChanged } = await show();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await screen.findByText("No agents assigned to this team leader yet.");
    expect(removeSpy).toHaveBeenCalledWith(MEMBER_A);
    expect(onTeamChanged).toHaveBeenCalledTimes(1);
  });

  it("a refused removal surfaces the database message", async () => {
    removeSpy.mockRejectedValueOnce({ message: "Only an Admin of this organization may change account-control fields (status, team, upline, billing)" });
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(lastToast()?.description).toMatch(/Only an Admin of this organization/));
    expect(memberNames()).toEqual(["Amy Test"]);
  });

  it("an RLS-filtered (zero-row) removal is a failure toast, never a silent success", async () => {
    removeSpy.mockRejectedValueOnce(new Error(PROFILE_UPDATE_REFUSED));
    const { onTeamChanged } = await show();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(lastToast()).toMatchObject({
      title: "Failed to remove agent", description: PROFILE_UPDATE_REFUSED, variant: "destructive",
    }));
    expect(onTeamChanged).not.toHaveBeenCalled();
    expect(memberNames()).toEqual(["Amy Test"]);
  });

  it("a viewer who cannot change uplines gets no Add Agent or Remove (UI mirror only)", async () => {
    await show(false);
    expect(memberNames()).toEqual(["Amy Test"]);
    expect(screen.queryByRole("button", { name: /Add Agent/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });
});
