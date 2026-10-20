/**
 * Phase 2A on the Contacts page: the Add Client handler raises its pre-save refusals as "not sent" (the modal stays
 * editable), a frozen retry replays the already-checked submission without re-running those checks, and the Edit
 * Client lambda sends a first-policy edit through the receipt-bearing companion while ordinary edits keep `update`.
 * Synthetic data only; Supabase, the session and the modal are stubbed.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";

const ids = vi.hoisted(() => ({
  ORG: "11111111-1111-4111-8111-111111111111",
  USER: "00000000-0000-4000-8000-000000000001",
  CLIENT: "bbbbbbbb-0000-4000-8000-00000000000b",
}));
const api = vi.hoisted(() => ({ calls: [] as { name: string; args: unknown[] }[] }));
const modal = vi.hoisted(() => ({ create: null as null | Record<string, unknown>, edit: null as null | Record<string, unknown> }));
const settingsState = vi.hoisted(() => ({ value: { manualAction: "allow" } as Record<string, unknown> }));

vi.mock("@/integrations/supabase/client", () => {
  function makeBuilder() {
    const b: Record<string, unknown> = {
      select: () => b, eq: () => b, neq: () => b, in: () => b, or: () => b, not: () => b, is: () => b,
      order: () => b, range: () => b, limit: () => b, gte: () => b, lt: () => b,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      single: () => Promise.resolve({ data: null, error: null }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(resolve),
    };
    return b;
  }
  const rpcB: Record<string, unknown> = new Proxy({}, {
    get: (_t, p) => (p === "then" ? (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve) : () => rpcB),
  });
  return { supabase: { from: () => makeBuilder(), rpc: () => rpcB, auth: {} } };
});
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: ids.USER }, profile: { id: ids.USER, organization_id: ids.ORG, role: "Admin" }, isImpersonating: false,
    isBuildingOrganization: false }),
}));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: ids.ORG, role: "Admin", isSuperAdmin: false }) }));
vi.mock("@/contexts/BrandingContext", () => ({
  useBranding: () => ({ formatDate: (v: unknown) => String(v ?? ""), formatDateTime: (v: unknown) => String(v ?? "") }),
}));
const scopeMock = vi.hoisted(() => ({
  scope: "mine", availableScopes: ["mine"], maxScope: "all", teamAgents: [] as never[], teamAgentIds: [] as string[],
  hasDownline: false, ready: true, prefError: false, setScope: () => {},
}));
vi.mock("@/hooks/useContactScope", () => ({ useContactScope: () => scopeMock }));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasContactsPermission: () => true, getDataScope: () => "own", isLoading: false }),
}));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {}, warning: () => {}, message: () => {}, info: () => {} } }));

function record(name: string, value: unknown) {
  return (...args: unknown[]) => { api.calls.push({ name, args }); return Promise.resolve(value); };
}
const rows = vi.hoisted(() => ({
  client: { id: "bbbbbbbb-0000-4000-8000-00000000000b", firstName: "Marcus", lastName: "Webb", phone: "5125550124", email: "",
    state: "TX", assignedAgentId: "00000000-0000-4000-8000-000000000001" } as Record<string, unknown>,
}));
vi.mock("@/lib/supabase-contacts", () => ({
  leadsSupabaseApi: { getAll: record("leads.getAll", { data: [], totalCount: 0 }), getById: () => Promise.reject(new Error("not a lead")),
    getByIds: record("leads.getByIds", []), getKanban: record("leads.getKanban", { columns: [] }), create: record("leads.create", {}),
    update: record("leads.update", {}) },
  rowToLead: (r: Record<string, unknown>) => r,
}));
vi.mock("@/lib/supabase-clients", () => ({
  clientsSupabaseApi: {
    getAll: record("clients.getAll", { data: [rows.client], totalCount: 1 }),
    getById: record("clients.getById", rows.client),
    create: record("clients.create", rows.client),
    update: record("clients.update", rows.client),
    updateWithPolicySaleHandoff: record("clients.updateWithPolicySaleHandoff", rows.client),
  },
  rowToClient: (r: Record<string, unknown>) => r,
}));
vi.mock("@/lib/supabase-recruits", () => ({
  recruitsSupabaseApi: { getAll: record("recruits.getAll", { data: [], totalCount: 0 }), getById: () => Promise.reject(new Error("no")),
    getKanban: record("recruits.getKanban", { columns: [] }), create: record("recruits.create", {}), update: record("recruits.update", {}) },
  rowToRecruit: (r: Record<string, unknown>) => r,
}));
vi.mock("@/lib/supabase-users", () => ({
  usersSupabaseApi: { getAgentScopeIds: record("users.getAgentScopeIds", [ids.USER]), getByIds: record("users.getByIds", []),
    getAll: record("users.getAll", []), getById: record("users.getById", null) },
}));
vi.mock("@/lib/supabase-settings", () => ({
  pipelineSupabaseApi: { getLeadStages: vi.fn(async () => []), getRecruitStages: vi.fn(async () => []) },
  customFieldsSupabaseApi: { getAll: vi.fn(async () => []) },
  leadSourcesSupabaseApi: { getAll: vi.fn(async () => []) },
  contactManagementSettingsSupabaseApi: { getSettings: vi.fn(async () => settingsState.value) },
}));
vi.mock("@/lib/supabase-notes", () => ({ notesSupabaseApi: { getByContact: vi.fn(async () => []) } }));
const routerState = vi.hoisted(() => ({ params: new URLSearchParams("tab=Clients") }));
vi.mock("react-router-dom", () => ({
  useNavigate: () => () => {},
  useLocation: () => ({ state: null, pathname: "/contacts", search: "", hash: "", key: "t" }),
  useSearchParams: () => [routerState.params, (next: unknown) => { routerState.params = next as URLSearchParams; }],
}));
vi.mock("@/components/contacts/AddClientModal", () => ({
  // The Add mount passes no `initial`; the Edit mount always passes one (null until a client is chosen).
  default: (props: Record<string, unknown>) => {
    const editing = props.initial !== undefined;
    if (editing) modal.edit = props;
    else modal.create = props;
    return React.createElement("div", { "data-testid": editing ? "edit-client-modal" : "add-client-modal" });
  },
}));
function marker(id: string) {
  return { default: () => React.createElement("div", { "data-testid": id }) };
}
vi.mock("@/components/contacts/FullScreenContactView", () => marker("full-screen-contact"));
vi.mock("@/components/contacts/AddLeadModal", () => marker("add-lead-modal"));
vi.mock("@/components/contacts/AddRecruitModal", () => marker("add-recruit-modal"));
vi.mock("@/components/contacts/AddToCampaignModal", () => marker("add-to-campaign-modal"));
vi.mock("@/components/contacts/DeleteConfirmModal", () => marker("delete-confirm-modal"));
vi.mock("@/components/contacts/ConvertLeadModal", () => marker("convert-lead-modal"));
vi.mock("@/components/contacts/AgentModal", () => marker("agent-modal"));
vi.mock("@/components/contacts/ContactsFilterModal", () => marker("filter-modal"));
vi.mock("@/components/contacts/ContactScopeSelector", () => marker("scope-selector"));
vi.mock("@/components/contacts/ContactKanbanBoard", () => ({ ContactKanbanBoard: () => React.createElement("div") }));
vi.mock("@/components/PermissionGate", () => ({
  PermissionGate: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  CommissionGate: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import Contacts from "@/pages/Contacts";
import { freezeSale, newSaleAttempt, SaleRequestError, type PreparedSale } from "@/lib/policySaleOutcome";
import { emptyCommissionPayload } from "@/lib/commission/capture";

type OnSave = (data: Record<string, unknown>, sale?: Record<string, unknown>) => Promise<void>;
const REQUEST = "00000000-0000-4000-8000-0000000000a1";
const frozen = (): PreparedSale => freezeSale({
  kind: "create", requestId: REQUEST, leadId: null, expectedClientId: null, saleArgs: { p_expected_org: ids.ORG, p_client: {}, p_record_sale: false },
  commission: emptyCommissionPayload(), notify: true,
});
const calls = (name: string) => api.calls.filter((call) => call.name === name).map((call) => call.args);

beforeEach(() => {
  api.calls = [];
  modal.create = null;
  modal.edit = null;
  routerState.params = new URLSearchParams("tab=Clients");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Contacts Add Client handler", () => {
  it("raises a pre-save refusal as not sent, so the modal stays editable", async () => {
    render(<Contacts />);
    await waitFor(() => expect(modal.create).not.toBeNull());
    const onSave = modal.create!.onSave as OnSave;
    const attempt = newSaleAttempt();
    const failure = await onSave({ firstName: "Pat", lastName: "Lee", phone: "" }, { requestId: REQUEST, recordSale: false, attempt }).catch((e) => e);
    expect(failure).toBeInstanceOf(SaleRequestError);
    expect(failure).toMatchObject({ errorClass: "not_sent", message: "Client was not saved. Complete the required contact fields." });
    expect(attempt.sent).toBe(false);
    expect(calls("clients.create")).toHaveLength(0);
  });

  it("a frozen retry replays the checked submission without re-running the pre-save checks", async () => {
    render(<Contacts />);
    await waitFor(() => expect(modal.create).not.toBeNull());
    const onSave = modal.create!.onSave as OnSave;
    const attempt = newSaleAttempt(frozen());
    // The form now fails the required-field check, but a frozen retry must replay, not re-check or rebuild.
    await onSave({ firstName: "Pat", lastName: "Lee", phone: "" }, { requestId: REQUEST, recordSale: false, attempt });
    const [args] = calls("clients.create");
    expect(args[1]).toBe(ids.ORG);
    expect((args[2] as { attempt: unknown }).attempt).toBe(attempt);
  });
});

describe("Contacts Edit Client lambda", () => {
  it("routes a first-policy edit to the receipt-bearing companion and keeps update for ordinary edits", async () => {
    render(<Contacts />);
    await waitFor(() => expect(screen.getAllByText(/Marcus/).length).toBeGreaterThan(0));
    const openEdit = async () => {
      const row = (await screen.findAllByText(/Marcus/))[0].closest("tr")!;
      const buttons = Array.from(row.querySelectorAll("button"));
      fireEvent.click(buttons[buttons.length - 1]);
      fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
      await waitFor(() => expect(modal.edit?.open).toBe(true));
      return modal.edit!.onSave as OnSave;
    };
    const firstPolicy = { carrier: "Synthetic Carrier", policyType: "Term", premiumAmount: "50", soldDate: "2026-10-03" };
    const attempt = newSaleAttempt();
    const commission = emptyCommissionPayload();
    await (await openEdit())(firstPolicy, { requestId: REQUEST, recordSale: true, commission, attempt });
    expect(calls("clients.updateWithPolicySaleHandoff")).toEqual([[attempt, ids.CLIENT, firstPolicy, REQUEST, commission]]);
    expect(calls("clients.update")).toHaveLength(0);
    await (await openEdit())({ notes: "Prefers mornings" });
    expect(calls("clients.update")).toEqual([[ids.CLIENT, { notes: "Prefers mornings" }]]);
    expect(calls("clients.updateWithPolicySaleHandoff")).toHaveLength(1);
  });
});
