/**
 * Contacts under "View As" — the OPERATOR's preference row is untouchable, and the organization
 * metadata fan-out is not issued.
 *
 * THE DEFECT THIS PINS. Contacts persists column widths / visible columns / per-tab sort to
 * `user_preferences` keyed on the REAL `user.id`, debounced 2 s. Under "View As" that machinery
 * kept running:
 *
 *   1. Mounting read the operator's preference row into an impersonated session.
 *   2. Sort RESTORATION (`setSortByTab` from the loaded settings) schedules the persistence
 *      debounce all by itself — so merely opening Contacts could WRITE the operator's row while
 *      previewing someone else.
 *   3. A debounce scheduled BEFORE activation fired after it: the timer captured schedule-time
 *      state and nothing re-checked at fire time.
 *   4. The organization-wide metadata effect (pipeline stages, CMS settings, custom fields, lead
 *      sources, the Active-profiles roster, campaigns) ran too, though neither supported tab
 *      needs any of it.
 *
 * Fake timers make the debounce window deterministic; the supabase mock records every table and
 * upsert, so "no read", "no write" and "wrote after all" are assertions about calls actually made.
 */

import React from "react";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ids = vi.hoisted(() => {
  const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  return { OPERATOR: uid(1), VIEWED: uid(2) };
});
const { OPERATOR } = ids;
const ORG = "11111111-1111-4111-8111-111111111111";

const db = vi.hoisted(() => ({
  tables: [] as string[],
  upserts: [] as { table: string; payload: unknown }[],
  /** `settings` returned for a `user_preferences` select; null = no row. */
  prefSettings: null as Record<string, unknown> | null,
}));

const authState = vi.hoisted(() => ({
  isImpersonating: false,
  profileId: "00000000-0000-4000-8000-000000000001",
}));

const routerState = vi.hoisted(() => ({
  params: new URLSearchParams("tab=Leads"),
}));

vi.mock("@/integrations/supabase/client", () => {
  function makeBuilder(table: string) {
    db.tables.push(table);
    const b: Record<string, unknown> = {
      select() { return b; }, eq() { return b; }, in() { return b; }, or() { return b; },
      neq() { return b; }, order() { return b; }, range() { return b; }, limit() { return b; },
      upsert(payload: unknown) {
        db.upserts.push({ table, payload });
        return Promise.resolve({ data: null, error: null });
      },
      maybeSingle() {
        if (table === "user_preferences") {
          return Promise.resolve({
            data: db.prefSettings ? { settings: db.prefSettings } : null,
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
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
  return { supabase: { from: (t: string) => makeBuilder(t), rpc: () => rpcB, auth: {} } };
});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: ids.OPERATOR },
    profile: { id: authState.profileId, organization_id: ORG, role: "Agent" },
    isImpersonating: authState.isImpersonating,
    isBuildingOrganization: false,
  }),
}));
vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: ORG, role: "Agent", isSuperAdmin: false }),
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
vi.mock("@/lib/supabase-contacts", () => ({
  leadsSupabaseApi: {
    getAll: () => Promise.resolve({ data: [], totalCount: 0 }),
    getById: () => Promise.reject(new Error("no")),
    getByIds: () => Promise.resolve([]),
    getKanban: () => Promise.resolve({ columns: [] }),
    create: () => Promise.resolve({ id: "x" }),
    update: () => Promise.resolve({}),
  },
}));
vi.mock("@/lib/supabase-clients", () => ({
  clientsSupabaseApi: {
    getAll: () => Promise.resolve({ data: [], totalCount: 0 }),
    getById: () => Promise.reject(new Error("no")),
    create: () => Promise.resolve({}), update: () => Promise.resolve({}),
  },
}));
vi.mock("@/lib/supabase-recruits", () => ({
  recruitsSupabaseApi: {
    getAll: () => Promise.resolve({ data: [], totalCount: 0 }),
    getById: () => Promise.reject(new Error("no")),
    getKanban: () => Promise.resolve({ columns: [] }),
    create: () => Promise.resolve({}), update: () => Promise.resolve({}),
  },
}));
vi.mock("@/lib/supabase-users", () => ({
  usersSupabaseApi: {
    getAgentScopeIds: () => Promise.resolve([ids.VIEWED]),
    // One row, so the Agents tab renders its TABLE (not the empty state) and its sortable
    // headers are really there to click.
    getByIds: () =>
      Promise.resolve([
        { id: ids.VIEWED, firstName: "Vera", lastName: "Viewed", email: "vera@x.test", role: "Agent", status: "active", profile: null },
      ]),
    getAll: () => Promise.resolve([]),
    getById: () => Promise.resolve(null),
  },
}));
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

function marker(id: string) {
  return { default: () => React.createElement("div", { "data-testid": id }) };
}
vi.mock("@/components/contacts/FullScreenContactView", () => marker("full-screen-contact"));
vi.mock("@/components/contacts/AddLeadModal", () => marker("add-lead-modal"));
vi.mock("@/components/contacts/AddClientModal", () => marker("add-client-modal"));
vi.mock("@/components/contacts/AddRecruitModal", () => marker("add-recruit-modal"));
vi.mock("@/components/contacts/AddToCampaignModal", () => marker("add-to-campaign-modal"));
vi.mock("@/components/contacts/ContactsFilterModal", () => marker("filter-modal"));
vi.mock("@/components/contacts/ContactKanbanBoard", () => ({ ContactKanbanBoard: () => null }));
vi.mock("@/components/contacts/ContactScopeSelector", () => marker("scope-selector"));
vi.mock("@/components/contacts/AgentModal", () => marker("agent-modal"));
vi.mock("@/components/PermissionGate", () => ({
  PermissionGate: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  CommissionGate: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import Contacts from "@/pages/Contacts";

const prefReads = () => db.tables.filter((t) => t === "user_preferences");
const prefUpserts = () => db.upserts.filter((u) => u.table === "user_preferences");
/** Tables the organization-metadata effect touches — none needed by a supported tab. */
const METADATA_TABLES = ["pipeline_stages", "campaigns", "lead_sources", "custom_fields"];

function setUrl(query: string) { routerState.params = new URLSearchParams(query); }

function impersonate() {
  authState.isImpersonating = true;
  authState.profileId = ids.VIEWED;
}

/**
 * Advance the fake clock far past the 2 s debounce and drain everything it scheduled — in two
 * waves, because the debounce is scheduled from an EFFECT that runs only after the preference
 * load's promise chain lands: a single advancement window closes before that timer exists.
 * `runOnlyPendingTimersAsync` then fires anything scheduled during the second wave, so "no write
 * happened" is asserted with zero timers left pending, never against a timer that simply hadn't
 * fired yet.
 */
const advancePastDebounce = async () => {
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  await act(async () => { await vi.runOnlyPendingTimersAsync(); });
};

beforeEach(() => {
  vi.useFakeTimers();
  db.tables = [];
  db.upserts = [];
  // A realistic saved row: restoring this sort is exactly what schedules the automatic write.
  db.prefSettings = { contactsSort: { Leads: { col: "name", dir: "desc" } } };
  routerState.params = new URLSearchParams("tab=Leads");
  authState.isImpersonating = false;
  authState.profileId = OPERATOR;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("no preference READ under View As", () => {
  it("mounting Contacts issues no user_preferences select and no upsert", async () => {
    impersonate();
    setUrl("tab=Import History");
    render(<Contacts />);
    await advancePastDebounce();

    expect(prefReads(), "the operator's preference row was read under View As").toEqual([]);
    expect(prefUpserts(), "a preference write fired under View As").toEqual([]);
  });

  it("hydration still settles: the supported tab loads instead of waiting on preferences", async () => {
    // `sortHydrated` gates the fetch scheduler, so skipping the read must not latch the page.
    // HONESTY LABEL: passes at dcb71a6 too, for a DIFFERENT reason — the read simply ran there.
    // It is the must-not-break half of the gate, not fail-first evidence.
    impersonate();
    setUrl("tab=Import History");
    render(<Contacts />);
    await advancePastDebounce();

    expect(db.tables, "Import History never loaded — hydration latched").toContain("import_history");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("no preference WRITE under View As", () => {
  it("sorting a supported tab after activation schedules no upsert", async () => {
    // Arm the persistence machinery first, in an ORDINARY session: mounting restores the saved
    // Leads sort, which marks the preferences loaded and (as the positive control proves)
    // schedules a genuine write. Without this step the sort-persistence effect is disarmed under
    // "View As" (`sortPrefsLoaded` never latches when the read is withheld) and this scenario
    // would pass vacuously — an earlier version of this test did exactly that, and clicked
    // nothing because it looked for a "Name" header on a table whose column is labelled "Agent".
    const view = render(<Contacts />);
    await advancePastDebounce();
    db.upserts = []; // discard the ordinary session's own restoration write

    impersonate();
    setUrl("tab=Agents");
    view.rerender(<Contacts />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });

    // The Agents table sorts client-side; its headers still route through the same persistence.
    const header = screen.queryAllByText("Agent").find((el) => el.closest("th"));
    expect(header, "the Agents tab's sortable header did not render").toBeTruthy();
    fireEvent.click(header!);
    await advancePastDebounce();

    expect(prefUpserts(), "sorting under View As persisted preferences").toEqual([]);
  });

  it("a debounce scheduled BEFORE activation cannot fire after it", async () => {
    // Ordinary session: mounting restores the saved sort, and that restoration alone schedules
    // the 2 s persistence debounce.
    setUrl("tab=Leads");
    const view = render(<Contacts />);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });

    // "View As" begins inside the debounce window, without an unmount.
    impersonate();
    view.rerender(<Contacts />);
    await advancePastDebounce();

    expect(
      prefUpserts(),
      "a pre-activation debounce wrote the operator's preferences after View As began",
    ).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("the organization metadata fan-out is not issued under View As", () => {
  it("pipeline stages, CMS settings, custom fields, lead sources, rosters and campaigns stay unqueried", async () => {
    impersonate();
    setUrl("tab=Import History");
    render(<Contacts />);
    await advancePastDebounce();

    for (const table of METADATA_TABLES) {
      expect(db.tables, `${table} was queried under View As`).not.toContain(table);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("ordinary sessions still load and persist preferences", () => {
  // POSITIVE CONTROLS — pass at dcb71a6.
  it("mounting reads the row, and the restored sort persists after the debounce", async () => {
    setUrl("tab=Leads");
    render(<Contacts />);
    await advancePastDebounce();

    expect(prefReads().length).toBeGreaterThan(0);
    const writes = prefUpserts();
    expect(writes.length, "the sort-restoration debounce never persisted").toBeGreaterThan(0);
    expect((writes[0].payload as { user_id?: string }).user_id).toBe(OPERATOR);
  });

  it("the metadata fan-out still runs", async () => {
    setUrl("tab=Leads");
    render(<Contacts />);
    await advancePastDebounce();

    expect(db.tables).toContain("pipeline_stages");
  });
});
