/**
 * Pure helpers behind the campaign-selection table. Fail-first: this module does not exist
 * until the redesign ships, so this file fails to collect against the pre-change tree.
 * All time math uses an injectable nowMs and locally-constructed dates (TZ-agnostic).
 */
import { describe, it, expect } from "vitest";
import {
  sortCampaignsOldestFirst,
  totalContacts,
  campaignTypeLabel,
  formatLastDialedRelative,
  resolveLastDialedIso,
  presenceCellState,
  headerPresence,
  assignedCellModel,
  collectAssigneeIds,
  maxAttemptsLabel,
  ringTimeoutLabel,
  retryIntervalLabel,
  formatCallingWindow,
} from "@/components/dialer/campaignSelectionModel";

const NOW = new Date(2026, 7, 20, 12, 0, 0).getTime();

describe("formatLastDialedRelative", () => {
  it("returns Never for a missing or null timestamp", () => {
    expect(formatLastDialedRelative(null, NOW)).toBe("Never");
    expect(formatLastDialedRelative(undefined, NOW)).toBe("Never");
  });

  it("returns Just now under a minute", () => {
    expect(formatLastDialedRelative(new Date(NOW - 30_000).toISOString(), NOW)).toBe("Just now");
  });

  it("returns minutes under an hour", () => {
    expect(formatLastDialedRelative(new Date(NOW - 12 * 60_000).toISOString(), NOW)).toBe("12 min ago");
  });

  it("returns hours for the same local day", () => {
    const threeHoursAgo = new Date(2026, 7, 20, 9, 0, 0).toISOString();
    expect(formatLastDialedRelative(threeHoursAgo, NOW)).toBe("3 hr ago");
  });

  it("returns Yesterday for the previous local day", () => {
    const yesterdayEvening = new Date(2026, 7, 19, 20, 0, 0).toISOString();
    expect(formatLastDialedRelative(yesterdayEvening, NOW)).toBe("Yesterday");
  });

  it("prefers recency over the calendar right after midnight", () => {
    const now = new Date(2026, 7, 20, 0, 5, 0).getTime();
    const lastNight = new Date(2026, 7, 19, 23, 58, 0).toISOString();
    expect(formatLastDialedRelative(lastNight, now)).toBe("7 min ago");
  });

  it("falls back to the existing absolute date for anything older", () => {
    const older = new Date(2026, 7, 10, 9, 0, 0).toISOString();
    expect(formatLastDialedRelative(older, NOW)).toBe("Aug 10, 2026");
  });

  it("treats an invalid timestamp as Never rather than rendering garbage", () => {
    expect(formatLastDialedRelative("not-a-date", NOW)).toBe("Never");
  });
});

describe("resolveLastDialedIso (RPC-map contract preserved)", () => {
  it("null when the campaign has no entry (renders Never)", () => {
    expect(resolveLastDialedIso("c1", {})).toBeNull();
  });
  it("null when the entry itself is null", () => {
    expect(resolveLastDialedIso("c1", { c1: null })).toBeNull();
  });
  it("passes a real timestamp through", () => {
    expect(resolveLastDialedIso("c1", { c1: "2026-08-20T10:00:00Z" })).toBe("2026-08-20T10:00:00Z");
  });
});

describe("presenceCellState", () => {
  const presence = {
    a: { activeAgentCount: 2, activeAgents: [] },
    b: { activeAgentCount: 0, activeAgents: [] },
  };

  it("is unavailable when the whole presence map is missing", () => {
    expect(presenceCellState(undefined, "a")).toEqual({ kind: "unavailable" });
  });

  it("is unavailable for a campaign absent from the response (never a false zero)", () => {
    expect(presenceCellState(presence, "missing")).toEqual({ kind: "unavailable" });
  });

  it("is zero only for an authoritative zero", () => {
    expect(presenceCellState(presence, "b")).toEqual({ kind: "zero" });
  });

  it("is active with the count", () => {
    expect(presenceCellState(presence, "a")).toEqual({ kind: "active", count: 2 });
  });
});

describe("headerPresence (derived from the same response)", () => {
  it("sums counts across visible campaigns", () => {
    const presence = {
      a: { activeAgentCount: 2, activeAgents: [] },
      b: { activeAgentCount: 1, activeAgents: [] },
    };
    expect(headerPresence(presence, ["a", "b"])).toEqual({ kind: "active", count: 3 });
  });

  it("only counts campaigns actually visible", () => {
    const presence = {
      a: { activeAgentCount: 2, activeAgents: [] },
      hidden: { activeAgentCount: 5, activeAgents: [] },
    };
    expect(headerPresence(presence, ["a"])).toEqual({ kind: "active", count: 2 });
  });

  it("is zero when every visible campaign is authoritatively zero", () => {
    const presence = { a: { activeAgentCount: 0, activeAgents: [] } };
    expect(headerPresence(presence, ["a"])).toEqual({ kind: "zero" });
  });

  it("is unavailable when presence is missing", () => {
    expect(headerPresence(undefined, ["a"])).toEqual({ kind: "unavailable" });
  });
});

describe("assignedCellModel", () => {
  const profiles = {
    "u-1": { id: "u-1", displayName: "Alice One", avatarUrl: null },
    "u-2": { id: "u-2", displayName: "Bob Two", avatarUrl: null },
  };

  it("Open Pool campaigns are open to the agency", () => {
    expect(assignedCellModel({ type: "Open Pool" }, profiles)).toEqual({ kind: "open" });
  });

  it("Personal campaigns resolve the owner", () => {
    const model = assignedCellModel({ type: "Personal", user_id: "u-1" }, profiles);
    expect(model.kind).toBe("personal");
    if (model.kind === "personal") expect(model.owner?.displayName).toBe("Alice One");
  });

  it("Team campaigns resolve assigned profiles from assigned_agent_ids", () => {
    const model = assignedCellModel(
      { type: "Team", assigned_agent_ids: ["u-1", "u-2", "u-unknown"] },
      profiles,
    );
    expect(model.kind).toBe("team");
    if (model.kind === "team") {
      expect(model.people.map((p) => p.id)).toEqual(["u-1", "u-2", "u-unknown"]);
      expect(model.people[0].displayName).toBe("Alice One");
      expect(model.people[2].displayName).toBeNull();
    }
  });

  it("tolerates assigned_agent_ids delivered as a JSON string (cache shape)", () => {
    const model = assignedCellModel(
      { type: "Team", assigned_agent_ids: '["u-1"]' as unknown as string[] },
      profiles,
    );
    expect(model.kind).toBe("team");
    if (model.kind === "team") expect(model.people.map((p) => p.id)).toEqual(["u-1"]);
  });
});

describe("small formatters", () => {
  it("campaignTypeLabel normalizes the three canonical types", () => {
    expect(campaignTypeLabel("Open Pool")).toBe("Open Pool");
    expect(campaignTypeLabel("OPEN")).toBe("Open Pool");
    expect(campaignTypeLabel("Team")).toBe("Team");
    expect(campaignTypeLabel("personal")).toBe("Personal");
  });

  it("maxAttemptsLabel: null means Unlimited", () => {
    expect(maxAttemptsLabel(null)).toBe("Unlimited");
    expect(maxAttemptsLabel(undefined)).toBe("Unlimited");
    expect(maxAttemptsLabel(3)).toBe("3");
  });

  it("ringTimeoutLabel: null means the org default applies", () => {
    expect(ringTimeoutLabel(null)).toBe("Org default");
    expect(ringTimeoutLabel(25)).toBe("25s");
  });

  it("retryIntervalLabel honors the canonical minutes field with the house fallbacks", () => {
    expect(retryIntervalLabel({ retry_interval_minutes: 90 })).toBe("90 min");
    expect(retryIntervalLabel({ retry_interval_minutes: 120 })).toBe("2 hr");
    expect(retryIntervalLabel({ retry_interval_minutes: 1440 })).toBe("1 day");
    expect(retryIntervalLabel({ retry_interval_hours: 2 })).toBe("2 hr");
    expect(retryIntervalLabel({})).toBe("1 day");
  });

  it("formatCallingWindow renders a readable range", () => {
    expect(formatCallingWindow("08:00:00", "21:00:00")).toBe("8:00 AM – 9:00 PM");
    expect(formatCallingWindow(null, null)).toBe("—");
  });

  it("totalContacts sums the state buckets", () => {
    expect(totalContacts([{ state: "TX", count: 3 }, { state: "CA", count: 2 }])).toBe(5);
    expect(totalContacts(undefined)).toBe(0);
  });

  it("sortCampaignsOldestFirst keeps the existing ordering", () => {
    const sorted = sortCampaignsOldestFirst([
      { id: "b", created_at: "2026-02-01T00:00:00Z" },
      { id: "a", created_at: "2026-01-01T00:00:00Z" },
      { id: "c", created_at: null },
    ]);
    expect(sorted.map((c) => c.id)).toEqual(["c", "a", "b"]);
  });

  it("collectAssigneeIds unions owners and assigned ids, unique and sorted", () => {
    expect(
      collectAssigneeIds([
        { type: "Personal", user_id: "u-2", assigned_agent_ids: [] },
        { type: "Team", user_id: "u-9", assigned_agent_ids: ["u-1", "u-2"] },
        { type: "Open Pool", user_id: null, assigned_agent_ids: [] },
      ]),
    ).toEqual(["u-1", "u-2"]);
  });
});
