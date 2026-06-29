import { describe, it, expect } from "vitest";
import { hasAssignableAgentOtherThanSelf } from "@/components/contacts/AddLeadAssignmentSection";

// Add Lead "Assign To" gate: the section is hidden unless the viewer is role-eligible
// AND has at least one assignable agent other than themselves. This predicate is the
// "other than themselves" half (role eligibility is canPickOtherAgents). When hidden,
// the save path leaves assignMode = "myself" so the lead is always assigned to self —
// manual Add Lead never creates an unassigned lead.
describe("hasAssignableAgentOtherThanSelf — Add Lead assignment gate", () => {
  const self = "00000000-0000-0000-0000-00000000self";
  const a = (id: string) => ({ id });

  it("false when the only assignable agent is the viewer (Team Leader with no downline)", () => {
    expect(hasAssignableAgentOtherThanSelf([a(self)], self)).toBe(false);
  });

  it("false when there are no assignable agents at all (Admin alone in the org)", () => {
    expect(hasAssignableAgentOtherThanSelf([], self)).toBe(false);
  });

  it("true when at least one assignable agent is not the viewer (Team Leader with downline)", () => {
    expect(hasAssignableAgentOtherThanSelf([a(self), a("agent-1")], self)).toBe(true);
  });

  it("true for an Admin whose org has other active agents", () => {
    expect(hasAssignableAgentOtherThanSelf([a("admin"), a("x"), a("y")], "admin")).toBe(true);
  });

  it("treats a missing currentUserId as no self-match (any agent counts as other)", () => {
    expect(hasAssignableAgentOtherThanSelf([a("agent-1")], null)).toBe(true);
    expect(hasAssignableAgentOtherThanSelf([], undefined)).toBe(false);
  });
});
