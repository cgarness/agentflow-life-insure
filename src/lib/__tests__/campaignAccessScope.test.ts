import { describe, it, expect } from "vitest";

import {
  canUserDialCampaign,
  canUserManageCampaign,
  filterCampaignsForDialing,
  filterCampaignsForManagement,
  filterCampaignsForAssignee,
  type CampaignLike,
} from "@/lib/campaign-assignee-scope";

const OWNER = "11111111-1111-1111-1111-111111111111";
const OTHER_AGENT = "22222222-2222-2222-2222-222222222222";
const ADMIN = "33333333-3333-3333-3333-333333333333";
const TEAM_LEADER = "44444444-4444-4444-4444-444444444444";

const personal: CampaignLike = { type: "Personal", user_id: OWNER, assigned_agent_ids: [OWNER] };
const team: CampaignLike = { type: "Team", user_id: ADMIN, assigned_agent_ids: [OWNER] };
const openPool: CampaignLike = { type: "Open Pool", user_id: ADMIN, assigned_agent_ids: [] };

const asAdmin = { isAdmin: true, isSuperAdmin: false, viewAll: true };
const asSuperAdmin = { isAdmin: false, isSuperAdmin: true, viewAll: true };
const asTeamLeader = { isAdmin: false, isSuperAdmin: false, viewAll: true };
const asAgent = { isAdmin: false, isSuperAdmin: false, viewAll: false };

describe("canUserManageCampaign — management scope", () => {
  it("lets a same-org Admin manage an agent-owned Personal campaign", () => {
    expect(canUserManageCampaign(personal, ADMIN, asAdmin)).toBe(true);
  });

  it("lets a same-org Super Admin manage an agent-owned Personal campaign", () => {
    expect(canUserManageCampaign(personal, ADMIN, asSuperAdmin)).toBe(true);
  });

  it("does NOT let a Team Leader manage another agent's Personal campaign", () => {
    expect(canUserManageCampaign(personal, TEAM_LEADER, asTeamLeader)).toBe(false);
  });

  it("does NOT let another Agent manage someone else's Personal campaign", () => {
    expect(canUserManageCampaign(personal, OTHER_AGENT, asAgent)).toBe(false);
  });

  it("lets the owner manage their own Personal campaign", () => {
    expect(canUserManageCampaign(personal, OWNER, asAgent)).toBe(true);
  });

  it("keeps existing Team and Open Pool management behaviour", () => {
    expect(canUserManageCampaign(team, OWNER, asAgent)).toBe(true); // participant
    expect(canUserManageCampaign(team, OTHER_AGENT, asAgent)).toBe(false); // non-participant Agent
    expect(canUserManageCampaign(team, TEAM_LEADER, asTeamLeader)).toBe(true); // viewAll widens Team
    expect(canUserManageCampaign(openPool, OTHER_AGENT, asAgent)).toBe(true); // org-wide
  });
});

describe("canUserDialCampaign — dialer scope", () => {
  it("lets ONLY the owner dial a Personal campaign", () => {
    expect(canUserDialCampaign(personal, OWNER)).toBe(true);
  });

  it("does NOT let an Admin dial another agent's Personal campaign", () => {
    expect(canUserDialCampaign(personal, ADMIN)).toBe(false);
  });

  it("does NOT let a Super Admin dial another agent's Personal campaign", () => {
    expect(canUserDialCampaign(personal, ADMIN)).toBe(false);
    // No options argument exists on the dial helper at all — viewAll cannot widen it.
    expect(canUserDialCampaign.length).toBe(2);
  });

  it("does NOT let a Team Leader dial another agent's Personal campaign", () => {
    expect(canUserDialCampaign(personal, TEAM_LEADER)).toBe(false);
  });

  it("does NOT let another Agent dial someone else's Personal campaign", () => {
    expect(canUserDialCampaign(personal, OTHER_AGENT)).toBe(false);
  });

  it("keeps Team participant access unchanged", () => {
    expect(canUserDialCampaign(team, OWNER)).toBe(true);
    expect(canUserDialCampaign(team, OTHER_AGENT)).toBe(false);
    expect(canUserDialCampaign(team, ADMIN)).toBe(false);
  });

  it("keeps Open Pool access unchanged (org-wide)", () => {
    expect(canUserDialCampaign(openPool, OWNER)).toBe(true);
    expect(canUserDialCampaign(openPool, OTHER_AGENT)).toBe(true);
    expect(canUserDialCampaign(openPool, ADMIN)).toBe(true);
  });

  it("tolerates a JSON-string assigned_agent_ids payload", () => {
    const t: CampaignLike = { type: "Team", user_id: ADMIN, assigned_agent_ids: JSON.stringify([OWNER]) };
    expect(canUserDialCampaign(t, OWNER)).toBe(true);
    expect(canUserDialCampaign(t, OTHER_AGENT)).toBe(false);
  });

  it("normalizes type casing and whitespace", () => {
    expect(canUserDialCampaign({ ...personal, type: " personal " }, OWNER)).toBe(true);
    expect(canUserDialCampaign({ ...personal, type: "PERSONAL" }, ADMIN)).toBe(false);
    expect(canUserDialCampaign({ ...openPool, type: "Open" }, OTHER_AGENT)).toBe(true);
  });
});

describe("filters", () => {
  const all = [personal, team, openPool];

  it("management filter surfaces the agent-owned Personal campaign to an Admin", () => {
    expect(filterCampaignsForManagement(all, ADMIN, asAdmin)).toEqual(all);
  });

  it("dialing filter hides the agent-owned Personal campaign from an Admin", () => {
    expect(filterCampaignsForDialing(all, ADMIN)).toEqual([team, openPool].filter((c) => canUserDialCampaign(c, ADMIN)));
    expect(filterCampaignsForDialing(all, ADMIN)).not.toContain(personal);
  });

  it("dialing filter keeps the owner's own Personal campaign", () => {
    expect(filterCampaignsForDialing(all, OWNER)).toContain(personal);
  });

  it("preserves the existing attachment-eligibility helper unchanged", () => {
    // filterCampaignsForAssignee is the manual Add-Lead picker rule; it must keep its
    // pre-existing owner-only-Personal semantics.
    expect(filterCampaignsForAssignee([personal], OWNER)).toHaveLength(1);
    expect(filterCampaignsForAssignee([personal], OTHER_AGENT)).toHaveLength(0);
    expect(filterCampaignsForAssignee([team], OWNER)).toHaveLength(1);
    expect(filterCampaignsForAssignee([openPool], OTHER_AGENT)).toHaveLength(1);
  });
});
