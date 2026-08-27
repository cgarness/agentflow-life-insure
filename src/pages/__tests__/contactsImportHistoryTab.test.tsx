/**
 * Contacts → Import History: tab gating, scoping, and error-vs-empty.
 *
 * Three defects this pins, all previously in `Contacts.tsx`:
 *   - `useEffect(() => { fetchImportHistory(); }, [fetchImportHistory])` with a `useCallback(…, [])`
 *     fetched exactly once per MOUNT, whichever tab was active.
 *   - The query was `.select("*").order(...)` with no `organization_id` and no `agent_id` filter,
 *     over an organization-wide RLS policy.
 *   - `if (!error && data)` swallowed every failure, so an error rendered the "No imports yet"
 *     empty state.
 *
 * The Supabase mock RECORDS every table/filter, so "no import_history query was issued" and
 * "the agent_id filter was applied" are real assertions.
 */

import React from "react";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "55555555-5555-4555-8555-555555555555";
const VIEWER = uid(1);
const OTHER_AGENT = uid(2);

interface Recorded {
  table: string;
  select: string;
  eq: Record<string, unknown>;
  range: { from: number; to: number } | null;
}

const dbState = vi.hoisted(() => ({
  queries: [] as Recorded[],
  importRows: [] as Record<string, unknown>[],
  importError: null as string | null,
}));

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
}));

vi.mock("@/integrations/supabase/client", () => {
  function makeBuilder(table: string) {
    const rec: Recorded = { table, select: "*", eq: {}, range: null };
    dbState.queries.push(rec);
    const settle = () => {
      if (table !== "import_history") return { data: [], error: null, count: 0 };
      if (dbState.importError) return { data: null, error: { message: dbState.importError } };
      const cols = rec.select.split(",").map((c) => c.trim());
      let matched = dbState.importRows.filter((row) => Object.entries(rec.eq).every(([c, v]) => row[c] === v));
      if (rec.range) matched = matched.slice(rec.range.from, rec.range.to + 1);
      const rows = matched
        .map((row) => {
          if (cols.includes("*")) return { ...row };
          const out: Record<string, unknown> = {};
          for (const c of cols) out[c] = row[c];
          return out;
        });
      return { data: rows, error: null, count: rows.length };
    };
    const b: Record<string, unknown> = {
      select(cols: string) { rec.select = cols; return b; },
      eq(col: string, val: unknown) { rec.eq[col] = val; return b; },
      in() { return b; },
      or() { return b; },
      neq() { return b; },
      order() { return b; },
      range(from: number, to: number) { rec.range = { from, to }; return b; },
      limit() { return b; },
      maybeSingle() { return Promise.resolve({ data: null, error: null }); },
      single() { return Promise.resolve({ data: null, error: null }); },
      then(resolve: (v: unknown) => unknown) { return Promise.resolve(settle()).then(resolve); },
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
  useBranding: () => ({
    formatDate: (v: unknown) => String(v ?? ""),
    formatDateTime: (v: unknown) => String(v ?? ""),
  }),
}));
vi.mock("@/hooks/useContactScope", () => ({
  useContactScope: () => ({
    scope: "mine", setScope: () => {}, availableScopes: ["mine"], maxScope: "all",
    teamAgents: [], teamAgentIds: [], hasDownline: false, ready: true, prefError: false,
  }),
}));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasContactsPermission: () => true,
    getDataScope: () => "own",
    isLoading: false,
  }),
}));
vi.mock("@/lib/supabase-users", () => ({
  usersSupabaseApi: {
    getAgentScopeIds: () => Promise.resolve([VIEWER]),
    getByIds: () => Promise.resolve([]),
    getAll: () => Promise.resolve([]),
    getById: () => Promise.resolve(null),
  },
}));
vi.mock("react-router-dom", () => ({
  useNavigate: () => () => {},
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
vi.mock("@/components/contacts/FullScreenContactView", () => ({ default: () => null }));
vi.mock("@/components/contacts/AddLeadModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/AddClientModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/AddRecruitModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/AddToCampaignModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/ContactsFilterModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/ContactKanbanBoard", () => ({ ContactKanbanBoard: () => null }));
vi.mock("@/components/contacts/ContactScopeSelector", () => ({ default: () => null }));
vi.mock("@/components/contacts/AgentModal", () => ({ default: () => null }));
vi.mock("@/components/PermissionGate", () => ({
  PermissionGate: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  CommissionGate: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import Contacts from "@/pages/Contacts";

const importQueries = () => dbState.queries.filter((q) => q.table === "import_history");

function importRow(id: string, agentId: string, organizationId = ORG) {
  return {
    id, file_name: `${id}.csv`, created_at: "2026-08-20T00:00:00Z",
    total_records: 3, imported: 3, duplicates: 0, errors: 0,
    imported_lead_ids: [], import_completion_status: "completed",
    undo_status: null, campaign_id: null, agent_id: agentId, organization_id: organizationId,
  };
}

beforeEach(() => {
  dbState.queries = [];
  dbState.importRows = [];
  dbState.importError = null;
  authState.userId = VIEWER;
  authState.profileId = VIEWER;
  authState.role = "Agent";
  authState.isSuperAdmin = false;
  authState.isImpersonating = false;
  authState.organizationId = ORG;
  routerState.params = new URLSearchParams("tab=Leads");
  routerState.locationState = null;
});

afterEach(cleanup);

describe("Import History is fetched ONLY when its tab is active", () => {
  it("issues ZERO import_history queries while another tab is active", async () => {
    routerState.params = new URLSearchParams("tab=Leads");
    render(<Contacts />);
    // Give every mount effect a chance to fire.
    await waitFor(() => expect(dbState.queries.length).toBeGreaterThan(0));
    expect(importQueries()).toHaveLength(0);
  });

  it("fetches once when the Import History tab is active", async () => {
    routerState.params = new URLSearchParams("tab=Import History");
    render(<Contacts />);
    await waitFor(() => expect(importQueries().length).toBe(1));
  });
});

describe("the query is organization- and uploader-scoped", () => {
  it("a non-admin carries BOTH organization_id and agent_id", async () => {
    routerState.params = new URLSearchParams("tab=Import History");
    dbState.importRows = [importRow("mine", VIEWER), importRow("theirs", OTHER_AGENT)];

    render(<Contacts />);
    await waitFor(() => expect(importQueries().length).toBe(1));

    const q = importQueries()[0];
    expect(q.eq.organization_id).toBe(ORG);
    expect(q.eq.agent_id).toBe(VIEWER);
    expect(await screen.findByText("mine.csv")).toBeInTheDocument();
    expect(screen.queryByText("theirs.csv")).not.toBeInTheDocument();
  });

  it("an Admin is organization-scoped with no uploader filter", async () => {
    authState.role = "Admin";
    routerState.params = new URLSearchParams("tab=Import History");
    dbState.importRows = [importRow("mine", VIEWER), importRow("theirs", OTHER_AGENT)];

    render(<Contacts />);
    await waitFor(() => expect(importQueries().length).toBe(1));

    const q = importQueries()[0];
    expect(q.eq.organization_id).toBe(ORG);
    expect(q.eq.agent_id).toBeUndefined();
    expect(await screen.findByText("theirs.csv")).toBeInTheDocument();
  });

  it("View As Agent uses the IMPERSONATED profile id, not the real Super Admin's", async () => {
    // Real session = a Super Admin; effective profile = an Agent in the same org.
    authState.userId = uid(900);          // the real Super Admin, unchanged by impersonation
    authState.profileId = VIEWER;         // the viewed Agent
    authState.role = "Agent";
    authState.isImpersonating = true;
    authState.isSuperAdmin = true;        // useOrganization returns `isSuperAdmin || isImpersonating`
    routerState.params = new URLSearchParams("tab=Import History");
    dbState.importRows = [importRow("agent", VIEWER), importRow("super", uid(900))];

    render(<Contacts />);
    await waitFor(() => expect(importQueries().length).toBe(1));

    const q = importQueries()[0];
    // The org-wide branch must NOT be taken just because isSuperAdmin is true.
    expect(q.eq.agent_id).toBe(VIEWER);
    expect(q.eq.agent_id).not.toBe(uid(900));
    expect(await screen.findByText("agent.csv")).toBeInTheDocument();
    expect(screen.queryByText("super.csv")).not.toBeInTheDocument();
  });
});

describe("errors are distinguishable from an empty history", () => {
  it("renders an error with Retry, NOT the empty state", async () => {
    routerState.params = new URLSearchParams("tab=Import History");
    dbState.importError = "permission denied for table import_history";

    render(<Contacts />);

    expect(await screen.findByText(/Couldn't load import history/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByText(/No imports yet/i)).not.toBeInTheDocument();
  });

  it("Retry re-issues the query", async () => {
    routerState.params = new URLSearchParams("tab=Import History");
    dbState.importError = "boom";
    render(<Contacts />);
    await screen.findByText(/Couldn't load import history/i);
    const before = importQueries().length;

    dbState.importError = null;
    dbState.importRows = [importRow("recovered", VIEWER)];
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => expect(importQueries().length).toBeGreaterThan(before));
    expect(await screen.findByText("recovered.csv")).toBeInTheDocument();
  });

  it("a genuinely empty history still shows the existing empty state", async () => {
    routerState.params = new URLSearchParams("tab=Import History");
    dbState.importRows = [importRow("theirs", OTHER_AGENT)]; // filtered out by the agent_id filter

    render(<Contacts />);

    expect(await screen.findByText(/No imports yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load import history/i)).not.toBeInTheDocument();
  });
});

describe("a viewer change clears the previous viewer's rows", () => {
  it("does not keep showing the prior organization's imports", async () => {
    routerState.params = new URLSearchParams("tab=Import History");
    dbState.importRows = [importRow("first-org", VIEWER, ORG)];

    const { rerender } = render(<Contacts />);
    expect(await screen.findByText("first-org.csv")).toBeInTheDocument();

    // View As switches the organization IN PLACE — no remount.
    authState.organizationId = OTHER_ORG;
    dbState.importRows = [importRow("second-org", VIEWER, OTHER_ORG)];
    rerender(<Contacts />);

    expect(await screen.findByText("second-org.csv")).toBeInTheDocument();
    expect(screen.queryByText("first-org.csv")).not.toBeInTheDocument();
    expect(importQueries().at(-1)?.eq.organization_id).toBe(OTHER_ORG);
  });
});

describe("the contact grids fail closed under View As", () => {
  // `search_contacts_*` scopes by `auth.uid()` server-side, which is always the REAL Super Admin.
  // Running the grids while impersonating would render the Super Admin's own contacts under the
  // viewed user's name, so they are withheld instead.
  it("withholds Leads and explains why while impersonating", async () => {
    authState.isImpersonating = true;
    authState.isSuperAdmin = true;
    routerState.params = new URLSearchParams("tab=Leads");

    render(<Contacts />);

    expect(await screen.findByText(/aren't available while viewing as another user/i)).toBeInTheDocument();
  });

  it("does NOT withhold Import History while impersonating — it is scoped client-side", async () => {
    authState.isImpersonating = true;
    authState.isSuperAdmin = true;
    authState.profileId = VIEWER;
    routerState.params = new URLSearchParams("tab=Import History");
    dbState.importRows = [importRow("agent-own", VIEWER)];

    render(<Contacts />);

    expect(await screen.findByText("agent-own.csv")).toBeInTheDocument();
    expect(screen.queryByText(/aren't available while viewing as another user/i)).not.toBeInTheDocument();
  });
});

describe("more than 200 authorized imports are all reachable", () => {
  it("shows a Load more control and appends the remaining rows", async () => {
    // 260 authorized rows: the old hardcoded .limit(200) hid the last 60 with no way to reach them.
    dbState.importRows = Array.from({ length: 260 }, (_, i) =>
      importRow(`row-${String(i).padStart(4, "0")}`, VIEWER));
    routerState.params = new URLSearchParams("tab=Import History");

    render(<Contacts />);
    await screen.findByText("row-0000.csv");

    // The 201st row is beyond the first page.
    expect(screen.queryByText("row-0200.csv")).not.toBeInTheDocument();

    const loadMore = await screen.findByRole("button", { name: /load more/i });
    fireEvent.click(loadMore);

    expect(await screen.findByText("row-0259.csv")).toBeInTheDocument();
    // The first page is still there — pages append, they do not replace.
    expect(screen.getByText("row-0000.csv")).toBeInTheDocument();
    // Nothing left to load.
    await waitFor(() => expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument());
    // Rendering 260 rows through the real Contacts page in jsdom is simply slow; the assertions
    // above are the point, not the wall-clock.
  }, 30000);

  it("offers no Load more when a single page covers everything", async () => {
    dbState.importRows = [importRow("only", VIEWER)];
    routerState.params = new URLSearchParams("tab=Import History");

    render(<Contacts />);
    await screen.findByText("only.csv");

    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });
});

describe("a Load More failure preserves the rows already loaded", () => {
  it("keeps the loaded history, shows an inline error, and offers a working retry", async () => {
    dbState.importRows = Array.from({ length: 260 }, (_, i) =>
      importRow(`row-${String(i).padStart(4, "0")}`, VIEWER));
    routerState.params = new URLSearchParams("tab=Import History");

    render(<Contacts />);
    await screen.findByText("row-0000.csv");

    // The second page fails.
    dbState.importError = "network blip";
    fireEvent.click(await screen.findByRole("button", { name: /load more/i }));

    // The already-loaded page must SURVIVE — not be replaced by the full-page error or empty state.
    await waitFor(() => expect(screen.getByText(/network blip/i)).toBeInTheDocument());
    expect(screen.getByText("row-0000.csv")).toBeInTheDocument();
    expect(screen.queryByText(/No imports yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load import history/i)).not.toBeInTheDocument();

    // And the retry works.
    dbState.importError = null;
    fireEvent.click(await screen.findByRole("button", { name: /load more/i }));
    expect(await screen.findByText("row-0259.csv")).toBeInTheDocument();
    expect(screen.getByText("row-0000.csv")).toBeInTheDocument();
  }, 30000);

  it("a FIRST-page failure with no rows still shows the full recoverable error state", async () => {
    routerState.params = new URLSearchParams("tab=Import History");
    dbState.importError = "permission denied";

    render(<Contacts />);

    expect(await screen.findByText(/Couldn't load import history/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^retry$/i })).toBeInTheDocument();
    expect(screen.queryByText(/No imports yet/i)).not.toBeInTheDocument();
  });
});

describe("the empty state never precedes the first request", () => {
  // NOTE, honestly: this passes at aafe3ba too, because the panel itself is gated on the contacts
  // TABLE loading flag, which masks the hook's initial `loading:false` window at page level. The
  // real fail-first proof for that defect is in `useImportHistory.test.ts`; this is a
  // non-regression guard that the page never commits a false empty state.
  it("does not flash 'No imports yet' before the initial load settles", async () => {
    const frames: string[] = [];
    const Recorder: React.FC = () => {
      React.useLayoutEffect(() => { frames.push(document.body.textContent ?? ""); });
      return null;
    };
    routerState.params = new URLSearchParams("tab=Import History");
    dbState.importRows = [importRow("eventual", VIEWER)];

    render(<><Contacts /><Recorder /></>);
    await screen.findByText("eventual.csv");

    const emptyFrames = frames.filter((f) => f.includes("No imports yet"));
    expect(emptyFrames).toEqual([]);
  });
});

describe("drill-in stays wired", () => {
  it("clicking a row opens the import detail drawer", async () => {
    routerState.params = new URLSearchParams("tab=Import History");
    dbState.importRows = [importRow("clickable", VIEWER)];

    render(<Contacts />);
    const row = await screen.findByText("clickable.csv");
    fireEvent.click(row);

    // The drawer titles itself after the import's file name.
    await waitFor(() => expect(screen.getAllByText(/clickable\.csv/).length).toBeGreaterThan(1));
  });
});
