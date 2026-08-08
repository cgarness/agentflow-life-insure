import { describe, it, expect } from "vitest";

import {
  campaignTypesForStrategy,
  isCampaignCompatibleWithImport,
  participantIdsForImport,
  resolveCampaignOwnerId,
  type ImportAssignStrategy,
} from "@/lib/import-campaign-compatibility";

const ME = "11111111-1111-1111-1111-111111111111";
const AGENT_A = "22222222-2222-2222-2222-222222222222";
const AGENT_B = "33333333-3333-3333-3333-333333333333";

const personal = (ownerId: string) => ({ type: "Personal", user_id: ownerId, assigned_agent_ids: [ownerId] });
const team = (participants: string[]) => ({ type: "Team", user_id: ME, assigned_agent_ids: participants });
const openPool = () => ({ type: "Open Pool", user_id: ME, assigned_agent_ids: [] });

const ctx = (strategy: ImportAssignStrategy, agentIds: string[] = []) => ({
  strategy,
  currentUserId: ME,
  agentIds,
});

describe("campaignTypesForStrategy — which NEW campaign types may be created", () => {
  it("offers all three types for a Myself import", () => {
    expect(campaignTypesForStrategy("myself")).toEqual(["Personal", "Team", "Open Pool"]);
  });

  it("offers all three types for a Specific Agent import", () => {
    expect(campaignTypesForStrategy("specific_agent")).toEqual(["Personal", "Team", "Open Pool"]);
  });

  it("does NOT offer Personal for a Round Robin import", () => {
    const types = campaignTypesForStrategy("round_robin");
    expect(types).not.toContain("Personal");
    expect(types).toEqual(["Team", "Open Pool"]);
  });

  it("does NOT offer Personal for an Unassigned import", () => {
    const types = campaignTypesForStrategy("unassigned");
    expect(types).not.toContain("Personal");
    expect(types).toEqual(["Team", "Open Pool"]);
  });
});

describe("isCampaignCompatibleWithImport — existing-campaign picker", () => {
  it("Specific Agent + Personal owned by the selected agent is compatible", () => {
    expect(isCampaignCompatibleWithImport(personal(AGENT_A), ctx("specific_agent", [AGENT_A]))).toBe(true);
  });

  it("Specific Agent + Personal owned by someone else is INCOMPATIBLE", () => {
    expect(isCampaignCompatibleWithImport(personal(AGENT_B), ctx("specific_agent", [AGENT_A]))).toBe(false);
    expect(isCampaignCompatibleWithImport(personal(ME), ctx("specific_agent", [AGENT_A]))).toBe(false);
  });

  it("Myself + own Personal is compatible; Myself + another's Personal is not", () => {
    expect(isCampaignCompatibleWithImport(personal(ME), ctx("myself"))).toBe(true);
    expect(isCampaignCompatibleWithImport(personal(AGENT_A), ctx("myself"))).toBe(false);
  });

  it("Round Robin + Personal is INCOMPATIBLE regardless of owner", () => {
    expect(isCampaignCompatibleWithImport(personal(AGENT_A), ctx("round_robin", [AGENT_A, AGENT_B]))).toBe(false);
    expect(isCampaignCompatibleWithImport(personal(ME), ctx("round_robin", [ME, AGENT_A]))).toBe(false);
  });

  it("Unassigned + Personal is INCOMPATIBLE", () => {
    expect(isCampaignCompatibleWithImport(personal(ME), ctx("unassigned"))).toBe(false);
  });

  it("Specific Agent + Team requires the selected agent to be a participant", () => {
    expect(isCampaignCompatibleWithImport(team([AGENT_A, AGENT_B]), ctx("specific_agent", [AGENT_A]))).toBe(true);
    expect(isCampaignCompatibleWithImport(team([AGENT_B]), ctx("specific_agent", [AGENT_A]))).toBe(false);
  });

  it("Round Robin + Team requires EVERY selected agent to be a participant", () => {
    expect(isCampaignCompatibleWithImport(team([AGENT_A, AGENT_B]), ctx("round_robin", [AGENT_A, AGENT_B]))).toBe(true);
    expect(isCampaignCompatibleWithImport(team([AGENT_A]), ctx("round_robin", [AGENT_A, AGENT_B]))).toBe(false);
  });

  it("Unassigned + Team remains allowed", () => {
    expect(isCampaignCompatibleWithImport(team([ME]), ctx("unassigned"))).toBe(true);
    expect(isCampaignCompatibleWithImport(team([]), ctx("unassigned"))).toBe(true);
  });

  it("Open Pool is compatible with every strategy (same-org import)", () => {
    (["myself", "specific_agent", "round_robin", "unassigned"] as ImportAssignStrategy[]).forEach((s) => {
      expect(isCampaignCompatibleWithImport(openPool(), ctx(s, [AGENT_A, AGENT_B]))).toBe(true);
    });
  });

  it("tolerates a JSON-string assigned_agent_ids payload", () => {
    const c = { type: "Team", user_id: ME, assigned_agent_ids: JSON.stringify([AGENT_A]) };
    expect(isCampaignCompatibleWithImport(c, ctx("specific_agent", [AGENT_A]))).toBe(true);
  });

  it("normalizes campaign type casing/whitespace", () => {
    expect(isCampaignCompatibleWithImport({ ...personal(AGENT_A), type: " personal " }, ctx("specific_agent", [AGENT_A]))).toBe(true);
    expect(isCampaignCompatibleWithImport({ ...openPool(), type: "open pool" }, ctx("round_robin", [AGENT_A]))).toBe(true);
  });
});

describe("resolveCampaignOwnerId — new-campaign ownership matrix", () => {
  it("Personal + Specific Agent is owned by the SELECTED AGENT, not the importer", () => {
    expect(resolveCampaignOwnerId("Personal", ctx("specific_agent", [AGENT_A]))).toBe(AGENT_A);
  });

  it("Personal + Myself is owned by the caller", () => {
    expect(resolveCampaignOwnerId("Personal", ctx("myself"))).toBe(ME);
  });

  it("Team and Open Pool preserve existing owner semantics (the creator)", () => {
    expect(resolveCampaignOwnerId("Team", ctx("specific_agent", [AGENT_A]))).toBe(ME);
    expect(resolveCampaignOwnerId("Team", ctx("round_robin", [AGENT_A, AGENT_B]))).toBe(ME);
    expect(resolveCampaignOwnerId("Open Pool", ctx("specific_agent", [AGENT_A]))).toBe(ME);
  });

  it("returns null for the rejected Personal combinations", () => {
    expect(resolveCampaignOwnerId("Personal", ctx("round_robin", [AGENT_A]))).toBeNull();
    expect(resolveCampaignOwnerId("Personal", ctx("unassigned"))).toBeNull();
  });
});

describe("participantIdsForImport — assigned_agent_ids propagation", () => {
  it("Specific Agent propagates exactly the selected agent", () => {
    expect(participantIdsForImport("Team", ctx("specific_agent", [AGENT_A]))).toEqual([AGENT_A]);
    expect(participantIdsForImport("Personal", ctx("specific_agent", [AGENT_A]))).toEqual([AGENT_A]);
  });

  it("Round Robin propagates the UNIQUE selected agents", () => {
    expect(participantIdsForImport("Team", ctx("round_robin", [AGENT_A, AGENT_B, AGENT_A]))).toEqual([AGENT_A, AGENT_B]);
  });

  it("Myself propagates the authenticated user", () => {
    expect(participantIdsForImport("Team", ctx("myself"))).toEqual([ME]);
    expect(participantIdsForImport("Personal", ctx("myself"))).toEqual([ME]);
  });

  it("Unassigned + Team falls back to the caller (D-3) so the campaign is not orphaned", () => {
    expect(participantIdsForImport("Team", ctx("unassigned"))).toEqual([ME]);
  });

  it("Open Pool takes no participants (org-wide by type)", () => {
    expect(participantIdsForImport("Open Pool", ctx("round_robin", [AGENT_A, AGENT_B]))).toEqual([]);
    expect(participantIdsForImport("Open Pool", ctx("myself"))).toEqual([]);
  });
});
