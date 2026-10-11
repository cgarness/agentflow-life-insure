/**
 * CampaignDetail Leads tab (Part B, B4-67 with B4-56): a status filter that matches nothing is
 * not a campaign with no leads.
 *
 * Pins: with a status filter other than "All" and no match, the tab says "No leads match this
 * filter." and none of the role empty texts; with "All" the role texts are unchanged (the
 * Agent one without the old "Join the Dialer" nudge). Supabase is mocked the way
 * campaignDetailImportRetry.test.tsx does; no query changes.
 */
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import CampaignDetail from "@/pages/CampaignDetail";

const CAMP_ID = "c0000000-0000-4000-8000-00000000000c";
const USER_ID = "a0000000-0000-4000-8000-00000000000a";
const ORG_ID = "0f000000-0000-4000-8000-00000000000f";

const { state } = vi.hoisted(() => ({
  state: {
    role: "Admin",
    tableData: {} as Record<string, unknown>,
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      let single = false;
      const b: Record<string, unknown> = {};
      for (const m of [
        "select", "insert", "update", "delete", "upsert", "eq", "neq", "in", "is", "not", "gte", "gt",
        "lte", "lt", "like", "ilike", "contains", "order", "limit", "range", "csv", "abortSignal",
      ]) {
        b[m] = () => b;
      }
      b.maybeSingle = () => { single = true; return b; };
      b.single = () => { single = true; return b; };
      (b as { then: unknown }).then = (
        onFulfilled?: (v: { data: unknown; error: null }) => unknown,
        onRejected?: (e: unknown) => unknown,
      ) => Promise.resolve({ data: state.tableData[table] ?? (single ? null : []), error: null })
        .then(onFulfilled, onRejected);
      return b;
    },
    rpc: (name: string) =>
      Promise.resolve({ data: name === "can_dial_campaign" ? false : null, error: null }),
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "tok" } } }) },
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: USER_ID },
    profile: { id: USER_ID, organization_id: ORG_ID, role: state.role, is_super_admin: false },
  }),
}));
vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: ORG_ID }),
}));
vi.mock("@/contexts/BrandingContext", () => ({
  useBranding: () => ({
    formatDate: (d: Date | string) => new Date(d).toDateString(),
    formatDateTime: (d: Date | string) => new Date(d).toISOString(),
  }),
}));
vi.mock("@/components/PermissionGate", () => ({
  PermissionGate: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const FILTERED_EMPTY = "No leads match this filter.";
const ADMIN_EMPTY = "This campaign has no leads yet.";
const AGENT_EMPTY = "You haven't claimed any leads in this campaign yet.";
const TEAM_LEADER_EMPTY = "No leads have been claimed in this campaign by you or your team yet.";
const ROLE_EMPTY_TEXTS = [ADMIN_EMPTY, AGENT_EMPTY, TEAM_LEADER_EMPTY];

function campaignLead(id: string, status: string, claimedBy: string | null = null) {
  return {
    id: `cl-${id}`, campaign_id: CAMP_ID, lead_id: `lead-${id}`, status, call_attempts: 0,
    last_called_at: null, claimed_by: claimedBy, created_at: "2026-10-01T12:00:00.000Z", sort_order: 0,
    lead: { id: `lead-${id}`, first_name: `Lead${id}`, last_name: "Test", phone: "+15550000000", state: "TX" },
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/campaigns/${CAMP_ID}`]}>
      <Routes>
        <Route path="/campaigns/:id" element={<CampaignDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

function statusFilter() {
  return screen.getByDisplayValue("All") as HTMLSelectElement;
}

function expectNoRoleEmptyText() {
  for (const text of ROLE_EMPTY_TEXTS) expect(screen.queryByText(text)).not.toBeInTheDocument();
}

beforeEach(() => {
  vi.clearAllMocks();
  state.role = "Admin";
  state.tableData = {
    campaigns: {
      id: CAMP_ID, name: "Filter Fixture Camp", type: "Open Pool", status: "Draft", description: "",
      assigned_agent_ids: [], tags: [], total_leads: 2, leads_contacted: 0, leads_converted: 0,
      created_by: USER_ID, user_id: USER_ID, created_at: "2026-08-10T12:00:00.000Z",
    },
    campaign_leads: [],
    leads: [],
    profiles: [],
    import_history: [],
  };
  (globalThis as unknown as Record<string, unknown>).ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  };
  (globalThis as unknown as Record<string, unknown>).IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  };
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});

describe("CampaignDetail Leads tab — filtered-empty vs All-empty", () => {
  it("a status filter with no match says so, and All shows the leads again", async () => {
    state.tableData.campaign_leads = [campaignLead("1", "Queued"), campaignLead("2", "Called")];
    renderPage();
    await screen.findByText("Lead1 Test");

    fireEvent.change(statusFilter(), { target: { value: "Completed" } });
    expect(await screen.findByText(FILTERED_EMPTY)).toBeInTheDocument();
    expectNoRoleEmptyText();
    expect(screen.queryByText("Lead1 Test")).not.toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue("Completed"), { target: { value: "Queued" } });
    expect(await screen.findByText("Lead1 Test")).toBeInTheDocument();
    expect(screen.queryByText("Lead2 Test")).not.toBeInTheDocument();
    expect(screen.queryByText(FILTERED_EMPTY)).not.toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue("Queued"), { target: { value: "All" } });
    expect(await screen.findByText("Lead2 Test")).toBeInTheDocument();
    expect(screen.queryByText(FILTERED_EMPTY)).not.toBeInTheDocument();
    expectNoRoleEmptyText();
  });

  it("Admin with All and no leads keeps the role empty text", async () => {
    renderPage();
    expect(await screen.findByText(ADMIN_EMPTY)).toBeInTheDocument();
    expect(screen.queryByText(FILTERED_EMPTY)).not.toBeInTheDocument();
  });

  it("a non-All filter on a campaign with no leads reads as filtered-empty", async () => {
    renderPage();
    await screen.findByText(ADMIN_EMPTY);
    fireEvent.change(statusFilter(), { target: { value: "Queued" } });
    expect(await screen.findByText(FILTERED_EMPTY)).toBeInTheDocument();
    expectNoRoleEmptyText();
  });

  it("Agent with All keeps the claimed-leads text without the Dialer nudge; a filter reads as filtered-empty", async () => {
    state.role = "Agent";
    // Leads claimed by someone else are not visible to this agent.
    state.tableData.campaign_leads = [campaignLead("1", "Queued", "someone-else")];
    renderPage();
    const text = await screen.findByText(AGENT_EMPTY);
    expect(text.textContent).toBe(AGENT_EMPTY);
    expect(screen.queryByText(/Join the Dialer/)).not.toBeInTheDocument();
    expect(screen.queryByText(FILTERED_EMPTY)).not.toBeInTheDocument();

    fireEvent.change(statusFilter(), { target: { value: "Called" } });
    expect(await screen.findByText(FILTERED_EMPTY)).toBeInTheDocument();
    expectNoRoleEmptyText();
  });

  it("Team Leader with All keeps the team text", async () => {
    state.role = "Team Leader";
    renderPage();
    expect(await screen.findByText(TEAM_LEADER_EMPTY)).toBeInTheDocument();
    expect(screen.queryByText(FILTERED_EMPTY)).not.toBeInTheDocument();
  });
});
