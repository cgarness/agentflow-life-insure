/**
 * Campaign-selection table — expansion, Start Dialing, prefetch, and settings-gate behavior.
 * Fail-first against the card-based CampaignSelection. Invariants pinned here:
 *   - expanding a row NEVER invokes onSelectCampaign (no session side effect);
 *   - only the Start Dialing button starts campaign selection, exactly once;
 *   - hover/focus/pointerdown prefetch behavior is preserved;
 *   - the existing campaignEditPermissions gate + no-permission copy is preserved.
 */
import React from "react";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import CampaignSelection from "@/components/dialer/CampaignSelection";
import { CAMPAIGN_SETTINGS_COPY } from "@/components/dialer/campaignSettingsSchema";

const NOW = new Date(2026, 7, 20, 12, 0, 0).getTime();

const CAMPAIGNS = [
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
    description: "",
    user_id: "u-admin",
    assigned_agent_ids: ["u-1"],
    created_at: "2026-02-05T10:00:00Z",
    max_attempts: 3,
    calling_hours_start: "09:00:00",
    calling_hours_end: "18:00:00",
    retry_interval_minutes: 90,
    ring_timeout_seconds: null,
  },
];

function renderSelection(overrides: Record<string, unknown> = {}) {
  const handlers = {
    onRetryStats: vi.fn(),
    onRefreshCampaigns: vi.fn(),
    onSelectCampaign: vi.fn(),
    onOpenSettings: vi.fn(),
    onPrefetchCampaign: vi.fn(),
  };
  const props = {
    campaigns: CAMPAIGNS,
    campaignsLoading: false,
    campaignStateStats: { "c-open": [{ state: "TX", count: 2 }], "c-team": [] },
    campaignLastDialed: {},
    campaignEditPermissions: undefined,
    campaignStatsLoading: false,
    campaignStatsError: false,
    presence: {
      "c-open": { activeAgentCount: 1, activeAgents: [] },
      "c-team": { activeAgentCount: 0, activeAgents: [] },
    },
    leadershipView: false,
    assigneeProfiles: {},
    nowMs: NOW,
    ...handlers,
    ...overrides,
  };

  const utils = render(<CampaignSelection {...(props as any)} />);
  return { ...utils, handlers: { ...handlers, ...overrides } };
}

const rowFor = (id: string) => screen.getByTestId(`campaign-row-${id}`);
const chevronFor = (id: string) =>
  within(rowFor(id)).getByRole("button", { name: /details/i });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("expand/collapse", () => {
  it("chevron is an accessible native button with aria-expanded and aria-controls", () => {
    renderSelection();
    const chevron = chevronFor("c-open");
    expect(chevron.tagName).toBe("BUTTON");
    expect(chevron).toHaveAttribute("type", "button");
    expect(chevron).toHaveAttribute("aria-expanded", "false");
    const controls = chevron.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    fireEvent.click(chevron);
    expect(chevron).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(controls as string)).toBeInTheDocument();
  });

  it("expands and collapses via the chevron (keyboard-operable native button)", () => {
    renderSelection();
    const chevron = chevronFor("c-open");
    chevron.focus();
    expect(document.activeElement).toBe(chevron);
    fireEvent.click(chevron);
    expect(screen.getByTestId("campaign-details-c-open")).toBeInTheDocument();
    fireEvent.click(chevron);
    expect(screen.queryByTestId("campaign-details-c-open")).not.toBeInTheDocument();
  });

  it("expands via a row click", () => {
    renderSelection();
    fireEvent.click(rowFor("c-open"));
    expect(screen.getByTestId("campaign-details-c-open")).toBeInTheDocument();
  });

  it("is a single-open accordion (D4)", () => {
    renderSelection();
    fireEvent.click(rowFor("c-open"));
    fireEvent.click(rowFor("c-team"));
    expect(screen.getByTestId("campaign-details-c-team")).toBeInTheDocument();
    expect(screen.queryByTestId("campaign-details-c-open")).not.toBeInTheDocument();
  });

  it("expanding a row NEVER invokes onSelectCampaign", () => {
    const { handlers } = renderSelection();
    fireEvent.click(rowFor("c-open"));
    fireEvent.click(chevronFor("c-team"));
    expect(handlers.onSelectCampaign).not.toHaveBeenCalled();
  });

  it("shows the existing campaign details in the expanded row", () => {
    renderSelection();
    fireEvent.click(rowFor("c-team"));
    const details = screen.getByTestId("campaign-details-c-team");
    expect(within(details).getByText("Created")).toBeInTheDocument();
    expect(within(details).getByText("Calling window")).toBeInTheDocument();
    expect(within(details).getByText("Ring timeout")).toBeInTheDocument();
    expect(within(details).getByText("Max attempts")).toBeInTheDocument();
    expect(within(details).getByText("Retry interval")).toBeInTheDocument();
    expect(within(details).getByText("3")).toBeInTheDocument();
  });

  it("renders Unlimited when max_attempts is null and Org default for a null ring timeout", () => {
    renderSelection();
    fireEvent.click(rowFor("c-open"));
    const open = screen.getByTestId("campaign-details-c-open");
    expect(within(open).getByText("Unlimited")).toBeInTheDocument();
    fireEvent.click(rowFor("c-team"));
    const team = screen.getByTestId("campaign-details-c-team");
    expect(within(team).getByText("Org default")).toBeInTheDocument();
  });
});

// Corrective pass (2026-08-20): the expanded Contact states section must mirror the
// collapsed Contacts cell — never claim "No leads" while counts are pending or failed.
describe("expanded contact-state truthfulness", () => {
  const statesRegion = (id: string) =>
    within(screen.getByTestId(`campaign-details-${id}`)).getByTestId("details-contact-states");

  it("shows Loading counts… while stats are pending with no resolved data", () => {
    renderSelection({ campaignStatsLoading: true, campaignStateStats: {} });
    fireEvent.click(rowFor("c-open"));
    expect(within(statesRegion("c-open")).getByText("Loading counts…")).toBeInTheDocument();
    expect(within(statesRegion("c-open")).queryByText("No leads")).not.toBeInTheDocument();
  });

  it("shows an em dash on error with no resolved/cached states — never a false No leads", () => {
    renderSelection({ campaignStatsError: true, campaignStateStats: {} });
    fireEvent.click(rowFor("c-open"));
    expect(statesRegion("c-open")).toHaveTextContent("—");
    expect(within(statesRegion("c-open")).queryByText("No leads")).not.toBeInTheDocument();
  });

  it("shows No leads only for an authoritative empty array", () => {
    renderSelection();
    fireEvent.click(rowFor("c-team"));
    expect(within(statesRegion("c-team")).getByText("No leads")).toBeInTheDocument();
  });

  it("renders the state chips for resolved states", () => {
    renderSelection();
    fireEvent.click(rowFor("c-open"));
    expect(within(statesRegion("c-open")).getByText("TX (2)")).toBeInTheDocument();
  });
});

// Corrective pass (2026-08-20): leadership expanded presence must show "—" when presence
// is unavailable — cached identities must never linger through an error state.
describe("leadership expanded presence during unavailable presence", () => {
  it("renders an em dash in the Active agents section when presence is undefined", () => {
    renderSelection({ presence: undefined, leadershipView: true, assigneeProfiles: {} });
    fireEvent.click(rowFor("c-open"));
    const details = screen.getByTestId("campaign-details-c-open");
    expect(within(details).getByText("Active agents")).toBeInTheDocument();
    expect(within(details).queryByText("No active agents")).not.toBeInTheDocument();
    expect(within(details).getByText("—")).toBeInTheDocument();
  });
});

describe("Start Dialing", () => {
  it("invokes onSelectCampaign exactly once with the campaign id", () => {
    const { handlers } = renderSelection();
    const start = within(rowFor("c-open")).getByRole("button", { name: /start dialing/i });
    fireEvent.click(start);
    expect(handlers.onSelectCampaign).toHaveBeenCalledTimes(1);
    expect(handlers.onSelectCampaign).toHaveBeenCalledWith("c-open");
  });

  it("does not toggle the details row", () => {
    renderSelection();
    fireEvent.click(within(rowFor("c-open")).getByRole("button", { name: /start dialing/i }));
    expect(screen.queryByTestId("campaign-details-c-open")).not.toBeInTheDocument();
  });
});

describe("prefetch intent (preserved behavior)", () => {
  it("warms the cache on row hover", () => {
    const { handlers } = renderSelection();
    fireEvent.mouseEnter(rowFor("c-open"));
    expect(handlers.onPrefetchCampaign).toHaveBeenCalledWith("c-open");
  });

  it("warms the cache on focus within the row", () => {
    const { handlers } = renderSelection();
    fireEvent.focus(chevronFor("c-team"));
    expect(handlers.onPrefetchCampaign).toHaveBeenCalledWith("c-team");
  });

  it("warms the cache on Start Dialing pointer-down before the click", () => {
    const { handlers } = renderSelection();
    fireEvent.pointerDown(
      within(rowFor("c-open")).getByRole("button", { name: /start dialing/i }),
    );
    expect(handlers.onPrefetchCampaign).toHaveBeenCalledWith("c-open");
  });
});

describe("Campaign Settings gate (preserved behavior)", () => {
  it("keeps the settings action enabled when permission is unknown (server is the enforcer)", () => {
    const { handlers } = renderSelection({ campaignEditPermissions: undefined });
    fireEvent.click(rowFor("c-open"));
    const btn = within(screen.getByTestId("campaign-details-c-open")).getByRole("button", {
      name: /settings/i,
    });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(handlers.onOpenSettings).toHaveBeenCalledTimes(1);
    expect(handlers.onOpenSettings).toHaveBeenCalledWith("c-open");
    expect(handlers.onSelectCampaign).not.toHaveBeenCalled();
  });

  it("disables the settings action with the existing no-permission copy", () => {
    renderSelection({ campaignEditPermissions: { "c-open": false, "c-team": true } });
    fireEvent.click(rowFor("c-open"));
    const btn = within(screen.getByTestId("campaign-details-c-open")).getByRole("button", {
      name: CAMPAIGN_SETTINGS_COPY.noPermission,
    });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", CAMPAIGN_SETTINGS_COPY.noPermission);
  });
});

describe("secondary controls", () => {
  it("Retry re-runs the stats fetch", () => {
    const { handlers } = renderSelection({ campaignStatsError: true });
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(handlers.onRetryStats).toHaveBeenCalledTimes(1);
  });

  it("Refresh campaigns re-runs the campaign fetch", () => {
    const { handlers } = renderSelection();
    fireEvent.click(screen.getByRole("button", { name: /refresh campaigns/i }));
    expect(handlers.onRefreshCampaigns).toHaveBeenCalledTimes(1);
  });
});
