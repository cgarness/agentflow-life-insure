/**
 * useContactAssigneeOptions — FullScreenContactView's "Assigned Agent" data (F10, moved out of
 * the component per F12).
 *
 * Pins the reads (explicit organization filter on the Active roster, no roster query without an
 * organization, `get_contact_scope_agents` only for a non-impersonating Team Leader, the
 * assignee row looked up only when it is not the viewer), fail-closed errors (a failed read is
 * an empty list, never a rejection), the per-role options, and the stale-response rules: a load
 * that lands after the contact or scope changed is ignored, and a scope change drops the
 * previous scope's lists on the same render. Every read is held until the test releases it.
 * Synthetic ids only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { EffectiveViewer } from "@/lib/effectiveViewer";

type Res = { data: unknown; error: { message: string } | null };
type Read = {
  kind: "assignee" | "roster" | "rpc"; select?: string; eq: Record<string, unknown>; fn?: string;
  release: (r?: Res) => void; fail: (e: unknown) => void;
};

const h = vi.hoisted(() => ({
  reads: [] as Read[],
  profiles: [] as { id: string; first_name: string; last_name: string; status: string; organization_id: string }[],
  team: [] as { id: string; first_name: string; last_name: string }[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const held = (read: Omit<Read, "release" | "fail">, answer: () => Res) =>
    new Promise<Res>((resolve, reject) => {
      h.reads.push({ ...read, release: (r) => resolve(r ?? answer()), fail: reject });
    });
  const from = (table: string) => {
    if (table !== "profiles") throw new Error(`unexpected table ${table}`);
    const q = { select: "", eq: {} as Record<string, unknown> };
    const match = () =>
      h.profiles.filter((p) => Object.entries(q.eq).every(([c, v]) => (p as Record<string, unknown>)[c] === v));
    const read = (kind: Read["kind"]) => ({ kind, select: q.select, eq: { ...q.eq } });
    const b: Record<string, unknown> = {
      select(cols: string) { q.select = cols; return b; },
      eq(col: string, v: unknown) { q.eq[col] = v; return b; },
      maybeSingle: () => held(read("assignee"), () => ({ data: match()[0] ?? null, error: null })),
      then: (onF: (v: Res) => unknown, onR?: (e: unknown) => unknown) =>
        held(read("roster"), () => ({ data: match(), error: null })).then(onF, onR),
    };
    return b;
  };
  const rpc = (fn: string) => held({ kind: "rpc", fn, eq: {} }, () => ({ data: h.team, error: null }));
  return { supabase: { from, rpc } };
});

import { loadContactAssigneeRoster, useContactAssigneeOptions } from "../useContactAssigneeOptions";

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const ADMIN = uid(1);
const LEADER = uid(2);
const REPORT = uid(3);
const PEER = uid(4);
const INACTIVE = uid(5);
const FOREIGN = uid(6);

const person = (id: string, first: string, status = "Active", org = ORG) =>
  ({ id, first_name: first, last_name: "Test", status, organization_id: org });
const asViewer = (viewerId: string, role: string, extra: Partial<EffectiveViewer> = {}): EffectiveViewer =>
  ({ viewerId, role, organizationId: ORG, isImpersonating: false, ...extra });

type Props = Parameters<typeof useContactAssigneeOptions>[0];
const props = (over: Partial<Props> = {}): Props => ({
  contactId: "lead-1", currentAssigneeId: PEER, organizationId: ORG,
  viewer: asViewer(ADMIN, "Admin"), selfId: ADMIN, ...over,
});

/** Lets pending work run. `Promise.all` subscribes to a query builder (a thenable) a microtask late. */
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
/** Releases the given held reads (default: every read so far) with their default answer. */
async function releaseAll(reads?: Read[]) {
  await flush();
  await act(async () => {
    for (const r of reads ?? h.reads.slice()) r.release();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

beforeEach(() => {
  h.reads = [];
  h.profiles = [
    person(ADMIN, "Ada"), person(LEADER, "Lee"), person(REPORT, "Rae"), person(PEER, "Pia"),
    person(INACTIVE, "Ivo", "Inactive"), person(FOREIGN, "Zed", "Active", OTHER_ORG),
  ];
  h.team = [
    { id: LEADER, first_name: "Lee", last_name: "Test" },
    { id: REPORT, first_name: "Rae", last_name: "Test" },
  ];
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("loadContactAssigneeRoster — the reads", () => {
  it("reads the Active roster with an explicit organization filter, the assignee row by id, and no RPC", async () => {
    const p = loadContactAssigneeRoster({ organizationId: ORG, assigneeId: INACTIVE, withTeam: false });
    await releaseAll();
    const result = await p;
    const roster = h.reads.find((r) => r.kind === "roster")!;
    expect(roster.select).toBe("id, first_name, last_name, status");
    expect(roster.eq).toEqual({ organization_id: ORG, status: "Active" });
    expect(h.reads.find((r) => r.kind === "assignee")!.eq).toEqual({ id: INACTIVE });
    expect(h.reads.some((r) => r.kind === "rpc")).toBe(false);
    expect(ids(result.roster)).toEqual([ADMIN, LEADER, REPORT, PEER]);
    expect(result.assignee).toEqual({ id: INACTIVE, firstName: "Ivo", lastName: "Test" });
    expect(result.team).toEqual([]);
  });

  it("without an organization: no roster query; without an assignee: no lookup", async () => {
    const p = loadContactAssigneeRoster({ organizationId: " ", assigneeId: "", withTeam: false });
    await releaseAll();
    expect(await p).toEqual({ roster: [], team: [], assignee: null });
    expect(h.reads).toEqual([]);
  });

  it("reads get_contact_scope_agents only when asked (a non-impersonating Team Leader)", async () => {
    const p = loadContactAssigneeRoster({ organizationId: ORG, assigneeId: "", withTeam: true });
    await releaseAll();
    expect(h.reads.filter((r) => r.kind === "rpc").map((r) => r.fn)).toEqual(["get_contact_scope_agents"]);
    expect(ids((await p).team)).toEqual([LEADER, REPORT]);
  });

  it("a read error is an empty list or no row (fail closed), never a rejection", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const p = loadContactAssigneeRoster({ organizationId: ORG, assigneeId: PEER, withTeam: true });
    await flush();
    expect(h.reads).toHaveLength(3);
    await act(async () => {
      for (const r of h.reads) r.release({ data: [{ id: "should-not-appear" }], error: { message: "denied" } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(await p).toEqual({ roster: [], team: [], assignee: null });
    expect(error).toHaveBeenCalled();
  });

  it("a thrown read resolves to empty lists instead of rejecting", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const p = loadContactAssigneeRoster({ organizationId: ORG, assigneeId: PEER, withTeam: true });
    await act(async () => {
      h.reads[0].fail(new Error("network down"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await expect(p).resolves.toEqual({ roster: [], team: [], assignee: null });
    expect(error).toHaveBeenCalled();
  });
});

describe("useContactAssigneeOptions — options by role", () => {
  it("Admin: the organization roster, the current assignee kept; the RPC is never called", async () => {
    const { result } = renderHook(() => useContactAssigneeOptions(props({ currentAssigneeId: INACTIVE })));
    expect(result.current.rosterLoaded).toBe(false);
    await releaseAll();
    expect(result.current.rosterLoaded).toBe(true);
    expect(ids(result.current.assigneeOptions)).toEqual([INACTIVE, ADMIN, LEADER, REPORT, PEER]);
    expect(ids(result.current.agents)).toEqual([INACTIVE, ADMIN, LEADER, REPORT, PEER]);
    expect(h.reads.some((r) => r.kind === "rpc")).toBe(false);
  });

  it("Team Leader: self + downline from the server; a peer assignee is kept, no other peer offered", async () => {
    const { result } = renderHook(() =>
      useContactAssigneeOptions(props({ viewer: asViewer(LEADER, "Team Leader"), selfId: LEADER })));
    await releaseAll();
    expect(h.reads.filter((r) => r.kind === "rpc")).toHaveLength(1);
    expect(ids(result.current.assigneeOptions)).toEqual([PEER, LEADER, REPORT]);
  });

  it("Team Leader under View As: the RPC is withheld and only the current assignee is offered", async () => {
    const { result } = renderHook(() => useContactAssigneeOptions(
      props({ viewer: asViewer(LEADER, "Team Leader", { isImpersonating: true }), selfId: LEADER })));
    await releaseAll();
    expect(h.reads.some((r) => r.kind === "rpc")).toBe(false);
    expect(ids(result.current.assigneeOptions)).toEqual([PEER]);
  });

  it("Agent: only themselves plus the current assignee; the viewer's own row is never looked up", async () => {
    const { result } = renderHook(() => useContactAssigneeOptions(
      props({ viewer: asViewer(REPORT, "Agent"), selfId: REPORT, currentAssigneeId: REPORT })));
    await releaseAll();
    expect(h.reads.some((r) => r.kind === "assignee")).toBe(false);
    expect(ids(result.current.assigneeOptions)).toEqual([REPORT]);
  });

  it("no effective viewer: no options, while the assignee name lookup still runs", async () => {
    const { result } = renderHook(() =>
      useContactAssigneeOptions(props({ viewer: null, organizationId: null })));
    await releaseAll();
    expect(h.reads.map((r) => r.kind)).toEqual(["assignee"]);
    expect(result.current.assigneeOptions).toEqual([]);
    expect(result.current.rosterLoaded).toBe(true);
  });

  it("no contact: no reads at all", async () => {
    const { result } = renderHook(() => useContactAssigneeOptions(props({ contactId: null })));
    await releaseAll();
    expect(h.reads).toEqual([]);
    expect(result.current.rosterLoaded).toBe(false);
  });
});

describe("useContactAssigneeOptions — stale responses", () => {
  it("a load that lands after the contact changed is ignored; only the new contact's load counts", async () => {
    const { result, rerender } = renderHook((p: Props) => useContactAssigneeOptions(p), { initialProps: props() });
    await flush();
    const first = h.reads.slice();
    rerender(props({ contactId: "lead-2", currentAssigneeId: INACTIVE }));
    await flush();
    const second = h.reads.slice(first.length);
    expect(first.map((r) => r.kind).sort()).toEqual(["assignee", "roster"]);
    expect(second.map((r) => r.kind).sort()).toEqual(["assignee", "roster"]);

    await releaseAll(first);
    expect(result.current.rosterLoaded).toBe(false);
    expect(result.current.agents).toEqual([]);

    await releaseAll(second);
    expect(result.current.rosterLoaded).toBe(true);
    expect(ids(result.current.agents)[0]).toBe(INACTIVE);
  });

  it("an older load landing after the newer one cannot overwrite it", async () => {
    const { result, rerender } = renderHook((p: Props) => useContactAssigneeOptions(p), { initialProps: props() });
    await flush();
    const first = h.reads.slice();
    rerender(props({ contactId: "lead-2", currentAssigneeId: INACTIVE }));
    await flush();
    const second = h.reads.slice(first.length);

    await releaseAll(second);
    expect(result.current.rosterLoaded).toBe(true);
    await releaseAll(first);
    expect(result.current.rosterLoaded).toBe(true);
    expect(ids(result.current.agents)[0]).toBe(INACTIVE);
  });

  it("within one scope, the next contact keeps the roster but is not 'loaded' until its own load lands", async () => {
    const { result, rerender } = renderHook((p: Props) => useContactAssigneeOptions(p), { initialProps: props() });
    await releaseAll();
    expect(result.current.rosterLoaded).toBe(true);

    rerender(props({ contactId: "lead-2" }));
    expect(result.current.rosterLoaded).toBe(false);
    expect(ids(result.current.agents)).toEqual([ADMIN, LEADER, REPORT, PEER]);
    await releaseAll();
    expect(result.current.rosterLoaded).toBe(true);
  });

  it("an organization switch drops the previous organization's lists on the same render", async () => {
    const { result, rerender } = renderHook((p: Props) => useContactAssigneeOptions(p), { initialProps: props() });
    await releaseAll();
    expect(result.current.agents.length).toBeGreaterThan(0);

    h.profiles = [person(FOREIGN, "Zed", "Active", OTHER_ORG)];
    rerender(props({ organizationId: OTHER_ORG, viewer: asViewer(ADMIN, "Admin", { organizationId: OTHER_ORG }) }));
    expect(result.current.agents).toEqual([]);
    expect(result.current.rosterLoaded).toBe(false);
    expect(ids(result.current.assigneeOptions)).toEqual([PEER]); // the saved assignee only, no old roster

    await releaseAll();
    expect(ids(result.current.agents)).toEqual([FOREIGN]);
    expect(result.current.rosterLoaded).toBe(true);
  });

  it("a viewer switch (View As) drops a Team Leader's team before any new read lands", async () => {
    const tl = props({ viewer: asViewer(LEADER, "Team Leader"), selfId: LEADER });
    const { result, rerender } = renderHook((p: Props) => useContactAssigneeOptions(p), { initialProps: tl });
    await releaseAll();
    expect(ids(result.current.assigneeOptions)).toEqual([PEER, LEADER, REPORT]);

    rerender(props({ viewer: asViewer(REPORT, "Team Leader", { isImpersonating: true }), selfId: REPORT }));
    expect(ids(result.current.assigneeOptions)).toEqual([PEER]);
    await releaseAll();
    expect(ids(result.current.assigneeOptions)).toEqual([PEER]);
  });
});
