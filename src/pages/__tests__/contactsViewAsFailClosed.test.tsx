/**
 * Contacts under "View As" — fail-closed, not merely un-rendered.
 *
 * THE DEFECT THIS PINS. `contactGridsBlockedByViewAs` suppressed the four grid RENDERS and gated
 * `fetchData`, and that was read as "Contacts is safe under View As". It was not:
 *
 *   1. `fetchKanban` carried no such guard. The board's RPCs still executed against the REAL
 *      session user; only the board's paint was suppressed. A guard that stops the paint but not
 *      the request is not a fail-closed guard.
 *   2. The deep-link machinery is NOT tab-scoped. `?contact=`, the legacy `?id=`, and the
 *      `openContactId` navigation state all run on Import History and Agents too — the two tabs
 *      "View As" DOES support — so a lead deep link opened while impersonating still fired
 *      `leadsSupabaseApi.getById`, then the client and recruit fallbacks, and mounted
 *      `FullScreenContactView` over an impersonated session.
 *   3. "Add Lead / Client / Recruit" and "Import CSV" rendered beside the panel that says contacts
 *      are unavailable, so the create path stayed reachable — which is what made the unmigrated
 *      `handleAddLead` ownership fallback (`?? user?.id`) live rather than theoretical.
 *
 * The Supabase client and every contact API are mocked as RECORDERS, so "issued no query" is an
 * assertion about calls actually made, and the modals/detail views render identifiable markers so
 * "never mounted" is observable.
 */

import React from "react";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `vi.mock` factories are hoisted above ordinary top-level consts, so every identifier a factory
 * touches has to be created inside `vi.hoisted` — otherwise the factory runs first and throws
 * "Cannot access 'uid' before initialization".
 */
const ids = vi.hoisted(() => {
  const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  return { OPERATOR: uid(1), VIEWED: uid(2), LEAD: uid(9), CLIENT: uid(11), RECRUIT: uid(12) };
});
const { OPERATOR, VIEWED, LEAD } = ids;
const ORG = "11111111-1111-4111-8111-111111111111";

/** Every contact-API call, by name. The fail-closed assertions read this. */
const api = vi.hoisted(() => ({
  calls: [] as string[],
  lastAddLeadSave: null as null | ((d: Record<string, unknown>, meta?: Record<string, unknown>) => Promise<void>),
}));
const dbState = vi.hoisted(() => ({ tables: [] as string[], rpcs: [] as string[] }));

const authState = vi.hoisted(() => ({
  userId: "00000000-0000-4000-8000-000000000001",
  profileId: "00000000-0000-4000-8000-000000000001",
  role: "Agent",
  isSuperAdmin: false,
  isImpersonating: false,
  organizationId: "11111111-1111-4111-8111-111111111111",
}));

const routerState = vi.hoisted(() => ({
  params: new URLSearchParams("tab=Leads"),
  locationState: null as Record<string, unknown> | null,
  navigations: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => {
  function makeBuilder(table: string) {
    dbState.tables.push(table);
    const b: Record<string, unknown> = {
      select() { return b; }, eq() { return b; }, in() { return b; }, or() { return b; },
      neq() { return b; }, order() { return b; }, range() { return b; }, limit() { return b; },
      maybeSingle() { return Promise.resolve({ data: null, error: null }); },
      single() { return Promise.resolve({ data: null, error: null }); },
      then(resolve: (v: unknown) => unknown) {
        return Promise.resolve({ data: [], error: null, count: 0 }).then(resolve);
      },
    };
    return b;
  }
  const rpcRes = Promise.resolve({ data: [], error: null });
  const rpcB: Record<string, unknown> = new Proxy({}, {
    get: (_t, p) => (p === "then" ? (rpcRes as never as { then: never }).then.bind(rpcRes) : () => rpcB),
  });
  return {
    supabase: {
      from: (t: string) => makeBuilder(t),
      rpc: (name: string) => { dbState.rpcs.push(name); return rpcB; },
      auth: {},
    },
  };
});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: authState.userId },
    profile: { id: authState.profileId, organization_id: authState.organizationId, role: authState.role },
    isImpersonating: authState.isImpersonating,
    isBuildingOrganization: false,
  }),
}));
vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => ({
    organizationId: authState.organizationId,
    role: authState.role,
    isSuperAdmin: authState.isSuperAdmin,
  }),
}));
vi.mock("@/contexts/BrandingContext", () => ({
  useBranding: () => ({ formatDate: (v: unknown) => String(v ?? ""), formatDateTime: (v: unknown) => String(v ?? "") }),
}));
/**
 * STABLE references, exactly like production. `useContactScope` memoizes `teamAgents`,
 * `teamAgentIds` and `availableScopes` (`useMemo` / state), so their identities survive a render.
 * An earlier version of this mock returned FRESH `[]` literals on every call — those identities
 * fed effect dependency arrays in `Contacts`, so every render invalidated every dependent effect
 * and the page churned without ever settling. That churn was mis-diagnosed as a production
 * "unbounded render loop" on the impersonated Kanban path; it was this mock's infidelity, and the
 * transition test below only became possible once the mock told the truth.
 */
const scopeMock = vi.hoisted(() => {
  const stable = {
    scope: "mine", availableScopes: ["mine"], maxScope: "all",
    teamAgents: [] as never[], teamAgentIds: [] as string[],
    hasDownline: false, ready: true, prefError: false,
    setScope: () => {},
  };
  return stable;
});
vi.mock("@/hooks/useContactScope", () => ({
  useContactScope: () => scopeMock,
}));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasContactsPermission: () => true, getDataScope: () => "own", isLoading: false }),
}));

// ── The contact APIs, as recorders ────────────────────────────────────────────────────────────
function record<T>(name: string, value: T) {
  return (...__args: unknown[]) => { api.calls.push(name); return Promise.resolve(value); };
}
vi.mock("@/lib/supabase-contacts", () => ({
  leadsSupabaseApi: {
    getAll: record("leads.getAll", { data: [], totalCount: 0 }),
    getById: record("leads.getById", { lead: { id: ids.LEAD, firstName: "Deep", lastName: "Link" } }),
    getByIds: record("leads.getByIds", []),
    getKanban: record("leads.getKanban", { columns: [] }),
    create: record("leads.create", { id: ids.LEAD }),
    update: record("leads.update", {}),
  },
}));
vi.mock("@/lib/supabase-clients", () => ({
  clientsSupabaseApi: {
    getAll: record("clients.getAll", { data: [], totalCount: 0 }),
    getById: record("clients.getById", { id: ids.CLIENT }),
    create: record("clients.create", { id: ids.CLIENT }),
    update: record("clients.update", {}),
  },
}));
vi.mock("@/lib/supabase-recruits", () => ({
  recruitsSupabaseApi: {
    getAll: record("recruits.getAll", { data: [], totalCount: 0 }),
    getById: record("recruits.getById", { id: ids.RECRUIT }),
    getKanban: record("recruits.getKanban", { columns: [] }),
    create: record("recruits.create", { id: ids.RECRUIT }),
    update: record("recruits.update", {}),
  },
}));
vi.mock("@/lib/supabase-users", () => ({
  usersSupabaseApi: {
    getAgentScopeIds: record("users.getAgentScopeIds", [ids.VIEWED]),
    getByIds: record("users.getByIds", []),
    getAll: record("users.getAll", []),
    getById: record("users.getById", null),
  },
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => (to: string) => { routerState.navigations.push(to); },
  useLocation: () => ({ state: routerState.locationState, pathname: "/contacts", search: "", hash: "", key: "t" }),
  useSearchParams: () => [
    routerState.params,
    (next: unknown) => {
      routerState.params = typeof next === "function"
        ? (next as (p: URLSearchParams) => URLSearchParams)(routerState.params)
        : (next as URLSearchParams);
    },
  ],
}));

// ── Mutation surfaces render IDENTIFIABLE markers so "never mounted" is observable ─────────────
// A `function` declaration, not a `const` arrow: `vi.mock` factories are hoisted above `const`
// initialisers, so an arrow here throws "Cannot access 'marker' before initialization".
function marker(id: string) {
  return { default: () => React.createElement("div", { "data-testid": id }) };
}
vi.mock("@/components/contacts/FullScreenContactView", () => marker("full-screen-contact"));
vi.mock("@/components/contacts/AddLeadModal", () => ({
  // Records the page's real `onSave` so `handleAddLead` can be driven directly. The marker is kept
  // so the "never mounts under View As" assertion still works.
  //
  // The page mounts AddLeadModal TWICE — once to create (no `initial`) and once to edit
  // (`initial={editLead}`) — and the edit instance renders second. Capturing unconditionally
  // therefore grabbed the EDIT handler, whose body is `if (editLead) …` and does nothing while
  // nothing is being edited: the assertions passed through a no-op. Only the create instance is
  // captured.
  default: (props: Record<string, unknown>) => {
    // `"initial" in props`, NOT `props.initial == null`: the edit instance passes `initial={editLead}`
    // with `editLead === null` while nothing is being edited, so a value check matches BOTH and the
    // edit handler (whose body is `if (editLead) …`) wins by rendering second. That handler is a
    // no-op, so the assertions passed through nothing at all.
    if (!("initial" in props)) api.lastAddLeadSave = props.onSave as typeof api.lastAddLeadSave;
    return React.createElement("div", { "data-testid": "add-lead-modal" });
  },
}));
vi.mock("@/components/contacts/AddClientModal", () => marker("add-client-modal"));
vi.mock("@/components/contacts/AddRecruitModal", () => marker("add-recruit-modal"));
vi.mock("@/components/contacts/AddToCampaignModal", () => marker("add-to-campaign-modal"));
vi.mock("@/components/contacts/DeleteConfirmModal", () => marker("delete-confirm-modal"));
vi.mock("@/components/contacts/ConvertLeadModal", () => marker("convert-lead-modal"));
vi.mock("@/components/contacts/AgentModal", () => marker("agent-modal"));
vi.mock("@/components/contacts/ContactsFilterModal", () => marker("filter-modal"));
vi.mock("@/components/contacts/ContactScopeSelector", () => marker("scope-selector"));
vi.mock("@/components/contacts/ContactKanbanBoard", () => ({ ContactKanbanBoard: () => React.createElement("div", { "data-testid": "kanban-board" }) }));
vi.mock("@/components/PermissionGate", () => ({
  PermissionGate: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  CommissionGate: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import Contacts from "@/pages/Contacts";

const gridCalls = () =>
  api.calls.filter((c) => /^(leads|clients|recruits)\.(getAll|getById|getKanban|create|update)$/.test(c));
const detailCalls = () => api.calls.filter((c) => c.endsWith(".getById"));
const kanbanCalls = () => api.calls.filter((c) => c.endsWith(".getKanban"));

function setUrl(query: string) { routerState.params = new URLSearchParams(query); }

/**
 * Switch to the Kanban board.
 *
 * `view` is LOCAL STATE, not a URL parameter — a `?view=kanban` query does nothing, so a Kanban
 * test that only set the URL would pass while the page sat on the table view and `fetchKanban`
 * was never eligible to run at all. The toggle is an icon-only button, so it is located by its
 * icon rather than by an accessible name.
 */
async function switchToKanban() {
  const toggle = await waitFor(() => {
    const svg = document.querySelector('button svg[class*="grid"]');
    const button = svg?.closest("button");
    if (!button) throw new Error("Kanban toggle not rendered");
    return button;
  });
  fireEvent.click(toggle);
}

function impersonate() {
  authState.isImpersonating = true;
  authState.userId = OPERATOR;
  authState.profileId = VIEWED;   // the EFFECTIVE viewer differs from the real session user
  authState.role = "Agent";
}

beforeEach(() => {
  api.calls = [];
  api.lastAddLeadSave = null;
  dbState.tables = [];
  dbState.rpcs = [];
  routerState.locationState = null;
  routerState.navigations = [];
  setUrl("tab=Leads");
  authState.userId = OPERATOR;
  authState.profileId = OPERATOR;
  authState.role = "Agent";
  authState.isSuperAdmin = false;
  authState.isImpersonating = false;
  authState.organizationId = ORG;
});
afterEach(cleanup);

/**
 * Let the page finish.
 *
 * The fail-closed assertions are about calls that did NOT happen, so they only mean anything once
 * everything that WAS going to fire has fired. Deliberately NOT `act(async …)`: this page keeps
 * recurring timers alive, so `act` never drains and simply hangs — non-impersonating renders
 * included. Waiting on the tab bar proves the page mounted; the flush then lets the promise-based
 * scope resolution and fetches settle.
 */
const settle = async () => {
  await waitFor(() => expect(screen.getByRole("button", { name: "Import History" })).toBeTruthy());
  await new Promise((r) => setTimeout(r, 50));
};

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("blocked Contacts tabs issue no grid or Kanban query under View As", () => {
  it("a tab ABSENT from the declared allow-list is blocked — drift protection", async () => {
    // The blocked-tab decision is now `!isViewAsSupportedContactTab(tab)` — the DECLARED list in
    // `viewAsSurfaces`, not tab names repeated in the component. So a tab nobody enumerated
    // anywhere (a future "Policies" tab, or a garbage `?tab=` value like this one) fails closed
    // without `Contacts.tsx` changing. At dcb71a6 the component hard-coded
    // `tab === "Leads" || "Clients" || "Recruits"`, so an unknown tab was NOT blocked at all.
    impersonate();
    setUrl("tab=SomeFutureTab");
    render(<Contacts />);
    await settle();

    await screen.findByText(/Contacts aren't available while viewing as another user/i);
    expect(gridCalls(), "an unlisted tab issued a grid query").toEqual([]);
  });

  it("a session that becomes impersonated WHILE on the Kanban board stops querying it", async () => {
    // The transition the toggle-withholding cannot cover: the operator is already ON the board as
    // an ordinary session, and "View As" begins without an unmount. At dcb71a6-with-a-faithful-
    // mock the board effect re-fires on the identity change and `fetchKanban` refuses; with BOTH
    // the callback guard and its effect twin disabled, a board RPC fires against the real session
    // user mid-impersonation — which is exactly what this asserts cannot happen.
    //
    // (An earlier pass believed this sequence hit an unbounded production render loop. It did not:
    // the loop was this suite's own unmemoized `useContactScope` mock — see the mock's comment —
    // and with stable references the sequence settles normally.)
    //
    // HONESTY LABEL: passes at dcb71a6 — the guards it pins were added there. This test is what
    // makes the fetchKanban guard PAIR jointly mutation-pinned; it is not fail-first evidence.
    setUrl("tab=Leads");
    const view = render(<Contacts />);
    await settle();
    await switchToKanban();
    await waitFor(() => expect(kanbanCalls().length).toBeGreaterThan(0));

    impersonate();
    api.calls = [];
    // No unmount: `rerender` re-renders the SAME mounted instance, which is how the real page
    // experiences an activation — `isImpersonating` flips in context and the tree re-renders in
    // place. (The mock reads `authState` at render time, so a re-render is what carries the flip.)
    view.rerender(<Contacts />);
    await settle();

    await screen.findByText(/Contacts aren't available while viewing as another user/i);
    expect(screen.queryByTestId("kanban-board"), "the board stayed mounted").toBeNull();
    expect(kanbanCalls(), "a board RPC fired after View As began").toEqual([]);
  });

  // NOTE, honestly: these three PASS at b29dc9f — `contactGridsBlockedByViewAs` already gated
  // `fetchData`. They are regression guards on the half that was already right, not evidence.
  it.each(["Leads", "Clients", "Recruits"])("the %s table view issues no grid fetch", async (tab) => {
    impersonate();
    setUrl(`tab=${tab}`);
    render(<Contacts />);
    await settle();

    expect(gridCalls(), `${tab} issued a grid query`).toEqual([]);
    await screen.findByText(/Contacts aren't available while viewing as another user/i);
  });

  it("offers no Kanban toggle and issues no board query", async () => {
    // TWO defects here. `fetchKanban` carried no `contactGridsBlockedByViewAs` guard at b29dc9f, so
    // the board's RPCs ran against the REAL session user with only the paint suppressed. And the
    // toggle stayed clickable on a blocked tab: a switch between two views the page refuses to
    // render is not a control, it is a decoy. Withholding the toggle removes the offer; the guard
    // inside `fetchKanban` and on its effect refuses the request itself — and the transition test
    // above reaches that guard WITHOUT the toggle, so both layers are exercised.
    impersonate();
    setUrl("tab=Leads");
    render(<Contacts />);
    await settle();

    expect(
      document.querySelector('button svg[class*="grid"]'),
      "the Kanban toggle was offered on a blocked tab",
    ).toBeNull();
    expect(kanbanCalls(), "a Kanban RPC fired while impersonating").toEqual([]);
    expect(screen.queryByTestId("kanban-board")).toBeNull();
  });

  it("renders no stale contact left over from the previous viewer", async () => {
    // Real session first, with a contact open.
    setUrl("tab=Leads&contact=" + LEAD);
    const view = render(<Contacts />);
    await settle();
    view.unmount();

    // Same browser, now impersonating.
    api.calls = [];
    impersonate();
    setUrl("tab=Leads&contact=" + LEAD);
    render(<Contacts />);
    await settle();

    expect(screen.queryByTestId("full-screen-contact"), "the previous viewer's contact detail rendered").toBeNull();
    expect(detailCalls(), "a detail lookup ran for the previous viewer's contact").toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("deep links are discarded, not merely unresolved", () => {
  it.each([
    ["?contact=", `tab=Import History&contact=${LEAD}`],
    ["legacy ?id=", `tab=Import History&id=${LEAD}`],
  ])("a %s deep link on a SUPPORTED tab issues no getById", async (_label, query) => {
    // Import History is supported, so the operator genuinely reaches this page while impersonating —
    // and the deep-link chain is not tab-scoped, so it ran here at b29dc9f.
    impersonate();
    setUrl(query);
    render(<Contacts />);
    await settle();

    expect(detailCalls(), "a contact detail lookup was issued under View As").toEqual([]);
    expect(screen.queryByTestId("full-screen-contact")).toBeNull();
  });

  it("the contact id is STRIPPED from the URL, not left parked", async () => {
    // Left in place it would be re-offered on the next render, handed to the `fetchData`
    // fallbacks, and re-resolved the moment View As ended.
    impersonate();
    setUrl(`tab=Import History&contact=${LEAD}&contactType=lead`);
    render(<Contacts />);
    await waitFor(() => expect(routerState.params.get("contact")).toBeNull());

    expect(routerState.params.get("contactType")).toBeNull();
    expect(routerState.params.get("id")).toBeNull();
  });

  // NOTE, honestly: PASSES at b29dc9f, and for a reason worth stating — the `openContactId` effect
  // is gated on `leads.length > 0`, and Import History never loads the grids, so it could not fire
  // in this scenario either way. Kept as a guard on the third contact-id channel, not as evidence.
  it("an openContactId navigation state is ignored", async () => {
    impersonate();
    setUrl("tab=Import History");
    routerState.locationState = { openContactId: LEAD };
    render(<Contacts />);
    await settle();

    expect(detailCalls()).toEqual([]);
    expect(screen.queryByTestId("full-screen-contact")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("no create, edit, convert or delete surface mounts under View As", () => {
  // NOTE, honestly: five of these seven FAIL at b29dc9f. `convert-lead-modal` and
  // `full-screen-contact` pass there — both mount only once a contact is selected, and nothing in
  // this scenario selects one. They are kept for completeness of the list, not as evidence.
  it.each([
    "add-lead-modal", "add-client-modal", "add-recruit-modal", "add-to-campaign-modal",
    "delete-confirm-modal", "convert-lead-modal", "full-screen-contact",
  ])("%s never mounts", async (testid) => {
    impersonate();
    setUrl("tab=Import History");
    render(<Contacts />);
    await settle();

    expect(screen.queryByTestId(testid), `${testid} mounted under View As`).toBeNull();
  });

  it("hides Add Contact and Import CSV", async () => {
    impersonate();
    setUrl("tab=Leads");
    render(<Contacts />);
    await settle();

    expect(screen.queryAllByRole("button", { name: /Import CSV/i }), "Import CSV offered under View As").toEqual([]);
    expect(screen.queryAllByRole("button", { name: /^Add /i }), "Add Contact offered under View As").toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("Import History stays readable and read-only", () => {
  // NOTE, honestly: PASSES at b29dc9f. This is the "must not break" half — a fail-closed guard
  // that also silenced the two audited surfaces would be a regression, not a fix.
  it("still queries import_history while impersonating", async () => {
    impersonate();
    setUrl("tab=Import History");
    render(<Contacts />);
    await settle();

    // The supported surface must keep WORKING — a fail-closed guard that also broke the two audited
    // pages would be a regression, not a fix.
    expect(dbState.tables, "Import History stopped reading under View As").toContain("import_history");
  });

  it("offers no Import CSV, Retry attachment or Undo Import", async () => {
    impersonate();
    setUrl("tab=Import History");
    render(<Contacts />);
    await settle();

    expect(screen.queryByRole("button", { name: /Import CSV/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Retry attachment/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Undo Import/i })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("nothing changes when not impersonating", () => {
  // POSITIVE CONTROLS — all pass at b29dc9f. The guards must be invisible to an ordinary session.
  it("the Leads grid still fetches", async () => {
    setUrl("tab=Leads");
    render(<Contacts />);
    await waitFor(() => expect(api.calls).toContain("leads.getAll"));
    expect(screen.queryByText(/Contacts aren't available/i)).toBeNull();
  });

  it("the Kanban board still fetches", async () => {
    // The control that proves the impersonating Kanban assertion above is not vacuous: the same
    // sequence, without impersonation, DOES issue a board query.
    setUrl("tab=Leads");
    render(<Contacts />);
    await settle();
    await switchToKanban();

    await waitFor(() => expect(kanbanCalls().length).toBeGreaterThan(0));
  });

  it("a contact deep link still resolves", async () => {
    setUrl(`tab=Leads&contact=${LEAD}`);
    render(<Contacts />);
    await waitFor(() => expect(detailCalls().length).toBeGreaterThan(0));
    expect(routerState.params.get("contact"), "the deep link was stripped for an ordinary session").toBe(LEAD);
  });

  it("Add Contact and Import CSV are still offered", async () => {
    setUrl("tab=Leads");
    render(<Contacts />);
    await settle();

    // More than one "Add …" affordance can render (the toolbar button and the empty state's), so
    // this counts them rather than demanding exactly one.
    expect(screen.queryAllByRole("button", { name: /Import CSV/i }).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("button", { name: /^Add /i }).length).toBeGreaterThan(0);
  });
});


// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("Add Lead ownership never falls back to the real session user", () => {
  /**
   * THE DEFECT. `const ownerId = meta?.assignToAgentId ?? user?.id ?? ""` — the REAL authenticated
   * user as the fallback. In the ordinary flow `AddLeadModal` supplies `assignToAgentId`, so this
   * was not routine mis-stamping; it was a fail-OPEN default. Whenever an assignee could not be
   * resolved it silently substituted the one identity that must never be assumed.
   * `handleAddClient` and `handleAddRecruit` already resolved from the effective viewer.
   */
  /**
   * A payload that satisfies every LOCKED required field (First Name, Last Name, Phone), so the
   * ONLY thing that can refuse the save is the owner. Without the phone these tests would pass on
   * a missing-required-field refusal and prove nothing about ownership.
   */
  const COMPLETE_LEAD = { firstName: "Owner", lastName: "Test", phone: "+15550001111" };

  const openAddLeadModal = async () => {
    setUrl("tab=Leads");
    render(<Contacts />);
    await settle();
    await waitFor(() => expect(api.lastAddLeadSave).toBeTypeOf("function"));
  };

  it("fails closed when neither an assignee nor an effective viewer can be resolved", async () => {
    // The effective viewer is unresolvable (no profile id) while the REAL session user is present —
    // precisely the state the old fallback silently papered over.
    authState.profileId = "";
    await openAddLeadModal();
    api.calls = [];

    await api.lastAddLeadSave!(COMPLETE_LEAD, {});

    expect(api.calls, "a lead was created with no resolvable owner").not.toContain("leads.create");
  });

  it("does not fall back to the real user when the assignee is blank or malformed", async () => {
    authState.profileId = "";
    await openAddLeadModal();

    for (const meta of [{}, { assignToAgentId: "" }, { assignToAgentId: "   " }, { assignToAgentId: null }]) {
      api.calls = [];
      await api.lastAddLeadSave!(COMPLETE_LEAD, meta as Record<string, unknown>);
      expect(api.calls, `created a lead for meta ${JSON.stringify(meta)}`).not.toContain("leads.create");
    }
  });

  it("uses the EFFECTIVE viewer when no explicit assignee is given", async () => {
    // POSITIVE CONTROL. The ordinary path still works — this is a fail-closed change, not a
    // removal of the default.
    await openAddLeadModal();
    api.calls = [];

    await api.lastAddLeadSave!(COMPLETE_LEAD, {});

    expect(api.calls).toContain("leads.create");
  });

  it("uses an explicit assignee when one is supplied", async () => {
    // POSITIVE CONTROL — the normal create flow, which always supplies `assignToAgentId`.
    authState.profileId = "";
    await openAddLeadModal();
    api.calls = [];

    await api.lastAddLeadSave!(COMPLETE_LEAD, { assignToAgentId: OPERATOR });

    expect(api.calls).toContain("leads.create");
  });
});
