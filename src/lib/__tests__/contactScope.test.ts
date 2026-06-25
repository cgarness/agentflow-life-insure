import { describe, it, expect } from "vitest";
import { computeAvailableScopes } from "@/hooks/useContactScope";
import { resolveOwnerAgentIds, scopeLabel } from "@/lib/contactsFilters";

describe("computeAvailableScopes — catalog-key + downline gating (Build 5)", () => {
  it("plain agent (no perms, no downline) → only My Contacts", () => {
    expect(computeAvailableScopes({ hasDownline: false, canViewUnassigned: false, canViewAll: false })).toEqual(["mine"]);
  });

  it("downline exposes Team (manager)", () => {
    expect(computeAvailableScopes({ hasDownline: true, canViewUnassigned: false, canViewAll: false })).toEqual(["mine", "team"]);
  });

  it("view_unassigned exposes the Unassigned (org pool) scope", () => {
    expect(computeAvailableScopes({ hasDownline: false, canViewUnassigned: true, canViewAll: false })).toEqual(["mine", "unassigned"]);
  });

  it("view_all exposes the Agency (all-org) scope", () => {
    expect(computeAvailableScopes({ hasDownline: false, canViewUnassigned: false, canViewAll: true })).toEqual(["mine", "agency"]);
  });

  it("full manager (downline + both keys, e.g. Admin) → mine, team, unassigned, agency in order", () => {
    expect(computeAvailableScopes({ hasDownline: true, canViewUnassigned: true, canViewAll: true })).toEqual(["mine", "team", "unassigned", "agency"]);
  });

  it("never offers unassigned/agency without the corresponding permission", () => {
    const scopes = computeAvailableScopes({ hasDownline: true, canViewUnassigned: false, canViewAll: false });
    expect(scopes).not.toContain("unassigned");
    expect(scopes).not.toContain("agency");
  });
});

describe("resolveOwnerAgentIds — Clients/Recruits owner resolution", () => {
  const teamAgentIds = ["me", "d1", "d2"];

  it("mine → only the current user", () => {
    expect(resolveOwnerAgentIds({ scope: "mine", userId: "me", teamAgentIds })).toEqual(["me"]);
  });

  it("team → self + recursive downline", () => {
    expect(resolveOwnerAgentIds({ scope: "team", userId: "me", teamAgentIds })).toEqual(["me", "d1", "d2"]);
  });

  it("agency → undefined (no owner filter; RLS scopes to org)", () => {
    expect(resolveOwnerAgentIds({ scope: "agency", userId: "me", teamAgentIds })).toBeUndefined();
  });

  it("unassigned → degrades to self for Clients/Recruits (Leads-only scope; never widens to all-org)", () => {
    expect(resolveOwnerAgentIds({ scope: "unassigned", userId: "me", teamAgentIds })).toEqual(["me"]);
  });

  it("an explicit agent selection overrides the scope default", () => {
    expect(
      resolveOwnerAgentIds({ scope: "team", userId: "me", teamAgentIds, explicitAgentIds: ["d1"] }),
    ).toEqual(["d1"]);
  });

  it("team with no downline falls back to self", () => {
    expect(resolveOwnerAgentIds({ scope: "team", userId: "me", teamAgentIds: [] })).toEqual(["me"]);
  });
});

describe("scopeLabel", () => {
  it("maps each scope to its user-facing label", () => {
    expect(scopeLabel("mine")).toBe("My Contacts");
    expect(scopeLabel("team")).toBe("Team Contacts");
    expect(scopeLabel("agency")).toBe("Agency Contacts");
    expect(scopeLabel("unassigned")).toBe("Unassigned Leads");
  });
});
