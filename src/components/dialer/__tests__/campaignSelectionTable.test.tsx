/**
 * Campaign-selection TABLE redesign — structure, columns, roles, presence states, copy.
 * Fail-first: written against the card-based CampaignSelection; every structural test here
 * is red until the approved balanced expandable table ships (implementation_plan.md,
 * approved 2026-08-20 with amendments).
 */
import React from "react";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import CampaignSelection from "@/components/dialer/CampaignSelection";

const NOW = new Date(2026, 7, 20, 12, 0, 0).getTime();

const ORG_CAMPAIGNS = [
  {
    id: "c-open",
    name: "Open Camp",
    type: "Open Pool",
    status: "Active",
    description: "",
    user_id: "u-admin",
    assigned_agent_ids: [],
    created_at: "2026-01-05T10:00:00Z",
    max_attempts: null,
    calling_hours_start: "08:00:00",
    calling_hours_end: "21:00:00",
    retry_interval_minutes: 1440,
    ring_timeout_seconds: 25,
  },
  {
    id: "c-team",
    name: "Team Camp",
    type: "Team",
    status: "Active",
    description: "Warm transfers only",
    user_id: "u-admin",
    assigned_agent_ids: ["u-1", "u-2", "u-3"],
    created_at: "2026-02-05T10:00:00Z",
    max_attempts: 3,
    calling_hours_start: "09:00:00",
    calling_hours_end: "18:00:00",
    retry_interval_minutes: 90,
    ring_timeout_seconds: null,
  },
  {
    id: "c-personal",
    name: "My Personal",
    type: "Personal",
    status: "Active",
    description: "",
    user_id: "u-1",
    assigned_agent_ids: [],
    created_at: "2026-03-05T10:00:00Z",
    max_attempts: null,
    calling_hours_start: "08:00:00",
    calling_hours_end: "21:00:00",
    retry_interval_minutes: 1440,
    ring_timeout_seconds: null,
  },
];

const STATE_STATS = {
  "c-open": [
    { state: "TX", count: 3 },
    { state: "CA", count: 2 },
  ],
  "c-team": [],
  "c-personal": [{ state: "NV", count: 1 }],
};

const PRESENCE = {
  "c-open": {
    activeAgentCount: 3,
    activeAgents: [
      { agentId: "u-1", displayName: "Alice One", avatarUrl: null, lastHeartbeatAt: new Date(NOW - 10_000).toISOString() },
      { agentId: "u-2", displayName: "Bob Two", avatarUrl: null, lastHeartbeatAt: new Date(NOW - 20_000).toISOString() },
      { agentId: "u-3", displayName: null, avatarUrl: null, lastHeartbeatAt: new Date(NOW - 30_000).toISOString() },
    ],
  },
  "c-team": { activeAgentCount: 0, activeAgents: [] },
  "c-personal": { activeAgentCount: 0, activeAgents: [] },
};

const ASSIGNEES = {
  "u-1": { id: "u-1", displayName: "Alice One", avatarUrl: null },
  "u-2": { id: "u-2", displayName: "Bob Two", avatarUrl: null },
  "u-3": { id: "u-3", displayName: "Cara Three", avatarUrl: null },
};

function renderSelection(overrides: Record<string, unknown> = {}) {
  const props = {
    campaigns: ORG_CAMPAIGNS,
    campaignsLoading: false,
    campaignStateStats: STATE_STATS,
    campaignLastDialed: {},
    campaignEditPermissions: undefined,
    campaignStatsLoading: false,
    campaignStatsError: false,
    onRetryStats: vi.fn(),
    onRefreshCampaigns: vi.fn(),
    onSelectCampaign: vi.fn(),
    onOpenSettings: vi.fn(),
    onPrefetchCampaign: vi.fn(),
    presence: PRESENCE,
    leadershipView: false,
    assigneeProfiles: ASSIGNEES,
    nowMs: NOW,
    ...overrides,
  };

  return render(<CampaignSelection {...(props as any)} />);
}

const rowFor = (id: string) => screen.getByTestId(`campaign-row-${id}`);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CampaignSelection — semantic table replaces cards", () => {
  it("renders a real table with the header copy", () => {
    renderSelection();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Select a Campaign")).toBeInTheDocument();
    expect(screen.getByText("Choose an active campaign to start dialing.")).toBeInTheDocument();
    // one row per campaign, campaign names present
    expect(rowFor("c-open")).toBeInTheDocument();
    expect(rowFor("c-team")).toBeInTheDocument();
    expect(rowFor("c-personal")).toBeInTheDocument();
  });

  it("renders exact campaign-type badges", () => {
    renderSelection();
    expect(within(rowFor("c-open")).getByText("Open Pool")).toBeInTheDocument();
    expect(within(rowFor("c-team")).getByText("Team")).toBeInTheDocument();
    expect(within(rowFor("c-personal")).getByText("Personal")).toBeInTheDocument();
  });

  it("keeps the truthful Contacts total from the existing state stats (not renamed Ready)", () => {
    renderSelection();
    expect(within(rowFor("c-open")).getByText("5")).toBeInTheDocument();
    expect(within(rowFor("c-personal")).getByText("1")).toBeInTheDocument();
    expect(screen.queryByText(/ready/i)).not.toBeInTheDocument();
  });

  it("orders rows oldest-first by created_at (existing ordering preserved)", () => {
    renderSelection();
    const rows = screen.getAllByTestId(/^campaign-row-/);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual([
      "campaign-row-c-open",
      "campaign-row-c-team",
      "campaign-row-c-personal",
    ]);
  });
});

describe("CampaignSelection — role-aware columns", () => {
  it("Agent role sees exactly Campaign / Contacts / Active Agents / Last Dialed / Action", () => {
    renderSelection({ leadershipView: false });
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent?.trim());
    expect(headers).toContain("Campaign");
    expect(headers).toContain("Contacts");
    expect(headers).toContain("Active Agents");
    expect(headers).toContain("Last Dialed");
    expect(headers).toContain("Action");
    expect(headers).not.toContain("Assigned");
  });

  it("leadership additionally sees the Assigned column", () => {
    renderSelection({ leadershipView: true });
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent?.trim());
    expect(headers).toContain("Assigned");
  });

  it("Agent role never renders active-agent identity names, even when fed identities", () => {
    renderSelection({ leadershipView: false });
    expect(screen.queryByText("Alice One")).not.toBeInTheDocument();
    expect(screen.queryByText("Bob Two")).not.toBeInTheDocument();
    // …including inside an expanded row
    fireEvent.click(rowFor("c-open"));
    expect(screen.queryByText("Alice One")).not.toBeInTheDocument();
  });

  it("leadership expanded rows render permitted assigned and active-agent details", () => {
    renderSelection({ leadershipView: true });
    fireEvent.click(rowFor("c-open"));
    const open = screen.getByTestId("campaign-details-c-open");
    expect(within(open).getByText("Alice One")).toBeInTheDocument();
    expect(within(open).getByText("Open to agency")).toBeInTheDocument();
    fireEvent.click(rowFor("c-team"));
    const team = screen.getByTestId("campaign-details-c-team");
    expect(within(team).getByText("Cara Three")).toBeInTheDocument();
    expect(within(team).getByText("No active agents")).toBeInTheDocument();
  });
});

describe("CampaignSelection — Active Agents cell states", () => {
  it("shows the active state when the authoritative count is positive", () => {
    renderSelection();
    expect(within(rowFor("c-open")).getByText("3 active")).toBeInTheDocument();
  });

  it("shows the authoritative zero as No active agents", () => {
    renderSelection();
    expect(within(rowFor("c-team")).getByText("No active agents")).toBeInTheDocument();
  });

  it("shows an em dash — never a fabricated zero — when presence is unavailable", () => {
    renderSelection({ presence: undefined });
    const cell = within(rowFor("c-open")).getByTestId("active-agents-cell");
    expect(cell).toHaveTextContent("—");
    expect(within(rowFor("c-open")).queryByText("No active agents")).not.toBeInTheDocument();
    expect(within(rowFor("c-open")).queryByText(/0 active/)).not.toBeInTheDocument();
  });

  it("shows an em dash for a campaign missing from the presence response", () => {
    renderSelection({ presence: { "c-open": PRESENCE["c-open"] } });
    expect(within(rowFor("c-team")).getByTestId("active-agents-cell")).toHaveTextContent("—");
    expect(within(rowFor("c-open")).getByText("3 active")).toBeInTheDocument();
  });
});

describe("CampaignSelection — header presence total (same response, no second query)", () => {
  it("sums the visible campaigns' counts", () => {
    renderSelection();
    expect(screen.getByTestId("presence-header")).toHaveTextContent("3 active agents");
  });

  it("uses singular copy for one agent", () => {
    renderSelection({
      presence: { ...PRESENCE, "c-open": { activeAgentCount: 1, activeAgents: [] } },
    });
    expect(screen.getByTestId("presence-header")).toHaveTextContent("1 active agent");
  });

  it("shows No active agents at an authoritative org-wide zero", () => {
    renderSelection({
      presence: {
        "c-open": { activeAgentCount: 0, activeAgents: [] },
        "c-team": { activeAgentCount: 0, activeAgents: [] },
        "c-personal": { activeAgentCount: 0, activeAgents: [] },
      },
    });
    expect(screen.getByTestId("presence-header")).toHaveTextContent("No active agents");
  });

  it("renders no total while presence is unavailable", () => {
    renderSelection({ presence: undefined });
    expect(screen.queryByTestId("presence-header")).not.toBeInTheDocument();
  });

  // Corrective pass (2026-08-20): a partial response hides the header — missing visible
  // campaigns must not be summed as zero.
  it("renders no total when any visible campaign is missing from the presence response", () => {
    renderSelection({ presence: { "c-open": PRESENCE["c-open"] } });
    expect(screen.queryByTestId("presence-header")).not.toBeInTheDocument();
  });
});

describe("CampaignSelection — Assigned column copy (leadership only)", () => {
  it("Open Pool shows Open to agency instead of a fabricated count", () => {
    renderSelection({ leadershipView: true });
    expect(within(rowFor("c-open")).getByText("Open to agency")).toBeInTheDocument();
  });

  it("Personal shows the owner", () => {
    renderSelection({ leadershipView: true });
    expect(within(rowFor("c-personal")).getByText("Alice One")).toBeInTheDocument();
  });

  it("Team shows a compact stack for assigned_agent_ids", () => {
    renderSelection({ leadershipView: true });
    const cell = within(rowFor("c-team")).getByTestId("assigned-cell");
    expect(within(cell).getAllByTestId("avatar-stack-item").length).toBeGreaterThan(0);
  });

  it("Agents get no Assigned cell at all", () => {
    renderSelection({ leadershipView: false });
    expect(screen.queryByTestId("assigned-cell")).not.toBeInTheDocument();
    expect(screen.queryByText("Open to agency")).not.toBeInTheDocument();
  });
});

describe("CampaignSelection — Last Dialed", () => {
  it("shows Never only when the campaign truly has no recorded call", () => {
    renderSelection({ campaignLastDialed: { "c-open": new Date(NOW - 12 * 60_000).toISOString() } });
    expect(within(rowFor("c-open")).getByText("12 min ago")).toBeInTheDocument();
    expect(within(rowFor("c-team")).getByText("Never")).toBeInTheDocument();
    expect(within(rowFor("c-personal")).getByText("Never")).toBeInTheDocument();
  });

  it("null entry still renders Never (RPC contract preserved)", () => {
    renderSelection({ campaignLastDialed: { "c-open": null } });
    expect(within(rowFor("c-open")).getByText("Never")).toBeInTheDocument();
  });

  it("exposes the exact timestamp to screen readers", () => {
    const iso = new Date(NOW - 12 * 60_000).toISOString();
    renderSelection({ campaignLastDialed: { "c-open": iso } });
    const sr = within(rowFor("c-open")).getByTestId("last-dialed-exact");
    expect(sr).toHaveClass("sr-only");
    expect(sr.textContent ?? "").not.toHaveLength(0);
  });
});

describe("CampaignSelection — loading, error, and empty states", () => {
  it("uses table-row skeletons while campaigns load", () => {
    renderSelection({ campaignsLoading: true });
    expect(screen.getAllByTestId("campaign-table-skeleton-row").length).toBeGreaterThan(0);
    expect(screen.queryAllByTestId(/^campaign-row-/)).toHaveLength(0);
  });

  it("keeps the truthful empty state", () => {
    renderSelection({ campaigns: [] });
    expect(screen.getByText("No active campaigns")).toBeInTheDocument();
  });

  it("keeps the lead-count error banner with Retry", () => {
    renderSelection({ campaignStatsError: true });
    expect(screen.getByText("Could not load lead counts.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("renders an em dash for contacts when stats errored before loading", () => {
    renderSelection({ campaignStatsError: true, campaignStateStats: {} });
    expect(within(rowFor("c-open")).getByTestId("contacts-cell")).toHaveTextContent("—");
  });
});
