/**
 * Post-save authority on the CONTACTS page's `FullScreenContactView` — client and recruit.
 *
 * THE GAP THESE PIN. The client and recruit handlers did:
 *
 *     await clientsSupabaseApi.update(id, data);
 *     fetchData();                                  // ← async; the parent stays STALE until it lands
 *
 * They discarded the canonical row the update returned and left `selectedClient` /
 * `selectedRecruit` carrying the PRE-save contact for the whole length of that list round trip.
 * `FullScreenContactView` reads the parent `contact` prop — not `editForm` — for Quick Call, SMS,
 * Email and the record header, so a just-corrected phone number was still dialable at its OLD
 * value until the refresh came back. Same class of defect as the deep-link page's, and exactly
 * what AGENT_RULES invariant #36 forbids: the authoritative UPDATE return must win IMMEDIATELY.
 *
 * HOW THE WINDOW IS MADE OBSERVABLE. `clientsSupabaseApi.getAll` / `recruitsSupabaseApi.getAll`
 * (what `fetchData` calls) are held PENDING for the duration of each assertion, so "the parent is
 * already correct" is proven while background reconciliation provably has not finished. If the fix
 * regressed to relying on `fetchData`, these tests would hang on a stale parent rather than pass.
 *
 * `FullScreenContactView` is replaced by a recorder that captures the `contact` prop on every
 * render — that prop IS the parent state these tests are about.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";

const ids = vi.hoisted(() => ({
  ORG: "11111111-1111-4111-8111-111111111111",
  USER: "00000000-0000-4000-8000-000000000001",
  CLIENT: "bbbbbbbb-0000-4000-8000-00000000000b",
  RECRUIT: "cccccccc-0000-4000-8000-00000000000c",
}));

const api = vi.hoisted(() => ({
  calls: [] as { name: string; args: unknown[] }[],
  updateRejectsWith: null as string | null,
  /** When set, the canonical update returns THIS instead of echoing the payload. */
  updateReturns: null as Record<string, unknown> | null,
  /** Held `getAll` promises — the background reconciliation `fetchData` is waiting on. */
  pendingLists: [] as (() => void)[],
  holdLists: false,
}));

const dbState = vi.hoisted(() => ({ duplicates: [] as Record<string, unknown>[] }));
const CONTACT_TABLES = new Set(["leads", "clients", "recruits"]);

vi.mock("@/integrations/supabase/client", () => {
  function makeBuilder(table: string) {
    const b: Record<string, unknown> = {
      select: () => b, eq: () => b, neq: () => b, in: () => b, or: () => b, not: () => b, is: () => b,
      order: () => b, range: () => b, limit: () => b, gte: () => b, lt: () => b,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      single: () => Promise.resolve({ data: null, error: null }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve(
          CONTACT_TABLES.has(table)
            ? { data: dbState.duplicates, error: null }
            : { data: [], error: null, count: 0 },
        ).then(resolve),
    };
    return b;
  }
  const rpcB: Record<string, unknown> = new Proxy({}, {
    get: (_t, p) =>
      p === "then"
        ? (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve)
        : () => rpcB,
  });
  return { supabase: { from: (t: string) => makeBuilder(t), rpc: () => rpcB, auth: {} } };
});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: ids.USER },
    profile: { id: ids.USER, organization_id: ids.ORG, role: "Admin" },
    isImpersonating: false,
    isBuildingOrganization: false,
  }),
}));
vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: ids.ORG, role: "Admin", isSuperAdmin: false }),
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
/** `getAll` — the call `fetchData` makes. Optionally held so reconciliation stays pending. */
function recordList(name: string, value: unknown) {
  return (...args: unknown[]) => {
    api.calls.push({ name, args });
    if (!api.holdLists) return Promise.resolve(value);
    return new Promise((resolve) => { api.pendingLists.push(() => resolve(value)); });
  };
}
function recordUpdate(name: string) {
  return (...args: unknown[]) => {
    api.calls.push({ name, args });
    if (api.updateRejectsWith) return Promise.reject(new Error(api.updateRejectsWith));
    if (api.updateReturns) return Promise.resolve(api.updateReturns);
    return Promise.resolve({ id: args[0], ...(args[1] as Record<string, unknown>) });
  };
}

/**
 * Fixtures live in `vi.hoisted` because the `vi.mock` factories below are hoisted above ordinary
 * top-level consts AND evaluate these values at factory time (they are baked into the `getAll`
 * recorders). A plain `const` here throws "Cannot access 'CLIENT_ROW' before initialization".
 */
const rows = vi.hoisted(() => ({
  client: {
    id: "bbbbbbbb-0000-4000-8000-00000000000b", firstName: "Marcus", lastName: "Webb",
    phone: "5125550124", email: "marcus@example.com", state: "TX",
    assignedAgentId: "00000000-0000-4000-8000-000000000001",
  } as Record<string, unknown>,
  recruit: {
    id: "cccccccc-0000-4000-8000-00000000000c", firstName: "Dana", lastName: "Olsen",
    phone: "5125550125", email: "dana@example.com", state: "TX",
    assignedAgentId: "00000000-0000-4000-8000-000000000001",
  } as Record<string, unknown>,
}));
const CLIENT_ROW = rows.client;
const RECRUIT_ROW = rows.recruit;

const detail = vi.hoisted(() => ({ open: "client" as "client" | "recruit" }));

vi.mock("@/lib/supabase-contacts", () => ({
  leadsSupabaseApi: {
    getAll: record("leads.getAll", { data: [], totalCount: 0 }),
    getById: () => { api.calls.push({ name: "leads.getById", args: [] }); return Promise.reject(new Error("not a lead")); },
    getByIds: record("leads.getByIds", []),
    getKanban: record("leads.getKanban", { columns: [] }),
    create: record("leads.create", {}),
    update: recordUpdate("leads.update"),
  },
  rowToLead: (r: Record<string, unknown>) => r,
}));
vi.mock("@/lib/supabase-clients", () => ({
  clientsSupabaseApi: {
    getAll: recordList("clients.getAll", { data: [rows.client], totalCount: 1 }),
    getById: (...args: unknown[]) => {
      api.calls.push({ name: "clients.getById", args });
      return detail.open === "client" ? Promise.resolve(rows.client) : Promise.reject(new Error("not a client"));
    },
    create: record("clients.create", {}),
    update: recordUpdate("clients.update"),
  },
  rowToClient: (r: Record<string, unknown>) => r,
}));
vi.mock("@/lib/supabase-recruits", () => ({
  recruitsSupabaseApi: {
    getAll: recordList("recruits.getAll", { data: [rows.recruit], totalCount: 1 }),
    getById: (...args: unknown[]) => {
      api.calls.push({ name: "recruits.getById", args });
      return detail.open === "recruit" ? Promise.resolve(rows.recruit) : Promise.reject(new Error("not a recruit"));
    },
    getKanban: record("recruits.getKanban", { columns: [] }),
    create: record("recruits.create", {}),
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

const routerState = vi.hoisted(() => ({ params: new URLSearchParams("tab=Clients") }));
vi.mock("react-router-dom", () => ({
  useNavigate: () => () => {},
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
 * The detail view, as a recorder. `contact` is the PARENT state under test — the prop Quick Call,
 * SMS, Email and the header actually read.
 */
const view = vi.hoisted(() => ({
  contact: null as Record<string, unknown> | null,
  onUpdate: null as null | ((id: string, data: Record<string, unknown>) => Promise<void>),
}));
vi.mock("@/components/contacts/FullScreenContactView", () => ({
  default: (props: Record<string, unknown>) => {
    view.contact = props.contact as Record<string, unknown> | null;
    view.onUpdate = props.onUpdate as typeof view.onUpdate;
    return React.createElement("div", { "data-testid": "full-screen-contact" });
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

type Kind = "client" | "recruit";
const ID_OF: Record<Kind, string> = { client: ids.CLIENT, recruit: ids.RECRUIT };
const ROW_OF: Record<Kind, Record<string, unknown>> = { client: CLIENT_ROW, recruit: RECRUIT_ROW };
const TAB_OF: Record<Kind, string> = { client: "Clients", recruit: "Recruits" };

/** How many `getAll` reconciliations are still in flight. */
const pendingReconciliations = () => api.pendingLists.length;

beforeEach(() => {
  api.calls = []; api.updateRejectsWith = null; api.updateReturns = null;
  api.pendingLists = []; api.holdLists = false;
  dbState.duplicates = [];
  settingsState.value = { manualAction: "allow" };
  toasts.success = []; toasts.error = [];
  view.contact = null; view.onUpdate = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

async function openDetail(kind: Kind) {
  detail.open = kind;
  routerState.params = new URLSearchParams(`tab=${TAB_OF[kind]}&contact=${ID_OF[kind]}`);
  render(<Contacts />);
  await waitFor(() => expect(screen.getByTestId("full-screen-contact")).toBeInTheDocument());
  await waitFor(() => expect(view.contact?.id).toBe(ID_OF[kind]));
  // From here on, every list refresh is HELD so the reconciliation window stays open.
  api.holdLists = true;
  api.pendingLists = [];
  api.calls = [];
}

/** The whole-form payload FullScreenContactView submits. */
const wholeForm = (kind: Kind, over: Record<string, unknown>) => ({ ...ROW_OF[kind], ...over });

describe.each(["client", "recruit"] as Kind[])(
  "Contacts full-screen — %s: the returned row becomes the parent IMMEDIATELY",
  (kind) => {
    it("a phone change A -> B is on the parent before reconciliation finishes", async () => {
      await openDetail(kind);
      expect(view.contact?.phone).toBe(ROW_OF[kind].phone);

      await view.onUpdate!(ID_OF[kind], wholeForm(kind, { phone: "15125559999" }));

      // The authoritative row is already the parent...
      await waitFor(() => expect(view.contact?.phone).toBe("15125559999"));
      // ...while the background list refresh provably has NOT come back yet.
      expect(pendingReconciliations()).toBeGreaterThan(0);
      // So no contact action can observe the old number in this window.
      expect(view.contact?.phone).not.toBe(ROW_OF[kind].phone);
    });

    it("a name and email change is on the parent before reconciliation finishes", async () => {
      await openDetail(kind);

      await view.onUpdate!(ID_OF[kind], wholeForm(kind, { lastName: "Renamed", email: "new@example.com" }));

      await waitFor(() => expect(view.contact?.lastName).toBe("Renamed"));
      expect(view.contact?.email).toBe("new@example.com");
      expect(pendingReconciliations()).toBeGreaterThan(0);
    });

    it("SERVER-normalized values win over the submitted ones", async () => {
      await openDetail(kind);
      // Stands in for normalizeUsState / parseCurrencyToNumberOrNull / normalizeDateOrNull:
      // what the database stored differs from what was typed.
      api.updateReturns = { ...ROW_OF[kind], state: "TX", phone: "15125559999", updatedAt: "2026-09-20T00:00:00Z" };

      await view.onUpdate!(ID_OF[kind], wholeForm(kind, { state: "texas", phone: "5125559999" }));

      await waitFor(() => expect(view.contact?.state).toBe("TX"));
      expect(view.contact?.state).not.toBe("texas");
      expect(view.contact?.phone).toBe("15125559999");
      expect(pendingReconciliations()).toBeGreaterThan(0);
    });

    it("the reconciliation refresh is SILENT, and still runs", async () => {
      await openDetail(kind);
      await view.onUpdate!(ID_OF[kind], wholeForm(kind, { phone: "15125559999" }));

      await waitFor(() => expect(view.contact?.phone).toBe("15125559999"));
      // The list/count reconciliation was still dispatched — the immediate install replaces the
      // stale window, not the refresh.
      expect(api.calls.some((c) => c.name === `${kind}s.getAll`)).toBe(true);
    });

    it("a FAILED update replaces nothing on the parent", async () => {
      await openDetail(kind);
      api.updateRejectsWith = "permission denied";

      await expect(
        view.onUpdate!(ID_OF[kind], wholeForm(kind, { phone: "15125559999" })),
      ).rejects.toThrow("permission denied");

      expect(view.contact?.phone).toBe(ROW_OF[kind].phone);
      expect(view.contact?.lastName).toBe(ROW_OF[kind].lastName);
      expect(toasts.success).toEqual([]);
    });

    it("a REFUSED save replaces nothing on the parent and issues no UPDATE", async () => {
      settingsState.value = { manualAction: "block" };
      await openDetail(kind);
      dbState.duplicates = [{
        id: "existing-duplicate", first_name: "Someone", last_name: "Else",
        phone: "15125559999", email: "someone@example.com", assigned_agent_id: ids.USER,
      }];

      await expect(
        view.onUpdate!(ID_OF[kind], wholeForm(kind, { phone: "15125559999" })),
      ).rejects.toBeInstanceOf(ContactSaveRefusedError);

      expect(api.calls.filter((c) => c.name === `${kind}s.update`)).toHaveLength(0);
      expect(view.contact?.phone).toBe(ROW_OF[kind].phone);
      expect(toasts.error.some((t) => /blocked by agency settings/i.test(t))).toBe(true);
    });

    it("an update for a DIFFERENT id leaves the open record alone", async () => {
      await openDetail(kind);

      // A whole-form payload, as FullScreenContactView always sends — but for another record.
      // The id guards on `setSelectedClient` / `setSelectedRecruit` are what must hold here.
      await view.onUpdate!("some-other-id", wholeForm(kind, { id: "some-other-id", phone: "15125550000" }));

      expect(api.calls.filter((c) => c.name === `${kind}s.update`)).toHaveLength(1);
      expect(view.contact?.id).toBe(ID_OF[kind]);
      expect(view.contact?.phone).toBe(ROW_OF[kind].phone);
    });

    it("the pre-save check merges the CURRENT record, so a partial payload is not falsely refused", async () => {
      // `enforceContactPreSave` also checks locked required fields (First/Last/Phone). The handler
      // passes `{ ...current, ...data }`, so a partial payload for the OPEN record still carries a
      // name and is correctly allowed — only the changed keys are written.
      await openDetail(kind);

      await expect(
        view.onUpdate!(ID_OF[kind], { phone: "15125550000" } as Record<string, unknown>),
      ).resolves.toBeUndefined();

      const update = api.calls.filter((c) => c.name === `${kind}s.update`);
      expect(update).toHaveLength(1);
      expect(update[0].args[1]).toEqual({ phone: "15125550000" });
      // And the returned row still lands on the parent immediately.
      await waitFor(() => expect(view.contact?.phone).toBe("15125550000"));
    });
  },
);
