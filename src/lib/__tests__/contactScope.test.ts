import { describe, it, expect } from "vitest";
import { computeAvailableScopes } from "@/hooks/useContactScope";
import { resolveOwnerAgentIds, scopeLabel } from "@/lib/contactsFilters";

describe("computeAvailableScopes — permission + downline gating", () => {
  it("own-only permission exposes only My Contacts (regardless of downline)", () => {
    expect(computeAvailableScopes("own", false)).toEqual(["mine"]);
    expect(computeAvailableScopes("own", true)).toEqual(["mine"]);
  });

  it("team permission exposes My + Team only when a downline exists", () => {
    expect(computeAvailableScopes("team", true)).toEqual(["mine", "team"]);
    expect(computeAvailableScopes("team", false)).toEqual(["mine"]);
  });

  it("all permission exposes My + Agency, plus Team when downline exists", () => {
    expect(computeAvailableScopes("all", true)).toEqual(["mine", "team", "agency"]);
    expect(computeAvailableScopes("all", false)).toEqual(["mine", "agency"]);
  });

  it("never offers Agency below 'all' (no widening past getDataScope)", () => {
    expect(computeAvailableScopes("team", true)).not.toContain("agency");
    expect(computeAvailableScopes("own", true)).not.toContain("agency");
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
  });
});
