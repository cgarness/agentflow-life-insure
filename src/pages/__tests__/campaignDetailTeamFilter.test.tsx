/**
 * CampaignDetail Leads tab — the Team Leader display filter (hierarchy stabilization F7).
 *
 * The defect: the TL branch kept leads claimed by agents whose `upline_id` was the viewer, but
 * `fetchAgents` never SELECTED `upline_id`, so the team set was always empty and every Team
 * Leader saw only their own and unclaimed rows. The roster query also carried no organization
 * filter. F7 resolves the team with `usersApi.getAgentScopeIds` (via `useCampaignTeamScope`) and
 * filters the roster to the organization.
 *
 * A DISPLAY filter over rows RLS already returns (`campaign_leads_select`), not authorization —
 * these tests pin what the tab lists, never what the database permits. Pins: a TL sees own,
 * unclaimed and downline-claimed rows (multi-level, through a Deleted intermediate), never a
 * peer's, their upline's or a Deleted member's; a scope failure fails NARROW to own + unclaimed;
 * Admin / Agent are unchanged and issue no scope query; every profiles read is org-filtered.
 *
 * Shapes come from the shared supabase/tests/fixtures/hierarchy_shapes.json (hierarchyFixture).
 * The real `usersSupabaseApi` walk runs against an in-memory `profiles` table. Synthetic ids only.
 */
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import CampaignDetail from "@/pages/CampaignDetail";
import {
  filterCampaignLeadsForRole,
  isCampaignTeamLeaderRole,
  loadCampaignTeamScope,
} from "@/hooks/useCampaignTeamScope";
import { usersSupabaseApi } from "@/lib/supabase-users";
import { hierarchyShape, type HierarchyProfileRow } from "@/lib/__tests__/hierarchyFixture";

const CAMP_ID = "c0000000-0000-4000-8000-00000000000c";

interface ProfilesQuery {
  select: string;
  eq: Record<string, unknown>;
  inCol: string | null;
  inVals: unknown[];
}

const { state } = vi.hoisted(() => ({
  state: {
    role: "Team Leader",
    viewerId: "",
    organizationId: "" as string | null,
    profiles: [] as HierarchyProfileRow[],
    campaignLeads: [] as unknown[],
    profilesQueries: [] as ProfilesQuery[],
    failScope: false,
  },
}));

vi.mock("@/integrations/supabase/client", () => {
  const profilesBuilder = () => {
    const q: ProfilesQuery = { select: "*", eq: {}, inCol: null, inVals: [] };
    let range: [number, number] | null = null;
    const b: Record<string, unknown> = {
      select(cols: string) { q.select = cols; return b; },
      eq(col: string, v: unknown) { q.eq[col] = v; return b; },
      in(col: string, vals: unknown[]) { q.inCol = col; q.inVals = [...vals]; return b; },
      order() { return b; },
      range(from: number, to: number) { range = [from, to]; return b; },
      then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
        state.profilesQueries.push({ ...q, eq: { ...q.eq }, inVals: [...q.inVals] });
        if (state.failScope && q.inCol === "upline_id") {
          return Promise.resolve({ data: null, error: { message: "scope query failed" } }).then(onF, onR);
        }
        let rows = state.profiles.filter((r) =>
          Object.entries(q.eq).every(([c, v]) => (r as unknown as Record<string, unknown>)[c] === v) &&
          (!q.inCol || q.inVals.includes((r as unknown as Record<string, unknown>)[q.inCol])));
        rows = [...rows].sort((x, y) => x.id.localeCompare(y.id));
        if (range) rows = rows.slice(range[0], range[1] + 1);
        const cols = q.select.split(",").map((c) => c.trim());
        const data = rows.map((r) => Object.fromEntries(cols.map((c) => [c, (r as unknown as Record<string, unknown>)[c]])));
        return Promise.resolve({ data, error: null }).then(onF, onR);
      },
    };
    return b;
  };

  const tableBuilder = (table: string) => {
    let single = false;
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "in", "is", "not", "order", "limit", "range", "gte", "lte", "lt", "gt"]) {
      b[m] = () => b;
    }
    b.maybeSingle = () => { single = true; return b; };
    b.single = () => { single = true; return b; };
    (b as { then: unknown }).then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => {
      const data =
        table === "campaigns" ? {
          id: CAMP_ID, name: "Team Filter Camp", type: "Open Pool", status: "Draft", description: "",
          assigned_agent_ids: [], tags: [], total_leads: 0, leads_contacted: 0, leads_converted: 0,
          created_by: null, user_id: null, created_at: "2026-10-01T12:00:00.000Z",
        }
        : table === "campaign_leads" ? state.campaignLeads
        : single ? null : [];
      return Promise.resolve({ data, error: null }).then(onF, onR);
    };
    return b;
  };

  return {
    supabase: {
      from: (table: string) => (table === "profiles" ? profilesBuilder() : tableBuilder(table)),
      rpc: (name: string) => Promise.resolve({ data: name === "can_dial_campaign" ? false : null, error: null }),
      auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "tok" } } }) },
    },
  };
});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: state.viewerId },
    profile: { id: state.viewerId, organization_id: state.organizationId, role: state.role, is_super_admin: false },
  }),
}));
vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: state.organizationId }),
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

const prod = hierarchyShape("production");
const deletedMid = hierarchyShape("deleted_intermediate");
const ORG_A = prod.orgOf("T");

/** One campaign lead per label, claimed by `claimedBy` (null = unclaimed). */
function campaignLead(label: string, claimedBy: string | null) {
  return {
    id: `cl-${label}`, campaign_id: CAMP_ID, lead_id: `lead-${label}`, status: "Queued", call_attempts: 0,
    last_called_at: null, claimed_by: claimedBy, created_at: "2026-10-01T12:00:00.000Z", sort_order: 0,
    lead: { id: `lead-${label}`, first_name: `Lead${label}`, last_name: "Test", phone: "+15550000000", state: "TX" },
  };
}

const leadName = (label: string) => `Lead${label} Test`;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/campaigns/${CAMP_ID}`]}>
      <Routes>
        <Route path="/campaigns/:id" element={<CampaignDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

const scopeQueries = () => state.profilesQueries.filter((q) => q.inCol === "upline_id");
const rosterQueries = () => state.profilesQueries.filter((q) => q.select.includes("avatar_url"));

/** Wait until the scope (if any) has settled and the first row has painted. */
async function expectListed(labels: string[], hidden: string[]) {
  for (const label of labels) expect(await screen.findByText(leadName(label))).toBeInTheDocument();
  for (const label of hidden) expect(screen.queryByText(leadName(label))).not.toBeInTheDocument();
}

beforeEach(() => {
  vi.clearAllMocks();
  state.role = "Team Leader";
  state.viewerId = prod.id("T");
  state.organizationId = ORG_A;
  // Production shape plus a foreign-organization row the roster must never return.
  state.profiles = [...prod.rows(), ...deletedMid.rows()];
  state.profilesQueries = [];
  state.failScope = false;
  state.campaignLeads = [
    campaignLead("Own", prod.id("T")),
    campaignLead("A1", prod.id("A1")),
    campaignLead("A2", prod.id("A2")),
    campaignLead("D1", prod.id("D1")),
    campaignLead("Peer", prod.id("K1")),
    campaignLead("Upline", prod.id("R")),
    campaignLead("Unclaimed", null),
  ];
  (globalThis as unknown as Record<string, unknown>).ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  };
  (globalThis as unknown as Record<string, unknown>).IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  };
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});

describe("CampaignDetail — Team Leader display filter", () => {
  it("lists own, unclaimed and downline-claimed rows; never a peer's, the upline's or a Deleted member's", async () => {
    renderPage();
    // A1 / A2 are the regression: the old filter could never match a team member.
    await expectListed(["A1", "A2", "Own", "Unclaimed"], ["D1", "Peer", "Upline"]);

    // The team came from the org-constrained upline_id walk, starting at the viewer.
    expect(scopeQueries().length).toBeGreaterThan(0);
    for (const q of scopeQueries()) expect(q.eq.organization_id).toBe(ORG_A);
    expect(scopeQueries()[0].inVals).toEqual([prod.id("T")]);
  });

  it("walks through a Deleted intermediate to a live member, hiding the Deleted manager's own rows", async () => {
    state.viewerId = deletedMid.id("M");
    state.organizationId = deletedMid.orgOf("M");
    state.campaignLeads = [
      campaignLead("Own", deletedMid.id("M")),
      campaignLead("BelowDeleted", deletedMid.id("MG")),
      campaignLead("DeletedManager", deletedMid.id("MT")),
      campaignLead("OtherOrg", prod.id("A1")),
    ];
    renderPage();
    await expectListed(["BelowDeleted", "Own"], ["DeletedManager", "OtherOrg"]);
  });

  it("fails NARROW on a scope error: own + unclaimed only, never the organization", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    state.failScope = true;
    renderPage();
    await expectListed(["Own", "Unclaimed"], ["A1", "A2", "D1", "Peer", "Upline"]);
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalled());
    expect(screen.queryByText(leadName("A1"))).not.toBeInTheDocument();
    consoleError.mockRestore();
  });

  it("the roster query carries the explicit organization filter (and the Active filter)", async () => {
    renderPage();
    await screen.findByText(leadName("Own"));
    await vi.waitFor(() => expect(rosterQueries().length).toBeGreaterThan(0));
    for (const q of rosterQueries()) {
      expect(q.eq).toEqual({ organization_id: ORG_A, status: "Active" });
    }
  });

  it("without an organization: no profiles query at all, and the filter stays own + unclaimed", async () => {
    state.organizationId = null;
    renderPage();
    await expectListed(["Own", "Unclaimed"], ["A1", "A2", "Peer"]);
    expect(state.profilesQueries).toEqual([]);
  });
});

describe("CampaignDetail — other roles are unchanged and issue no scope query", () => {
  it("Admin lists every row", async () => {
    state.role = "Admin";
    state.viewerId = prod.id("R");
    renderPage();
    await expectListed(["A1", "A2", "D1", "Own", "Peer", "Unclaimed", "Upline"], []);
    expect(scopeQueries()).toEqual([]);
  });

  it("Agent lists only their own claims", async () => {
    state.role = "Agent";
    state.viewerId = prod.id("A1");
    renderPage();
    await expectListed(["A1"], ["A2", "D1", "Own", "Peer", "Unclaimed", "Upline"]);
    expect(scopeQueries()).toEqual([]);
  });
});

describe("useCampaignTeamScope — pure loader and filter", () => {
  it("loadCampaignTeamScope fails narrow: viewer alone without an org or on error; nothing without a viewer", async () => {
    expect(await loadCampaignTeamScope({ viewerId: "", organizationId: ORG_A })).toEqual([]);
    expect(await loadCampaignTeamScope({ viewerId: "v1", organizationId: null })).toEqual(["v1"]);

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const spy = vi.spyOn(usersSupabaseApi, "getAgentScopeIds").mockRejectedValueOnce(new Error("boom"));
    expect(await loadCampaignTeamScope({ viewerId: "v1", organizationId: ORG_A })).toEqual(["v1"]);
    expect(spy).toHaveBeenCalledWith({ viewerId: "v1", organizationId: ORG_A });
    spy.mockRestore();
    consoleError.mockRestore();
  });

  it("loadCampaignTeamScope returns the real walk for a Team Leader", async () => {
    const ids = await loadCampaignTeamScope({ viewerId: prod.id("T"), organizationId: ORG_A });
    expect(ids.map((id) => prod.keyOf(id)).sort()).toEqual(["A1", "A2", "T"]);
  });

  it("filterCampaignLeadsForRole keeps the historic role spellings and treats other roles as all", () => {
    const leads = [{ claimed_by: "me" }, { claimed_by: "team" }, { claimed_by: "peer" }, { claimed_by: null }];
    const teamIds = new Set(["team"]);
    expect(isCampaignTeamLeaderRole("team_leader")).toBe(true);
    expect(isCampaignTeamLeaderRole("Team Leader")).toBe(true);
    expect(isCampaignTeamLeaderRole("Agent")).toBe(false);
    expect(filterCampaignLeadsForRole(leads, { role: "team_leader", viewerId: "me", teamIds }).map((l) => l.claimed_by))
      .toEqual(["me", "team", null]);
    expect(filterCampaignLeadsForRole(leads, { role: "AGENT", viewerId: "me", teamIds }).map((l) => l.claimed_by))
      .toEqual(["me"]);
    expect(filterCampaignLeadsForRole(leads, { role: "Agent", viewerId: null, teamIds })).toEqual([]);
    expect(filterCampaignLeadsForRole(leads, { role: "Admin", viewerId: "me", teamIds })).toHaveLength(4);
    expect(filterCampaignLeadsForRole(leads, { role: "Super Admin", viewerId: "me", teamIds })).toHaveLength(4);
  });
});
