import { describe, it, expect } from "vitest";
import {
  addToCampaignSubmitSchema,
  attachErrorMessage,
  describeAttachResult,
  managementRoleFor,
  selectAddToCampaignOptions,
  type AddToCampaignRow,
} from "@/components/contacts/addToCampaignOptions";

const AGENT = "11111111-1111-1111-1111-111111111111";
const OTHER_AGENT = "22222222-2222-2222-2222-222222222222";
const ADMIN = "33333333-3333-3333-3333-333333333333";
const TEAM_LEADER = "44444444-4444-4444-4444-444444444444";

const row = (over: Partial<AddToCampaignRow> & Pick<AddToCampaignRow, "id" | "type">): AddToCampaignRow => ({
  name: over.id, status: "Active", user_id: ADMIN, assigned_agent_ids: [], total_leads: 3, ...over,
});

const ROWS: AddToCampaignRow[] = [
  row({ id: "personal-mine", type: "Personal", user_id: AGENT, assigned_agent_ids: [AGENT] }),
  row({ id: "personal-other", type: "Personal", user_id: OTHER_AGENT, assigned_agent_ids: [OTHER_AGENT] }),
  row({ id: "personal-tl", type: "Personal", user_id: TEAM_LEADER, assigned_agent_ids: [TEAM_LEADER] }),
  row({ id: "team-mine", type: "Team", assigned_agent_ids: [AGENT, OTHER_AGENT] }),
  row({ id: "team-other", type: "Team", assigned_agent_ids: [OTHER_AGENT] }),
  row({ id: "open-pool", type: "Open Pool" }),
];

const ids = (userId: string, role: string, isSuperAdmin = false, rows = ROWS) =>
  selectAddToCampaignOptions(rows, userId, managementRoleFor(role, isSuperAdmin)).map((o) => o.id);

describe("selectAddToCampaignOptions — scope on raw database rows", () => {
  it("shows an Agent their own Personal, their assigned Team and Open Pool campaigns", () => {
    expect(ids(AGENT, "Agent")).toEqual(["personal-mine", "team-mine", "open-pool"]);
  });

  it("never shows an Agent another user's Personal or a Team campaign they are not on", () => {
    const visible = ids(AGENT, "Agent");
    expect(visible).not.toContain("personal-other");
    expect(visible).not.toContain("personal-tl");
    expect(visible).not.toContain("team-other");
  });

  it("shows a Team Leader their own Personal and every Team campaign, but no other Personal", () => {
    expect(ids(TEAM_LEADER, "Team Leader")).toEqual(["personal-tl", "team-mine", "team-other", "open-pool"]);
  });

  it("keeps same-org Admin management of every campaign", () => {
    expect(ids(ADMIN, "Admin")).toEqual(ROWS.map((r) => r.id));
  });

  it("keeps Super Admin Personal management without widening Team for a non-leader role", () => {
    expect(ids(ADMIN, "Agent", true)).toEqual(["personal-mine", "personal-other", "personal-tl", "open-pool"]);
  });

  it("excludes Completed and Paused campaigns even if a read returns them", () => {
    const rows = [
      row({ id: "done", type: "Open Pool", status: "Completed" }),
      row({ id: "paused", type: "Personal", user_id: AGENT, status: "Paused" }),
      row({ id: "live", type: "Open Pool" }),
    ];
    expect(ids(AGENT, "Agent", false, rows)).toEqual(["live"]);
  });

  it("reads Team participants stored as a JSON string", () => {
    const rows = [row({ id: "team-json", type: "Team", assigned_agent_ids: JSON.stringify([AGENT]) })];
    expect(ids(AGENT, "Agent", false, rows)).toEqual(["team-json"]);
  });

  it("maps to the UI option only after scoping", () => {
    expect(selectAddToCampaignOptions([row({ id: "p", name: "Mine", type: "Personal", user_id: AGENT, total_leads: null })],
      AGENT, managementRoleFor("Agent", false))).toEqual([{ id: "p", name: "Mine", type: "Personal", totalLeads: 0 }]);
  });
});

describe("managementRoleFor", () => {
  it("matches the modal's existing management inputs", () => {
    expect(managementRoleFor("Admin", false)).toEqual({ isAdmin: true, isSuperAdmin: false, viewAll: true });
    expect(managementRoleFor("Team Leader", false)).toEqual({ isAdmin: false, isSuperAdmin: false, viewAll: true });
    expect(managementRoleFor("Agent", false)).toEqual({ isAdmin: false, isSuperAdmin: false, viewAll: false });
    expect(managementRoleFor(null, true)).toEqual({ isAdmin: false, isSuperAdmin: true, viewAll: false });
  });
});

describe("addToCampaignSubmitSchema", () => {
  it("requires a campaign first, then at least one lead", () => {
    const none = addToCampaignSubmitSchema.safeParse({ campaignId: "", leadIds: [] });
    expect(none.success).toBe(false);
    if (!none.success) expect(none.error.issues[0].message).toBe("Please select a campaign");
    const noLeads = addToCampaignSubmitSchema.safeParse({ campaignId: "c1", leadIds: [] });
    expect(noLeads.success).toBe(false);
    if (!noLeads.success) expect(noLeads.error.issues[0].message).toBe("No contacts selected");
    expect(addToCampaignSubmitSchema.safeParse({ campaignId: "c1", leadIds: ["l1"] }).success).toBe(true);
  });
});

describe("describeAttachResult", () => {
  it("reports a single existing member as already in the campaign, not ineligible", () => {
    expect(describeAttachResult({ added: 0, skipped: 1, alreadyPresent: 1 }, "Q4 Leads"))
      .toEqual({ kind: "info", message: "Already in Q4 Leads", duration: 4000 });
  });

  it("reports several existing members", () => {
    expect(describeAttachResult({ added: 0, skipped: 3, alreadyPresent: 3 }, "Q4").message)
      .toBe("All 3 leads are already in Q4");
  });

  it("splits a mixed no-add between existing and ineligible", () => {
    expect(describeAttachResult({ added: 0, skipped: 3, alreadyPresent: 1 }, "Q4"))
      .toEqual({ kind: "error", message: "No leads were added — 1 already in Q4, 2 not eligible.", duration: 5000 });
  });

  it("keeps the existing ineligible, partial and full-success messages", () => {
    expect(describeAttachResult({ added: 0, skipped: 2, alreadyPresent: 0 }, "Q4").message)
      .toBe("No leads were added — all 2 are not eligible for this campaign.");
    expect(describeAttachResult({ added: 4, skipped: 1, alreadyPresent: 0 }, "Q4").message).toBe("4 leads added to Q4, 1 skipped");
    expect(describeAttachResult({ added: 4, skipped: 3, alreadyPresent: 2 }, "Q4").message)
      .toBe("4 leads added to Q4, 2 already in campaign, 1 skipped");
    expect(describeAttachResult({ added: 4, skipped: 0, alreadyPresent: 0 }, "Q4"))
      .toEqual({ kind: "success", message: "4 leads added to Q4", duration: 3000 });
  });
});

describe("attachErrorMessage", () => {
  it("turns a server refusal into a permission message", () => {
    expect(attachErrorMessage({ code: "42501", message: "not authorized for campaign abc" }))
      .toBe("You don't have permission to add leads to this campaign.");
  });

  it("keeps the existing message for other failures", () => {
    expect(attachErrorMessage({ message: "boom" })).toBe("Failed to add contacts: boom");
    expect(attachErrorMessage(null)).toBe("Failed to add contacts: Unknown error");
  });
});
