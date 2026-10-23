/**
 * F10 — `resolveAssignableAgents`: who a viewer may pick as a contact's assigned agent.
 *
 * Extracted from `Contacts.tsx` (Add Lead / bulk assign) so the full-screen contact view
 * applies the same rule: Admin or effective super admin → organization roster; Team Leader
 * → self + recursive downline; Agent → self (or nobody, Contacts' Add Lead form); no viewer
 * → nobody; the contact's current assignee is always kept. A UX narrowing — the server
 * (`private.assert_may_assign_to`, RLS) remains the authority.
 *
 * All ids are synthetic. No production identifier appears in this file.
 */
import { describe, expect, it } from "vitest";
import { resolveAssignableAgents, type AssignableAgent } from "@/lib/contacts/resolveAssignableAgents";

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const a = (n: number, first = `F${n}`): AssignableAgent => ({ id: uid(n), firstName: first, lastName: "Test" });

const ADMIN = a(1);
const TL = a(2);
const DOWNLINE = a(3);
const GRANDCHILD = a(4);
const PEER_AGENT = a(5);
const VIEWER_AGENT = a(6);

const ORG_ROSTER = [ADMIN, TL, DOWNLINE, GRANDCHILD, PEER_AGENT, VIEWER_AGENT];
const TEAM = [TL, DOWNLINE, GRANDCHILD];

const base = { orgAgents: ORG_ROSTER, teamAgents: TEAM, isSuperAdmin: false };

describe("by role — the Contacts.tsx rule", () => {
  it("an Admin gets the organization roster", () => {
    expect(resolveAssignableAgents({ ...base, role: "Admin", viewerId: ADMIN.id })).toEqual(ORG_ROSTER);
  });

  it("an effective super admin gets the organization roster whatever the role string", () => {
    expect(resolveAssignableAgents({ ...base, role: "Agent", viewerId: ADMIN.id, isSuperAdmin: true })).toEqual(ORG_ROSTER);
  });

  it("a Team Leader gets self + recursive downline — never peers or the org roster", () => {
    const list = resolveAssignableAgents({ ...base, role: "Team Leader", viewerId: TL.id });
    expect(list).toEqual(TEAM);
    expect(list).not.toContainEqual(PEER_AGENT);
    expect(list).not.toContainEqual(ADMIN);
  });

  it("a super-admin Team Leader keeps the team list (the Team Leader branch is checked first, as in Contacts)", () => {
    expect(resolveAssignableAgents({ ...base, role: "Team Leader", viewerId: TL.id, isSuperAdmin: true })).toEqual(TEAM);
  });

  it("an Agent gets only themselves by default", () => {
    expect(resolveAssignableAgents({ ...base, role: "Agent", viewerId: VIEWER_AGENT.id })).toEqual([VIEWER_AGENT]);
  });

  it("an Agent gets nobody with agentSelf \"none\" (Contacts Add Lead / bulk assign)", () => {
    expect(resolveAssignableAgents({ ...base, role: "Agent", viewerId: VIEWER_AGENT.id, agentSelf: "none" })).toEqual([]);
  });

  it("a \"Super Admin\" role string without the flag does not widen (mirrors the server)", () => {
    expect(resolveAssignableAgents({ ...base, role: "Super Admin", viewerId: ADMIN.id })).toEqual([ADMIN]);
  });

  it("an Agent missing from both rosters gets nobody", () => {
    expect(resolveAssignableAgents({ ...base, role: "Agent", viewerId: uid(99) })).toEqual([]);
  });

  it("no viewer gets nobody, even an Admin role", () => {
    expect(resolveAssignableAgents({ ...base, role: "Admin", viewerId: null })).toEqual([]);
    expect(resolveAssignableAgents({ ...base, role: "Admin", viewerId: "  ", currentAssigneeId: PEER_AGENT.id })).toEqual([]);
  });

  it("an empty team yields an empty Team Leader list (fail narrow, no org fallback)", () => {
    expect(resolveAssignableAgents({ ...base, teamAgents: [], role: "Team Leader", viewerId: TL.id })).toEqual([]);
  });
});

describe("the current assignee is always kept", () => {
  it("a Team Leader editing a contact owned outside the team still sees that owner, first", () => {
    const list = resolveAssignableAgents({ ...base, role: "Team Leader", viewerId: TL.id, currentAssigneeId: PEER_AGENT.id });
    expect(list).toEqual([PEER_AGENT, ...TEAM]);
  });

  it("an Agent editing a contact assigned to someone else keeps that assignee", () => {
    const list = resolveAssignableAgents({ ...base, role: "Agent", viewerId: VIEWER_AGENT.id, currentAssigneeId: TL.id });
    expect(list).toEqual([TL, VIEWER_AGENT]);
  });

  it("an assignee already in the list is not duplicated", () => {
    expect(resolveAssignableAgents({ ...base, role: "Team Leader", viewerId: TL.id, currentAssigneeId: DOWNLINE.id })).toEqual(TEAM);
  });

  it("an assignee missing from every roster is kept by id with an empty name", () => {
    const list = resolveAssignableAgents({ ...base, role: "Team Leader", viewerId: TL.id, currentAssigneeId: uid(77) });
    expect(list[0]).toEqual({ id: uid(77), firstName: "", lastName: "" });
    expect(list.slice(1)).toEqual(TEAM);
  });

  it("no or blank assignee adds nothing", () => {
    for (const currentAssigneeId of [null, undefined, "", "  "]) {
      expect(resolveAssignableAgents({ ...base, role: "Team Leader", viewerId: TL.id, currentAssigneeId })).toEqual(TEAM);
    }
  });
});

describe("hygiene", () => {
  it("dedupes by id and drops entries without an id", () => {
    const messy = [TL, TL, { id: "", firstName: "x", lastName: "y" }, DOWNLINE];
    expect(resolveAssignableAgents({ ...base, teamAgents: messy, role: "Team Leader", viewerId: TL.id })).toEqual([TL, DOWNLINE]);
  });

  it("never mutates its inputs", () => {
    const team = [...TEAM];
    resolveAssignableAgents({ ...base, teamAgents: team, role: "Team Leader", viewerId: TL.id, currentAssigneeId: PEER_AGENT.id });
    expect(team).toEqual(TEAM);
  });
});
