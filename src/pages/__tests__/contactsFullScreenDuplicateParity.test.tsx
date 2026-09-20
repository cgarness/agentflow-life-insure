/**
 * Duplicate-detection parity on the CONTACTS page's `FullScreenContactView` — leads, clients and
 * recruits (decisions D-2b and D-3).
 *
 * THE GAP THESE PIN. The agency's Contact Management settings were enforced by the Add / Edit
 * modals for all three contact types, and by the lead full-screen view, but NOT by the client or
 * recruit full-screen views — those wired `onUpdate` straight to
 * `clientsSupabaseApi.update` / `recruitsSupabaseApi.update`. So the same edit the Edit-Client
 * modal blocked went through untouched from the full-screen record.
 *
 * A REFUSAL MUST REJECT. `FullScreenContactView` treats a resolved `onUpdate` as proof the write
 * happened. `handleUpdateLead` used to turn a blocked duplicate — and a cancelled warning, and a
 * genuine PostgREST failure — into a plain `return`, so the view exited edit mode, wrote a
 * "Lead details updated" activity row and toasted "Lead updated successfully" for a write that
 * never occurred. These tests drive the page's REAL `onUpdate` handlers and assert on the promise.
 *
 * The REAL `Contacts` page, the REAL `enforceContactPreSave` and the REAL `findDuplicates` run
 * here; `FullScreenContactView` is replaced by a recorder that captures the `onUpdate` prop, and
 * the canonical contact APIs are recorders so "zero UPDATEs" is an assertion about calls made.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent, within } from "@testing-library/react";

const ids = vi.hoisted(() => ({
  ORG: "11111111-1111-4111-8111-111111111111",
  USER: "00000000-0000-4000-8000-000000000001",
  LEAD: "aaaaaaaa-0000-4000-8000-00000000000a",
  CLIENT: "bbbbbbbb-0000-4000-8000-00000000000b",
  RECRUIT: "cccccccc-0000-4000-8000-00000000000c",
}));

/** Every canonical contact-API call, so "issued no UPDATE" is about calls that really happened. */
const api = vi.hoisted(() => ({
  calls: [] as { name: string; args: unknown[] }[],
  updateRejectsWith: null as string | null,
}));

/** Rows the REAL `findDuplicates` will see. */
const dbState = vi.hoisted(() => ({
  duplicates: [] as Record<string, unknown>[],
  lookups: [] as { table: string; eq: [string, unknown][]; neq: [string, unknown][] }[],
  lookupFails: false,
}));

const CONTACT_TABLES = new Set(["leads", "clients", "recruits"]);

vi.mock("@/integrations/supabase/client", () => {
  function makeBuilder(table: string) {
    const eq: [string, unknown][] = [];
    const neq: [string, unknown][] = [];
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (c: string, v: unknown) => { eq.push([c, v]); return b; },
      neq: (c: string, v: unknown) => { neq.push([c, v]); return b; },
      in: () => b, or: () => b, not: () => b, is: () => b,
      order: () => b, range: () => b, limit: () => b, gte: () => b, lt: () => b,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      single: () => Promise.resolve({ data: null, error: null }),
      then(resolve: (v: unknown) => unknown) {
        if (CONTACT_TABLES.has(table)) {
          dbState.lookups.push({ table, eq, neq });
          if (dbState.lookupFails) {
            return Promise.resolve({ data: null, error: { message: "permission denied" } }).then(resolve);
          }
          return Promise.resolve({ data: dbState.duplicates, error: null }).then(resolve);
        }
        return Promise.resolve({ data: [], error: null, count: 0 }).then(resolve);
      },
    };
    return b;
  }
  // A thenable that is also chainable. Written without a `never` cast so it adds no new
  // type error to the repository's baseline (the older Contacts suite's version does).
  const rpcB: Record<string, unknown> = new Proxy({}, {
    get: (_t, p) =>
      p === "then"
        ? (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve)
        : () => rpcB,
  });
  return { supabase: { from: (t: string) => makeBuilder(t), rpc: () => rpcB, auth: {} } };
});

const authState = vi.hoisted(() => ({ organizationId: "11111111-1111-4111-8111-111111111111" }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: ids.USER },
    profile: { id: ids.USER, organization_id: authState.organizationId, role: "Admin" },
    isImpersonating: false,
    isBuildingOrganization: false,
  }),
}));
vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: authState.organizationId, role: "Admin", isSuperAdmin: false }),
}));
vi.mock("@/contexts/BrandingContext", () => ({
  useBranding: () => ({ formatDate: (v: unknown) => String(v ?? ""), formatDateTime: (v: unknown) => String(v ?? "") }),
}));

const scopeMock = vi.hoisted(() => ({
  scope: "mine", availableScopes: ["mine"], maxScope: "all",
  teamAgents: [] as never[], teamAgentIds: [] as string[],
  hasDownline: false, ready: true, prefError: false, setScope: () => {},
}));
vi.mock("@/hooks/useContactScope", () => ({ useContactScope: () => scopeMock }));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasContactsPermission: () => true, getDataScope: () => "own", isLoading: false }),
}));

const toasts = vi.hoisted(() => ({ success: [] as string[], error: [] as string[] }));
vi.mock("sonner", () => ({
  toast: {
    success: (m: unknown) => { toasts.success.push(String(m)); },
    error: (m: unknown) => { toasts.error.push(String(m)); },
    message: () => {}, info: () => {},
  },
}));

function record(name: string, value: unknown) {
  return (...args: unknown[]) => { api.calls.push({ name, args }); return Promise.resolve(value); };
}
function recordUpdate(name: string) {
  return (...args: unknown[]) => {
    api.calls.push({ name, args });
    if (api.updateRejectsWith) return Promise.reject(new Error(api.updateRejectsWith));
    return Promise.resolve({ id: args[0], ...(args[1] as Record<string, unknown>) });
  };
}

const LEAD_ROW = { id: ids.LEAD, firstName: "Charlotte", lastName: "Kearney", phone: "5125550123", email: "charlotte@example.com", assignedAgentId: ids.USER };
const CLIENT_ROW = { id: ids.CLIENT, firstName: "Marcus", lastName: "Webb", phone: "5125550124", email: "marcus@example.com", assignedAgentId: ids.USER };
const RECRUIT_ROW = { id: ids.RECRUIT, firstName: "Dana", lastName: "Olsen", phone: "5125550125", email: "dana@example.com", assignedAgentId: ids.USER };

const detail = vi.hoisted(() => ({ open: "lead" as "lead" | "client" | "recruit" }));

vi.mock("@/lib/supabase-contacts", () => ({
  leadsSupabaseApi: {
    getAll: record("leads.getAll", { data: [], totalCount: 0 }),
    getById: (...args: unknown[]) => {
      api.calls.push({ name: "leads.getById", args });
      return detail.open === "lead"
        ? Promise.resolve({ lead: LEAD_ROW, notes: [], activities: [], calls: [] })
        : Promise.reject(new Error("not a lead"));
    },
    getByIds: record("leads.getByIds", []),
    getKanban: record("leads.getKanban", { columns: [] }),
    create: record("leads.create", { id: ids.LEAD }),
    update: recordUpdate("leads.update"),
  },
  rowToLead: (r: Record<string, unknown>) => r,
}));
vi.mock("@/lib/supabase-clients", () => ({
  clientsSupabaseApi: {
    getAll: record("clients.getAll", { data: [], totalCount: 0 }),
    getById: (...args: unknown[]) => {
      api.calls.push({ name: "clients.getById", args });
      return detail.open === "client" ? Promise.resolve(CLIENT_ROW) : Promise.reject(new Error("not a client"));
    },
    create: record("clients.create", { id: ids.CLIENT }),
    update: recordUpdate("clients.update"),
  },
  rowToClient: (r: Record<string, unknown>) => r,
}));
vi.mock("@/lib/supabase-recruits", () => ({
  recruitsSupabaseApi: {
    getAll: record("recruits.getAll", { data: [], totalCount: 0 }),
    getById: (...args: unknown[]) => {
      api.calls.push({ name: "recruits.getById", args });
      return detail.open === "recruit" ? Promise.resolve(RECRUIT_ROW) : Promise.reject(new Error("not a recruit"));
    },
    getKanban: record("recruits.getKanban", { columns: [] }),
    create: record("recruits.create", { id: ids.RECRUIT }),
    update: recordUpdate("recruits.update"),
  },
  rowToRecruit: (r: Record<string, unknown>) => r,
}));
vi.mock("@/lib/supabase-users", () => ({
  usersSupabaseApi: {
    getAgentScopeIds: record("users.getAgentScopeIds", [ids.USER]),
    getByIds: record("users.getByIds", []),
    getAll: record("users.getAll", []),
    getById: record("users.getById", null),
  },
}));

const settingsState = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }));
vi.mock("@/lib/supabase-settings", () => ({
  pipelineSupabaseApi: { getLeadStages: vi.fn(async () => []), getRecruitStages: vi.fn(async () => []) },
  customFieldsSupabaseApi: { getAll: vi.fn(async () => []) },
  leadSourcesSupabaseApi: { getAll: vi.fn(async () => []) },
  contactManagementSettingsSupabaseApi: { getSettings: vi.fn(async () => settingsState.value) },
}));
vi.mock("@/lib/supabase-notes", () => ({ notesSupabaseApi: { getByContact: vi.fn(async () => []) } }));

const routerState = vi.hoisted(() => ({ params: new URLSearchParams("tab=Leads"), navigations: [] as string[] }));
vi.mock("react-router-dom", () => ({
  useNavigate: () => (to: string) => { routerState.navigations.push(to); },
  useLocation: () => ({ state: null, pathname: "/contacts", search: "", hash: "", key: "t" }),
  useSearchParams: () => [
    routerState.params,
    (next: unknown) => {
      routerState.params = typeof next === "function"
        ? (next as (p: URLSearchParams) => URLSearchParams)(routerState.params)
        : (next as URLSearchParams);
    },
  ],
}));

/**
 * The detail view, as a recorder. It captures the page's REAL `onUpdate` on every render so the
 * test can drive `handleUpdateLead` / `handleUpdateClient` / `handleUpdateRecruit` directly and
 * assert on the promise they return — which is the whole contract under test.
 */
const view = vi.hoisted(() => ({
  onUpdate: null as null | ((id: string, data: Record<string, unknown>) => Promise<void>),
  type: "" as string,
}));
vi.mock("@/components/contacts/FullScreenContactView", () => ({
  default: (props: Record<string, unknown>) => {
    view.onUpdate = props.onUpdate as typeof view.onUpdate;
    view.type = String(props.type ?? "");
    return React.createElement("div", { "data-testid": "full-screen-contact" }, String(props.type));
  },
}));

function marker(id: string) {
  return { default: () => React.createElement("div", { "data-testid": id }) };
}
vi.mock("@/components/contacts/AddLeadModal", () => marker("add-lead-modal"));
vi.mock("@/components/contacts/AddClientModal", () => marker("add-client-modal"));
vi.mock("@/components/contacts/AddRecruitModal", () => marker("add-recruit-modal"));
vi.mock("@/components/contacts/AddToCampaignModal", () => marker("add-to-campaign-modal"));
vi.mock("@/components/contacts/DeleteConfirmModal", () => marker("delete-confirm-modal"));
vi.mock("@/components/contacts/ConvertLeadModal", () => marker("convert-lead-modal"));
vi.mock("@/components/contacts/AgentModal", () => marker("agent-modal"));
vi.mock("@/components/contacts/ContactsFilterModal", () => marker("filter-modal"));
vi.mock("@/components/contacts/ContactScopeSelector", () => marker("scope-selector"));
vi.mock("@/components/contacts/ContactKanbanBoard", () => ({
  ContactKanbanBoard: () => React.createElement("div", { "data-testid": "kanban-board" }),
}));
vi.mock("@/components/PermissionGate", () => ({
  PermissionGate: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  CommissionGate: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import Contacts from "@/pages/Contacts";
import { ContactSaveRefusedError } from "@/lib/contactSavePolicy";

type Kind = "lead" | "client" | "recruit";
const ID_OF: Record<Kind, string> = { lead: ids.LEAD, client: ids.CLIENT, recruit: ids.RECRUIT };
const TABLE_OF: Record<Kind, string> = { lead: "leads", client: "clients", recruit: "recruits" };
const ROW_OF: Record<Kind, Record<string, unknown>> = { lead: LEAD_ROW, client: CLIENT_ROW, recruit: RECRUIT_ROW };

const updateCalls = (kind: Kind) => api.calls.filter((c) => c.name === `${TABLE_OF[kind]}.update`);

beforeEach(() => {
  api.calls = []; api.updateRejectsWith = null;
  dbState.duplicates = []; dbState.lookups = []; dbState.lookupFails = false;
  settingsState.value = null;
  toasts.success = []; toasts.error = [];
  view.onUpdate = null; view.type = "";
  routerState.params = new URLSearchParams("tab=Leads");
  routerState.navigations = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

/** Mount Contacts with the given contact open in the full-screen view. */
async function openDetail(kind: Kind) {
  detail.open = kind;
  routerState.params = new URLSearchParams(`tab=Leads&contact=${ID_OF[kind]}`);
  render(<Contacts />);
  await waitFor(() => expect(screen.getByTestId("full-screen-contact")).toBeInTheDocument());
  await waitFor(() => expect(view.type).toBe(kind));
}

/** The whole-form payload FullScreenContactView submits, with a changed phone. */
const wholeForm = (kind: Kind) => ({ ...ROW_OF[kind], phone: "15125559999" });

const duplicateRow = (phone: string) => ({
  id: "existing-duplicate", first_name: "Someone", last_name: "Else",
  phone, email: "someone@example.com", assigned_agent_id: ids.USER,
});

describe.each(["lead", "client", "recruit"] as Kind[])(
  "Contacts full-screen — %s: the agency's duplicate settings are enforced",
  (kind) => {
    it("manual_action = block → the save REJECTS as a refusal and issues zero UPDATEs", async () => {
      settingsState.value = { manualAction: "block" };
      await openDetail(kind);
      dbState.duplicates = [duplicateRow("15125559999")];

      await expect(view.onUpdate!(ID_OF[kind], wholeForm(kind))).rejects.toBeInstanceOf(ContactSaveRefusedError);

      expect(updateCalls(kind)).toHaveLength(0);
      expect(toasts.error.some((t) => /blocked by agency settings/i.test(t))).toBe(true);
      expect(toasts.success).toEqual([]);
    });

    it("manual_action = warn + Cancel → the save REJECTS and issues zero UPDATEs", async () => {
      settingsState.value = { manualAction: "warn" };
      await openDetail(kind);
      dbState.duplicates = [duplicateRow("15125559999")];

      const pending = view.onUpdate!(ID_OF[kind], wholeForm(kind));
      const assertion = expect(pending).rejects.toBeInstanceOf(ContactSaveRefusedError);

      const dialog = await screen.findByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: /^cancel$/i }));
      await assertion;

      expect(updateCalls(kind)).toHaveLength(0);
      expect(toasts.success).toEqual([]);
    });

    it("manual_action = warn + Save Anyway → exactly ONE canonical UPDATE", async () => {
      settingsState.value = { manualAction: "warn" };
      await openDetail(kind);
      dbState.duplicates = [duplicateRow("15125559999")];

      const pending = view.onUpdate!(ID_OF[kind], wholeForm(kind));
      const dialog = await screen.findByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: /save anyway/i }));
      await expect(pending).resolves.toBeUndefined();

      expect(updateCalls(kind)).toHaveLength(1);
      expect((updateCalls(kind)[0].args[1] as Record<string, unknown>).phone).toBe("15125559999");
    });

    it("manual_action = allow → one UPDATE, no prompt", async () => {
      settingsState.value = { manualAction: "allow" };
      await openDetail(kind);
      dbState.duplicates = [duplicateRow("15125559999")];

      await expect(view.onUpdate!(ID_OF[kind], wholeForm(kind))).resolves.toBeUndefined();

      expect(updateCalls(kind)).toHaveLength(1);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("no duplicate match → one UPDATE, no prompt", async () => {
      settingsState.value = { manualAction: "block" };
      await openDetail(kind);
      dbState.duplicates = [];

      await expect(view.onUpdate!(ID_OF[kind], wholeForm(kind))).resolves.toBeUndefined();
      expect(updateCalls(kind)).toHaveLength(1);
    });

    it("the lookup is org-scoped, hits the right table, and excludes the contact's OWN id", async () => {
      settingsState.value = { manualAction: "block" };
      await openDetail(kind);
      dbState.lookups = [];

      await view.onUpdate!(ID_OF[kind], wholeForm(kind)).catch(() => {});

      expect(dbState.lookups).toHaveLength(1);
      expect(dbState.lookups[0].table).toBe(TABLE_OF[kind]);
      expect(dbState.lookups[0].eq).toContainEqual(["organization_id", ids.ORG]);
      expect(dbState.lookups[0].neq).toContainEqual(["id", ID_OF[kind]]);
    });

    it("a { status }-only payload runs NO duplicate lookup", async () => {
      settingsState.value = { manualAction: "block" };
      await openDetail(kind);
      dbState.duplicates = [duplicateRow("15125559999")];
      dbState.lookups = [];

      await expect(view.onUpdate!(ID_OF[kind], { status: "Contacted" })).resolves.toBeUndefined();

      expect(dbState.lookups).toHaveLength(0);
      expect(updateCalls(kind)).toHaveLength(1);
    });

    it("a genuine UPDATE failure REJECTS rather than resolving as a success", async () => {
      settingsState.value = { manualAction: "allow" };
      await openDetail(kind);
      api.updateRejectsWith = "permission denied";

      await expect(view.onUpdate!(ID_OF[kind], wholeForm(kind))).rejects.toThrow("permission denied");

      expect(toasts.success).toEqual([]);
    });

    it("a duplicate-lookup FAILURE does not block the save (documented fail-open posture)", async () => {
      settingsState.value = { manualAction: "block" };
      await openDetail(kind);
      // `findDuplicates` throws on a query error; the policy logs it and resolves to `allow`, so an
      // advisory agency preference never strands an agent on a transient RLS/PostgREST failure.
      dbState.duplicates = [duplicateRow("15125559999")];
      dbState.lookupFails = true;

      await expect(view.onUpdate!(ID_OF[kind], wholeForm(kind))).resolves.toBeUndefined();
      expect(dbState.lookups.length).toBeGreaterThan(0);
      expect(updateCalls(kind)).toHaveLength(1);
      expect(toasts.error.some((t) => /blocked by agency settings/i.test(t))).toBe(false);
    });
  },
);

describe("Contacts full-screen — the refusal is reported once, not twice", () => {
  it("block reports the agency reason exactly once and marks the refusal as already reported", async () => {
    settingsState.value = { manualAction: "block" };
    await openDetail("lead");
    dbState.duplicates = [duplicateRow("15125559999")];

    let caught: unknown;
    await view.onUpdate!(ids.LEAD, wholeForm("lead")).catch((e) => { caught = e; });

    expect(caught).toBeInstanceOf(ContactSaveRefusedError);
    expect((caught as ContactSaveRefusedError).reported).toBe(true);
    expect(toasts.error.filter((t) => /blocked by agency settings/i.test(t))).toHaveLength(1);
  });
});
