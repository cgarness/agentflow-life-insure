vi.mock("@/hooks/useSmsConsentStatus", () => ({ useSmsConsentStatus: () => ({ data: { enforced: false }, error: null, refetch: vi.fn() }) }));
/**
 * FullScreenContactView — Assigned Agent options (hierarchy stabilization F10).
 *
 * THE DEFECT THIS PINS. The edit-mode "Assigned Agent" select offered every Active profile the
 * browser could read — no organization filter, and no role narrowing — so a Team Leader or an
 * Agent was offered the whole organization even though Contacts' own Add Lead / bulk assign
 * already narrowed by role. The options now come from the shared pure
 * `resolveAssignableAgents` (Admin / effective super admin → org roster; Team Leader → self +
 * downline from `get_contact_scope_agents`; Agent → self), with the contact's current assignee
 * always kept, and the roster query carries an explicit organization filter.
 *
 * A UX narrowing only — RLS and the server checks are the authority. Under "View As" the team RPC
 * is withheld (it would answer for the real operator's `auth.uid()`), so a viewed Team Leader is
 * offered the current assignee only: fail closed.
 *
 * Harness mirrors `fullScreenContactViewStatusSave.test.tsx`; the `profiles` stub honours `eq`.
 * Shapes come from the shared hierarchy_shapes.json (hierarchyFixture). Synthetic ids only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { hierarchyShape } from "@/lib/__tests__/hierarchyFixture";

const h = vi.hoisted(() => ({
  profiles: [] as Array<Record<string, unknown>>,
  profilesQueries: [] as Array<{ select: string; eq: Record<string, unknown> }>,
  rpcCalls: [] as string[],
  teamRows: [] as Array<Record<string, unknown>> | null,
  teamError: null as null | { message: string },
  viewer: { id: "", role: "Admin", organizationId: "" as string | null, isSuperAdmin: false, impersonating: false },
}));

vi.mock("@/integrations/supabase/client", () => {
  const passthrough = (data: unknown) => {
    const result = { data, error: null };
    const query: Record<string, unknown> = {
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    for (const method of ["select", "eq", "in", "or", "not", "order", "limit", "gte", "lt", "neq", "is"]) {
      query[method] = () => query;
    }
    query.maybeSingle = () => Promise.resolve(result);
    query.single = () => Promise.resolve(result);
    return query;
  };
  const profilesQuery = () => {
    const q = { select: "*", eq: {} as Record<string, unknown> };
    const run = (single: boolean) => {
      h.profilesQueries.push({ select: q.select, eq: { ...q.eq } });
      const rows = h.profiles.filter((r) => Object.entries(q.eq).every(([c, v]) => r[c] === v));
      return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null });
    };
    const b: Record<string, unknown> = {
      select(cols: string) { q.select = cols; return b; },
      eq(col: string, v: unknown) { q.eq[col] = v; return b; },
      order() { return b; },
      maybeSingle: () => run(true),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => run(false).then(onF, onR),
    };
    return b;
  };
  return {
    supabase: {
      from: (table: string) => (table === "profiles" ? profilesQuery() : passthrough(null)),
      rpc: (name: string) => {
        h.rpcCalls.push(name);
        const result = name === "get_contact_scope_agents"
          ? { data: h.teamError ? null : h.teamRows, error: h.teamError }
          : { data: null, error: null };
        return { then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => Promise.resolve(result).then(onF, onR) };
      },
    },
  };
});

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/hooks/useContactHistory", () => ({ useContactHistory: () => ({
  conversation: { items: [], loading: false, error: null, hasMore: false }, activity: { items: [], loading: false, error: null, hasMore: false },
  refresh: vi.fn(), loadConversation: vi.fn(), loadActivity: vi.fn(),
}) }));
vi.mock("@/lib/supabase-notes", () => ({ notesSupabaseApi: { getByContact: vi.fn(async () => []) } }));
vi.mock("@/lib/supabase-activities", () => ({
  activitiesSupabaseApi: { getByContact: vi.fn(async () => []), add: vi.fn(async () => ({ id: "a1" })) },
}));
vi.mock("@/lib/supabase-settings", () => ({
  pipelineSupabaseApi: { getLeadStages: vi.fn(async () => []), getRecruitStages: vi.fn(async () => []) },
  customFieldsSupabaseApi: { getAll: vi.fn(async () => []) },
  leadSourcesSupabaseApi: { getAll: vi.fn(async () => []) },
}));
vi.mock("@/lib/supabase-email", () => ({
  emailSupabaseApi: { getMyConnections: vi.fn(async () => []), getContactEmails: vi.fn(async () => []) },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    // `user` is the REAL session user; `profile` is the effective (viewed) profile under View As.
    user: { id: h.viewer.impersonating ? "real-operator" : h.viewer.id },
    profile: {
      id: h.viewer.id, first_name: "Viewer", last_name: "Self", role: h.viewer.role,
      organization_id: h.viewer.organizationId, is_super_admin: h.viewer.isSuperAdmin,
    },
    isImpersonating: h.viewer.impersonating,
  }),
}));
vi.mock("@/contexts/CalendarContext", () => ({ useCalendar: () => ({ addAppointment: vi.fn() }) }));
vi.mock("@/contexts/SidebarContext", () => ({ useSidebarContext: () => ({ collapsed: false }) }));
vi.mock("@/contexts/BrandingContext", () => ({
  useBranding: () => ({ formatDate: (v: string) => v, formatDateTime: (v: string) => v, branding: { companyName: "AgentFlow" } }),
}));
vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: h.viewer.organizationId, role: h.viewer.role, isSuperAdmin: h.viewer.isSuperAdmin }),
}));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ hasContactsPermission: () => true }) }));
vi.mock("@/components/calendar/AppointmentModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/followups/ContactFollowUpsCard", () => ({ ContactFollowUpsCard: () => null }));
vi.mock("@/components/contacts/ConvertLeadModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/AddToCampaignModal", () => ({ default: () => null }));
vi.mock("@/components/messaging/MessageComposePanel", () => ({ MessageComposePanel: () => null }));
vi.mock("@/components/messaging/MessageTemplatesPickerModal", () => ({ MessageTemplatesPickerModal: () => null }));
vi.mock("../TasksPanel", () => ({ TasksPanel: () => null }));

import FullScreenContactView from "@/components/contacts/FullScreenContactView";

const prod = hierarchyShape("production");
const foreign = hierarchyShape("deleted_intermediate");
const ORG_A = prod.orgOf("T");

const ACTIVE_ORG_A = ["A1", "A2", "K1", "K2", "K3", "K4", "K5", "R", "T"];

function leadAssignedTo(assigneeId: string) {
  return {
    id: "lead-1", firstName: "Dana", lastName: "Reyes", phone: "5125550123", email: "dana@example.com",
    state: "TX", status: "New", leadSource: "Facebook Ads", assignedAgentId: assigneeId,
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  };
}

/** The server's `get_contact_scope_agents` answer for a Team Leader: self + live downline. */
const teamRowsFor = (keys: string[]) =>
  keys.map((k) => ({ id: prod.id(k), first_name: `Synthetic ${k}`, last_name: "Member" }));

async function renderAndEdit(assigneeKey: string) {
  render(
    <FullScreenContactView
      contact={leadAssignedTo(prod.id(assigneeKey))}
      type="lead"
      onClose={vi.fn()}
      onUpdate={vi.fn(async () => {})}
      onDelete={vi.fn(async () => {})}
    />,
  );
  await screen.findByRole("button", { name: /^call$/i });
  fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
}

function assigneeSelect(): HTMLSelectElement {
  const label = Array.from(document.querySelectorAll("label")).find((l) => l.textContent?.trim() === "Assigned Agent");
  const select = label?.parentElement?.querySelector("select");
  if (!select) throw new Error("no Assigned Agent select on screen");
  return select as HTMLSelectElement;
}

/** Option keys in display order, excluding the "—" (unassigned) entry. */
const optionKeys = () =>
  Array.from(assigneeSelect().options).filter((o) => o.value !== "").map((o) => prod.keyOf(o.value));

const rosterQueries = () => h.profilesQueries.filter((q) => q.select.includes("status"));

function asViewer(key: string, role: string, extra: Partial<typeof h.viewer> = {}) {
  h.viewer = { id: prod.id(key), role, organizationId: ORG_A, isSuperAdmin: false, impersonating: false, ...extra };
}

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
  // The production shape plus another organization's profiles: the roster must never offer them.
  h.profiles = [...prod.rows(), ...foreign.rows()] as unknown as Array<Record<string, unknown>>;
  h.profilesQueries = [];
  h.rpcCalls = [];
  h.teamRows = teamRowsFor(["T", "A1", "A2"]);
  h.teamError = null;
  asViewer("R", "Admin");
});

describe("FullScreenContactView — Assigned Agent options by role", () => {
  it("Admin: the Active roster of THIS organization only, read with an explicit organization filter", async () => {
    await renderAndEdit("A1");
    await waitFor(() => expect(optionKeys().sort()).toEqual(ACTIVE_ORG_A));
    expect(rosterQueries().length).toBeGreaterThan(0);
    for (const q of rosterQueries()) expect(q.eq).toEqual({ organization_id: ORG_A, status: "Active" });
    expect(h.rpcCalls).not.toContain("get_contact_scope_agents");
  });

  it("Team Leader: self + downline from the server's scope; a peer assignee is kept but no other peer is offered", async () => {
    asViewer("T", "Team Leader");
    await renderAndEdit("K1");
    await waitFor(() => expect(optionKeys()).toEqual(["K1", "T", "A1", "A2"]));
    expect(h.rpcCalls).toContain("get_contact_scope_agents");
    expect(assigneeSelect().value).toBe(prod.id("K1"));
  });

  it("Team Leader: the current assignee inside the team is not duplicated", async () => {
    asViewer("T", "Team Leader");
    await renderAndEdit("A2");
    await waitFor(() => expect(optionKeys()).toEqual(["T", "A1", "A2"]));
  });

  it("Team Leader whose scope RPC fails: only the current assignee — fails closed, never the org", async () => {
    asViewer("T", "Team Leader");
    h.teamError = { message: "scope failed" };
    await renderAndEdit("K2");
    await waitFor(() => expect(h.rpcCalls).toContain("get_contact_scope_agents"));
    await waitFor(() => expect(rosterQueries().length).toBeGreaterThan(0));
    expect(optionKeys()).toEqual(["K2"]);
  });

  it("Team Leader under View As: the team RPC is withheld and only the current assignee is offered", async () => {
    asViewer("T", "Team Leader", { impersonating: true });
    await renderAndEdit("A1");
    await waitFor(() => expect(rosterQueries().length).toBeGreaterThan(0));
    expect(h.rpcCalls).not.toContain("get_contact_scope_agents");
    expect(optionKeys()).toEqual(["A1"]);
  });

  it("Agent: only themselves (plus the current assignee when it is someone else)", async () => {
    asViewer("A1", "Agent");
    await renderAndEdit("K3");
    await waitFor(() => expect(optionKeys()).toEqual(["K3", "A1"]));
    expect(h.rpcCalls).not.toContain("get_contact_scope_agents");
  });

  it("a real (non-impersonating) Super Admin gets the organization roster", async () => {
    asViewer("R", "Super Admin", { isSuperAdmin: true });
    await renderAndEdit("A1");
    await waitFor(() => expect(optionKeys().sort()).toEqual(ACTIVE_ORG_A));
  });

  it("without an organization: no roster query, and no effective viewer means no options (fail closed)", async () => {
    asViewer("R", "Admin", { organizationId: null });
    await renderAndEdit("A1");
    await waitFor(() => expect(h.profilesQueries.length).toBeGreaterThan(0)); // the assignee lookup only
    expect(rosterQueries()).toEqual([]);
    // useEffectiveViewer is unresolved without an organization; resolveAssignableAgents then offers
    // nobody. The form keeps the saved assignee unless the user explicitly picks "—".
    expect(optionKeys()).toEqual([]);
  });
});
