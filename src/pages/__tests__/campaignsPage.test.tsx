/**
 * Campaigns page integration — the real route (PageGuard → src/pages/Campaigns.tsx →
 * CampaignsPageContent) with the real hooks, queries, model and components.
 *
 * Mocked: transport only (a recording Supabase fake that emulates `campaigns_select` RLS and the
 * `get_campaign_card_stats` scope per caller, plus last dialed, profiles, organizations and
 * user_preferences) and the auth / permissions / branding contexts (stable, hoisted persona
 * objects — fresh objects per render would fabricate render loops, AGENT_RULES).
 *
 * Pinned:
 *   - role matrix: Agent / Agent + View All / Team Leader with and without View All / Admin /
 *     Super Admin (role "Admin" + is_super_admin) — visibility, New Campaign, Duplicate
 *     eligibility, identities vs. counts, and the D1-B stored fallback for RPC-omitted rows;
 *   - a "Super Admin" role string through the REAL PageGuard + usePermissions stays on the
 *     spinner and issues no campaigns query (pre-existing behavior, documented here);
 *   - loading / list error / empty / filtered-empty / metrics error states;
 *   - filters, search and sorting over the full set; agency lock; column preferences never
 *     written on load (and not read at all during View As); identity switches never paint the
 *     previous viewer's rows; both layouts (stacked default, desktop table at xl);
 *   - server rendering of seeded, empty and error states, and of CampaignsTable directly.
 */
import React, { Profiler, useLayoutEffect } from "react";
import { renderToString } from "react-dom/server";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { StaticRouter } from "react-router-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import PageGuard from "@/components/PageGuard";
import Campaigns from "@/pages/Campaigns";
import CampaignsTable from "@/components/campaigns/CampaignsTable";
import { CAMPAIGNS_TABLE_QUERY_ROOT } from "@/hooks/useCampaignsTableData";
import { DEFAULT_COLUMN_LAYOUT, visibleColumns } from "@/lib/campaigns-table/columns";
import {
  CAMPAIGN_LIST_COLUMNS, DEFAULT_SORT, collectAssigneeIds, duplicateEligibility, idsHash, resolveCampaignMetrics,
  type CampaignRow, type StatsView,
} from "@/lib/campaigns-table/model";
import { CampaignsQueryError } from "@/lib/campaigns-table/queries";
import type { CampaignCardStats } from "@/lib/campaign-card-stats";
import type { AssigneeProfileMap } from "@/components/dialer/campaignSelectionModel";

// jsdom shims Radix needs (scoped to this file, not the global setup)
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}

(window as any).ResizeObserver = (window as any).ResizeObserver || RO;

(Element.prototype as any).hasPointerCapture = (Element.prototype as any).hasPointerCapture || (() => false);

(Element.prototype as any).setPointerCapture = (Element.prototype as any).setPointerCapture || (() => {});

(Element.prototype as any).releasePointerCapture = (Element.prototype as any).releasePointerCapture || (() => {});

(Element.prototype as any).scrollIntoView = (Element.prototype as any).scrollIntoView || (() => {});
// jsdom has no PointerEvent; MouseEvent carries the button/coords semantics Radix checks

(window as any).PointerEvent = (window as any).PointerEvent || MouseEvent;

/* ─── Transport fake ─── */

type DbRow = Record<string, any>;
interface Call { method: string; args: unknown[] }
interface Op {
  kind: "from" | "rpc";
  target: string;
  rpcArgs: unknown[];
  calls: Call[];
  /** The caller identity the "server" saw (the real signed-in user, never a View As target). */
  uid: string | null;
  /** Rows the fake returned (RPCs and selects), for scope assertions. */
  result?: DbRow[] | DbRow | null;
  /** Response delivered (false while pending; a "hang" op never completes). */
  done?: boolean;
  hang?: boolean;
}
type Mode = "ok" | "error" | "hang" | "empty";
type Resource = "campaigns" | "stats" | "lastDialed" | "profiles" | "organizations" | "prefs";

const h = vi.hoisted(() => ({
  /** Current useAuth() value — always one of the module-level persona objects (stable). */
  auth: null as unknown,
  /** Current usePermissions() value — always one of the module-level persona objects (stable). */
  perms: null as unknown,
  /** Route usePermissions to the REAL implementation (Super Admin role-string case). */
  realPermissions: false,
  ops: [] as Op[],
  control: {} as Partial<Record<Resource, Mode>>,
  db: {
    campaigns: [] as DbRow[],
    stats: {} as Record<string, DbRow>,
    lastDialed: {} as Record<string, string>,
    profiles: [] as DbRow[],
    organizations: [] as DbRow[],
    prefs: {} as Record<string, { settings: unknown; updated_at: string | null }>,
  },
  copySeq: 0,
  branding: {
    formatDate: (d: string | null | undefined) => (d ? `D:${String(d).slice(0, 10)}` : ""),
  },
}));

vi.mock("@/integrations/supabase/client", () => {
  const CHAIN = ["select", "eq", "neq", "is", "in", "order", "range", "limit", "update", "insert", "upsert", "delete"];
  const WRITES = new Set(["update", "insert", "upsert", "delete"]);
  const LEADERSHIP_RLS = ["Admin", "Super Admin", "Team Leader", "Team Lead"];
  const STATS_VIEW_ALL = ["Admin", "Team Leader", "Team Lead"];

  interface Me { uid: string | null; org: string | null; role: string | null; isSuper: boolean }
  function me(): Me {
    const a = h.auth as { user: { id: string } | null; realProfile: DbRow | null } | null;
    return {
      uid: a?.user?.id ?? null,
      org: a?.realProfile?.organization_id ?? null,
      role: a?.realProfile?.role ?? null,
      isSuper: a?.realProfile?.is_super_admin === true,
    };
  }
  const T = (t: unknown) => String(t ?? "").trim().toUpperCase();
  const isOpen = (c: DbRow) => T(c.type) === "OPEN POOL" || T(c.type) === "OPEN";
  const isPersonal = (c: DbRow) => T(c.type) === "PERSONAL";
  const isTeam = (c: DbRow) => T(c.type) === "TEAM";
  const member = (c: DbRow, uid: string) => Array.isArray(c.assigned_agent_ids) && c.assigned_agent_ids.map(String).includes(uid);

  /** public.campaigns_select: same org AND (super / leadership role / Open / own Personal / Team member). */
  function campaignsSelect(c: DbRow, m: Me): boolean {
    if (!m.uid || c.organization_id !== m.org) return false;
    return m.isSuper || LEADERSHIP_RLS.includes(m.role ?? "") || isOpen(c)
      || (isPersonal(c) && c.user_id === m.uid) || (isTeam(c) && member(c, m.uid));
  }
  /** get_campaign_card_stats `camp` CTE: Personal ONLY to its owner; Team to members and view-all roles. */
  function statsScope(c: DbRow, m: Me): boolean {
    if (!m.uid || c.organization_id !== m.org) return false;
    const viewAll = STATS_VIEW_ALL.includes(m.role ?? "") || m.isSuper;
    return isOpen(c) || (isPersonal(c) && c.user_id === m.uid) || (isTeam(c) && member(c, m.uid)) || (viewAll && isTeam(c));
  }

  const argsOf = (op: Op, method: string) => op.calls.filter((c) => c.method === method).map((c) => c.args);
  function applyFilters(rows: DbRow[], op: Op): DbRow[] {
    let out = rows;
    for (const [col, val] of argsOf(op, "eq")) out = out.filter((r) => r[col as string] === val);
    for (const [col, vals] of argsOf(op, "in")) out = out.filter((r) => (vals as unknown[]).includes(r[col as string]));
    for (const [col, val] of argsOf(op, "is")) out = out.filter((r) => (r[col as string] ?? null) === val);
    return out;
  }
  function applyOrder(rows: DbRow[], op: Op): DbRow[] {
    const orders = argsOf(op, "order") as [string, { ascending?: boolean; nullsFirst?: boolean } | undefined][];
    if (orders.length === 0) return rows;
    return [...rows].sort((a, b) => {
      for (const [col, o] of orders) {
        const av = a[col];
        const bv = b[col];
        if (av === bv) continue;
        if (av == null) return o?.nullsFirst ? -1 : 1;
        if (bv == null) return o?.nullsFirst ? 1 : -1;
        return (av < bv ? -1 : 1) * (o?.ascending === false ? -1 : 1);
      }
      return 0;
    });
  }
  function page(rows: DbRow[], op: Op): DbRow[] {
    const range = argsOf(op, "range").at(-1) as [number, number] | undefined;
    return range ? rows.slice(range[0], range[1] + 1) : rows;
  }
  function project(rows: DbRow[], op: Op): DbRow[] {
    const cols = argsOf(op, "select")[0]?.[0];
    if (typeof cols !== "string" || cols.trim() === "*") return rows;
    const keys = cols.split(",").map((s) => s.trim());
    return rows.map((r) => Object.fromEntries(keys.map((k) => [k, r[k] ?? null])));
  }
  const wantsCount = (op: Op) => {
    const opts = op.kind === "rpc" ? op.rpcArgs[1] : argsOf(op, "select")[0]?.[1];
    return (opts as { count?: string } | undefined)?.count === "exact";
  };
  function resourceOf(op: Op): Resource | null {
    if (op.kind === "rpc") return op.target === "get_campaign_card_stats" ? "stats" : op.target === "get_campaign_last_dialed" ? "lastDialed" : null;
    if (op.target === "user_preferences") return "prefs";
    if (op.target === "campaigns" || op.target === "profiles" || op.target === "organizations") return op.target;
    return null;
  }

  function write(op: Op, m: Me): { data: unknown; error: unknown } {
    const insert = argsOf(op, "insert")[0]?.[0] as DbRow | undefined;
    if (op.target === "campaigns" && insert) {
      h.copySeq += 1;
      h.db.campaigns.push({ ...insert, id: `c-copy-${h.copySeq}`, user_id: m.uid, created_at: `2026-10-09T12:00:0${h.copySeq}Z` });
      return { data: null, error: null };
    }
    if (op.target === "user_preferences" && insert) {
      h.db.prefs[String(insert.user_id)] = { settings: insert.settings, updated_at: "2026-10-09T12:00:00.000001+00:00" };
      return { data: null, error: null };
    }
    if (op.target === "user_preferences" && argsOf(op, "update").length > 0 && m.uid) {
      const row = h.db.prefs[m.uid];
      const cas = argsOf(op, "eq").find(([c]) => c === "updated_at")?.[1];
      if (!row || row.updated_at !== cas) return { data: [], error: null };
      row.settings = (argsOf(op, "update")[0][0] as DbRow).settings;
      row.updated_at = "2026-10-09T12:00:01.000001+00:00";
      return { data: [{ updated_at: row.updated_at }], error: null };
    }
    return { data: null, error: null };
  }

  function serve(op: Op, single: boolean): Promise<{ data: unknown; error: unknown; count?: number | null }> {
    const m = me();
    const resource = resourceOf(op);
    const mode = (resource && h.control[resource]) || "ok";
    if (mode === "hang") {
      op.hang = true;
      return new Promise(() => {});
    }
    if (mode === "error") return Promise.resolve({ data: null, error: { message: `${resource} failed`, code: "XX000" }, count: null });
    if (op.calls.some((c) => WRITES.has(c.method))) return Promise.resolve(write(op, m));

    if (op.kind === "rpc") {
      if (op.target === "get_campaign_card_stats") {
        const ids = (op.rpcArgs[0] as { p_campaign_ids?: string[] } | undefined)?.p_campaign_ids ?? null;
        const rows = h.db.campaigns
          .filter((c) => (ids === null || ids.includes(c.id)) && statsScope(c, m))
          .map((c) => ({
            campaign_id: c.id, total_leads: 0, called_leads: 0, contacted_leads: 0, converted_leads: 0, policies_sold: 0,
            ...h.db.stats[c.id],
          }));
        op.result = rows;
        return Promise.resolve({ data: rows, error: null });
      }
      if (op.target === "get_campaign_last_dialed") {
        const all = applyOrder(
          h.db.campaigns
            .filter((c) => c.organization_id === m.org && h.db.lastDialed[c.id])
            .map((c) => ({ campaign_id: c.id, last_dialed_at: h.db.lastDialed[c.id] })),
          op,
        );
        const rows = mode === "empty" ? [] : page(all, op);
        op.result = rows;
        return Promise.resolve({ data: rows, error: null, count: wantsCount(op) ? (mode === "empty" ? 0 : all.length) : null });
      }
      return Promise.resolve({ data: null, error: { message: `unknown rpc ${op.target}` } });
    }

    let base: DbRow[];
    switch (op.target) {
      case "campaigns": base = mode === "empty" ? [] : h.db.campaigns.filter((c) => campaignsSelect(c, m)); break;
      case "profiles": base = h.db.profiles.filter((p) => p.organization_id === m.org); break;
      case "organizations": base = h.db.organizations.filter((o) => o.id === m.org); break;
      case "user_preferences":
        base = Object.entries(h.db.prefs).filter(([uid]) => uid === m.uid)
          .map(([user_id, r]) => ({ user_id, settings: r.settings, updated_at: r.updated_at }));
        break;
      default: base = [];
    }
    const filtered = applyOrder(applyFilters(base, op), op);
    const rows = project(page(filtered, op), op);
    op.result = single ? rows[0] ?? null : rows;
    if (single) return Promise.resolve({ data: rows[0] ?? null, error: null });
    return Promise.resolve({ data: rows, error: null, count: wantsCount(op) ? filtered.length : null });
  }

  function builder(op: Op) {
    h.ops.push(op);
    let settled: Promise<unknown> | null = null;
    const run = (single: boolean) => (settled ??= serve(op, single).then((r) => {
      op.done = true;
      return r;
    }));
    const b: Record<string, unknown> = {};
    for (const method of CHAIN) {
      b[method] = (...args: unknown[]) => {
        op.calls.push({ method, args });
        return b;
      };
    }
    b.abortSignal = () => {
      op.calls.push({ method: "abortSignal", args: [] });
      return b;
    };
    b.maybeSingle = () => {
      op.calls.push({ method: "maybeSingle", args: [] });
      return run(true);
    };
    b.single = b.maybeSingle;
    b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => run(false).then(resolve, reject);
    return b;
  }

  return {
    supabase: {
      from: (target: string) => builder({ kind: "from", target, rpcArgs: [], calls: [], uid: me().uid }),
      rpc: (target: string, ...rpcArgs: unknown[]) => builder({ kind: "rpc", target, rpcArgs, calls: [], uid: me().uid }),
    },
  };
});

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => h.auth }));
vi.mock("@/contexts/BrandingContext", () => ({ useBranding: () => h.branding }));
vi.mock("@/hooks/usePermissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/usePermissions")>();
  return { usePermissions: () => (h.realPermissions ? actual.usePermissions() : h.perms) };
});

/* ─── Fixtures ─── */

const ORG1 = "org-1";
const ORG2 = "org-2";
const U = {
  agent: "u-agent", agent2: "u-agent2", tl: "u-tl", admin: "u-admin", superAdmin: "u-super", beta: "u-beta", ghost: "u-ghost",
};

function camp(over: Partial<CampaignRow> & Pick<CampaignRow, "id" | "name" | "type">, dbOnly: DbRow = {}): DbRow {
  return {
    status: "Active", description: null, assigned_agent_ids: [], tags: [], user_id: null, created_by: U.admin,
    created_at: "2026-01-01T10:00:00Z", organization_id: ORG1, retry_interval_minutes: null, retry_interval_hours: null,
    max_attempts: null, calling_hours_start: null, calling_hours_end: null, ring_timeout_seconds: null,
    total_leads: null, leads_called: null,
    // Unmaintained stored columns: never projected, never rendered.
    leads_contacted: 666, leads_converted: 777,
    ...over, ...dbOnly,
  };
}

const C = {
  open: camp({ id: "c-open", name: "Open Pool Alpha", type: "Open Pool", created_at: "2026-10-01T10:00:00Z", total_leads: 100, leads_called: 50, tags: ["inbound"] }),
  agentPersonal: camp({
    id: "c-agent-personal", name: "Agent Personal Book", type: "Personal", user_id: U.agent, created_by: U.agent,
    created_at: "2026-09-20T10:00:00Z", total_leads: 41, leads_called: 11,
  }),
  otherPersonal: camp({
    id: "c-other-personal", name: "Other Agent Personal", type: "Personal", status: "Paused", user_id: U.agent2, created_by: U.agent2,
    created_at: "2026-09-15T10:00:00Z", total_leads: 80, leads_called: 20,
  }),
  teamAssigned: camp({
    id: "c-team-assigned", name: "Team Assigned Push", type: "Team", assigned_agent_ids: [U.agent, U.tl], created_at: "2026-09-10T10:00:00Z",
  }),
  teamOther: camp({
    id: "c-team-other", name: "Team Other Push", type: "Team", status: "Draft", assigned_agent_ids: [U.agent2], created_at: "2026-09-05T10:00:00Z",
  }),
  tlPersonal: camp({
    id: "c-tl-personal", name: "Leader Personal Book", type: "Personal", status: "Completed", user_id: U.tl, created_by: U.tl,
    created_at: "2026-09-01T10:00:00Z", total_leads: 12, leads_called: 12,
  }),
  tlTeam: camp({
    id: "c-tl-team", name: "Leader Built Team", type: "Team", status: "Paused", assigned_agent_ids: [U.agent2], created_by: U.tl,
    created_at: "2026-08-25T10:00:00Z",
  }),
  beta: camp({ id: "c-beta", name: "Beta Org Campaign", type: "Open Pool", organization_id: ORG2, created_at: "2026-10-02T10:00:00Z" }),
};
const ORG1_CAMPAIGNS = [C.open, C.agentPersonal, C.otherPersonal, C.teamAssigned, C.teamOther, C.tlPersonal, C.tlTeam];

const stat = (total: number, called: number, contacted: number, converted: number) => ({
  total_leads: total, called_leads: called, contacted_leads: contacted, converted_leads: converted, policies_sold: converted + 1,
});
const STATS: Record<string, DbRow> = {
  [C.open.id]: stat(100, 50, 20, 5),
  [C.agentPersonal.id]: stat(40, 10, 4, 2),
  [C.otherPersonal.id]: stat(90, 30, 9, 3),
  [C.teamAssigned.id]: stat(60, 30, 12, 6),
  [C.teamOther.id]: stat(30, 3, 2, 1),
  [C.tlPersonal.id]: stat(12, 12, 6, 4),
  [C.tlTeam.id]: stat(25, 5, 2, 1),
  [C.beta.id]: stat(7, 3, 1, 1),
};

const person = (id: string, first: string, last: string, role: string, org = ORG1) => ({
  id, first_name: first, last_name: last, avatar_url: null, email: `${id}@example.test`, role, status: "Active", organization_id: org,
});
const PROFILES = [
  person(U.agent, "Avery", "Agent", "Agent"),
  person(U.agent2, "Blake", "Agent", "Agent"),
  person(U.tl, "Taylor", "Leader", "Team Leader"),
  person(U.admin, "Morgan", "Admin", "Admin"),
  person(U.superAdmin, "Sam", "Super", "Admin"),
  person(U.beta, "Bea", "Beta", "Admin", ORG2),
];

/* ─── Personas (module-level → stable references for every render) ─── */

interface ProfileLike { id: string; first_name: string; last_name: string; role: string; organization_id: string | null; is_super_admin: boolean }
const profile = (id: string, role: string, org: string | null, isSuper = false): ProfileLike => {
  const p = PROFILES.find((x) => x.id === id);
  return { id, first_name: p?.first_name ?? "Ghost", last_name: p?.last_name ?? "User", role, organization_id: org, is_super_admin: isSuper };
};
const authFor = (real: ProfileLike, viewAs?: ProfileLike) => ({
  user: { id: real.id },
  profile: viewAs ?? real,
  realProfile: real,
  isImpersonating: !!viewAs,
  session: null,
  isAuthenticated: true,
  isLoading: false,
  isBuildingOrganization: false,
});
const permsFor = (features: string[] | "all", scope: "own" | "all" = "own") => ({
  isLoading: false,
  hasFeatureAccess: (f: string) => features === "all" || features.includes(f),
  getDataScope: () => scope,
  hasPageAccess: () => true,
  hasContactsPermission: () => true,
});

const P = {
  agent: profile(U.agent, "Agent", ORG1),
  tl: profile(U.tl, "Team Leader", ORG1),
  admin: profile(U.admin, "Admin", ORG1),
  superAdmin: profile(U.superAdmin, "Admin", ORG1, true),
  beta: profile(U.beta, "Admin", ORG2),
};
const PERSONAS = {
  agent: { auth: authFor(P.agent), perms: permsFor([]) },
  agentViewAll: { auth: authFor(P.agent), perms: permsFor(["View All Campaigns"]) },
  tlViewAll: { auth: authFor(P.tl), perms: permsFor(["Create Campaigns", "View All Campaigns"]) },
  tlNoViewAll: { auth: authFor(P.tl), perms: permsFor(["Create Campaigns"]) },
  admin: { auth: authFor(P.admin), perms: permsFor("all", "all") },
  superAdmin: { auth: authFor(P.superAdmin), perms: permsFor("all", "all") },
  beta: { auth: authFor(P.beta), perms: permsFor("all", "all") },
  adminViewingAsAgent: { auth: authFor(P.admin, P.agent), perms: permsFor([]) },
  noOrg: { auth: authFor(profile(U.ghost, "Admin", null)), perms: permsFor("all", "all") },
  superAdminRoleString: { auth: authFor(profile(U.ghost, "Super Admin", ORG1)), perms: null },
  superAdminRoleStringFlagged: { auth: authFor(profile(U.ghost, "Super Admin", ORG1, true)), perms: null },
  adminRealPerms: { auth: authFor(P.admin), perms: null },
};
type PersonaKey = keyof typeof PERSONAS;
function actAs(key: PersonaKey) {
  h.auth = PERSONAS[key].auth;
  h.perms = PERSONAS[key].perms;
}

/* ─── Harness ─── */

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: Infinity } } });
}

function renderPage(extra?: React.ReactNode, wrapPage: (page: React.ReactNode) => React.ReactNode = (p) => p) {
  const client = makeClient();
  const tree = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/campaigns"]}>
        <TooltipProvider>
          {wrapPage(<PageGuard pageName="Campaigns"><Campaigns /></PageGuard>)}
          {extra}
          <LocationProbe />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const utils = render(tree());
  return { ...utils, client, rerenderPage: () => utils.rerender(tree()) };
}

const originalMatchMedia = window.matchMedia;
function setViewport(desktop: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: desktop, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const rowIds = () => screen.queryAllByTestId(/^campaign-row-/).map((el) => el.getAttribute("data-testid")!.slice("campaign-row-".length));
const rowEl = (id: string) => screen.getByTestId(`campaign-row-${id}`);
const idsOf = (rows: DbRow[]) => rows.map((r) => r.id as string);
const sortedIds = (rows: DbRow[]) => idsOf(rows).sort();

/** Every answered request rendered: list loaded, metrics and identities resolved (never a skeleton frame). */
async function settle() {
  await waitFor(() => {
    expect(h.ops.filter((o) => !o.done && !o.hang)).toEqual([]);
    expect(screen.queryByTestId("campaigns-skeleton")).toBeNull();
    expect(screen.queryAllByTestId("metric-loading")).toHaveLength(0);
    expect(screen.queryAllByTestId("agents-loading")).toHaveLength(0);
  });
  // Flush TanStack's batched notifications (setTimeout 0) so the last responses are committed.
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

function openDetails(row: DbRow): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: `Show details for ${row.name}` }));
  return screen.getByTestId(`campaign-details-${row.id}`);
}
function detail(details: HTMLElement, label: string): HTMLElement {
  return within(details).getByText(label, { selector: "dt" }).nextElementSibling as HTMLElement;
}

async function openRowMenu(row: DbRow): Promise<HTMLElement> {
  fireEvent.pointerDown(screen.getByRole("button", { name: `More actions for ${row.name}` }), { button: 0, ctrlKey: false, pointerId: 1 });
  return screen.findByRole("menuitem", { name: /^Duplicate/ });
}
async function closeMenu() {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
}
async function duplicateState(row: DbRow): Promise<{ disabled: boolean; text: string }> {
  const item = await openRowMenu(row);
  const state = { disabled: item.getAttribute("aria-disabled") === "true", text: item.textContent ?? "" };
  await closeMenu();
  return state;
}

async function choose(trigger: string, option: string) {
  fireEvent.keyDown(screen.getByRole("combobox", { name: trigger }), { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: option }));
  await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
}

const opsFor = (target: string) => h.ops.filter((o) => o.target === target);
const hasCall = (op: Op, method: string) => op.calls.some((c) => c.method === method);
const statsOps = () => h.ops.filter((o) => o.kind === "rpc" && o.target === "get_campaign_card_stats");
const requestedStatsIds = () => statsOps().flatMap((o) => (o.rpcArgs[0] as { p_campaign_ids: string[] }).p_campaign_ids);
const returnedStatsIds = () => statsOps().flatMap((o) => ((o.result as DbRow[] | undefined) ?? []).map((r) => r.campaign_id as string));
const prefsWrites = () => opsFor("user_preferences").filter((o) => ["insert", "update", "upsert", "delete"].some((m) => hasCall(o, m)));

/* ─── Global setup ─── */

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  h.ops = [];
  h.control = {};
  h.copySeq = 0;
  h.realPermissions = false;
  h.db.campaigns = [...ORG1_CAMPAIGNS, C.beta].map((c) => ({ ...c }));
  h.db.stats = { ...STATS };
  h.db.lastDialed = { [C.open.id]: "2026-10-09T09:00:00.000Z", [C.teamAssigned.id]: "2026-10-08T15:00:00.000Z" };
  h.db.profiles = PROFILES.map((p) => ({ ...p }));
  h.db.organizations = [{ id: ORG1, status: "active" }, { id: ORG2, status: "active" }];
  h.db.prefs = {};
  actAs("admin");
  consoleError = vi.spyOn(console, "error");
});
afterEach(() => {
  window.matchMedia = originalMatchMedia;
  const offending = consoleError.mock.calls
    .map((args) => args.map(String).join(" "))
    .filter((msg) => /not wrapped in act|unique "key" prop|Maximum update depth|getSnapshot should be cached/.test(msg));
  consoleError.mockRestore();
  expect(offending).toEqual([]);
});

/* ─── Both layouts ─── */

describe.each([
  ["stacked (default viewport)", false],
  ["desktop table (xl)", true],
] as const)("Campaigns page — %s", (_label, desktop) => {
  beforeEach(() => setViewport(desktop));

  it("mounts exactly one layout; the Columns control and sort headers exist only on desktop", async () => {
    renderPage();
    await settle();
    expect(screen.getAllByLabelText("Campaigns")).toHaveLength(1);
    if (desktop) {
      expect(screen.getByRole("table", { name: "Campaigns" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Columns" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Campaign" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Agents" })).toBeNull(); // Agents is never sortable
    } else {
      expect(screen.queryByRole("table")).toBeNull();
      expect(screen.getByRole("list", { name: "Campaigns" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Columns" })).toBeNull();
    }
  });

  describe("role matrix", () => {
    it("Agent: Open Pool, own Personal and assigned Team only; no New Campaign, no Duplicate, counts not names", async () => {
      actAs("agent");
      renderPage();
      await settle();
      expect(rowIds().sort()).toEqual(sortedIds([C.open, C.agentPersonal, C.teamAssigned]));
      expect(screen.getByLabelText("3 campaigns")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "New Campaign" })).toBeNull();
      expect(screen.queryByRole("button", { name: /^More actions for/ })).toBeNull();
      // Metrics come from the RPC (40 / 10), never the stored trigger columns (41 / 11).
      expect(within(rowEl(C.agentPersonal.id)).getByTestId("lead-progress")).toHaveTextContent("10 / 40");

      const team = openDetails(C.teamAssigned);
      expect(detail(team, "Assigned agents")).toHaveTextContent("2 assigned");
      expect(detail(team, "Assigned agents")).not.toHaveTextContent("Avery");
      expect(detail(team, "Converted")).toHaveTextContent("6");
      if (desktop) {
        expect(within(rowEl(C.teamAssigned.id)).getByText("2 assigned")).toBeInTheDocument();
        expect(within(rowEl(C.agentPersonal.id)).getByText("1 assigned")).toBeInTheDocument();
        expect(within(rowEl(C.open.id)).getByText("Open to agency")).toBeInTheDocument();
        expect(screen.queryByTestId("agents-stack")).toBeNull();
      } else {
        const open = openDetails(C.open);
        expect(detail(open, "Assigned agents")).toHaveTextContent("Open to agency");
      }
      // No identities or create-modal roster are requested for a non-leadership, non-creator viewer.
      expect(opsFor("profiles")).toHaveLength(0);
      expect(document.body.textContent).not.toMatch(/Blake|Taylor|Morgan/);
    });

    it("Agent with View All Campaigns: visibility is still what RLS returns, and the RPC omits none of it", async () => {
      actAs("agentViewAll");
      renderPage();
      await settle();
      const visible = [C.open, C.agentPersonal, C.teamAssigned];
      expect(rowIds().sort()).toEqual(sortedIds(visible));
      expect(screen.queryByText("Team Other Push")).toBeNull();
      expect(screen.queryByText("Other Agent Personal")).toBeNull();
      expect([...new Set(returnedStatsIds())].sort()).toEqual(sortedIds(visible));
      for (const r of visible) {
        const d = openDetails(r);
        for (const label of ["Total leads", "Called", "Contacted", "Converted"]) {
          expect(detail(d, label)).not.toHaveTextContent("Not available for this campaign");
          expect(detail(d, label)).not.toHaveTextContent("Metrics unavailable");
        }
      }
      expect(screen.queryByRole("button", { name: "New Campaign" })).toBeNull();
    });

    it("Team Leader with View All: every Team campaign, never another user's Personal; Duplicate only on own/assigned", async () => {
      actAs("tlViewAll");
      renderPage();
      await settle();
      const visible = [C.open, C.teamAssigned, C.teamOther, C.tlPersonal, C.tlTeam];
      expect(rowIds().sort()).toEqual(sortedIds(visible));
      expect(screen.queryByText("Agent Personal Book")).toBeNull();
      expect(screen.queryByText("Other Agent Personal")).toBeNull();
      // RLS hands a Team Leader the org's Personal rows; the management scope drops them before metrics are requested.
      expect(opsFor("campaigns")[0].result as DbRow[]).toHaveLength(ORG1_CAMPAIGNS.length);
      expect([...new Set(requestedStatsIds())].sort()).toEqual(sortedIds(visible));
      expect(screen.getByRole("button", { name: "New Campaign" })).toBeEnabled();

      expect(await duplicateState(C.tlPersonal)).toMatchObject({ disabled: false });
      expect(await duplicateState(C.teamAssigned)).toMatchObject({ disabled: false });
      expect(await duplicateState(C.tlTeam)).toMatchObject({ disabled: false });
      const open = await duplicateState(C.open);
      expect(open.disabled).toBe(true);
      expect(open.text).toContain("Only the campaign owner can duplicate");
      expect((await duplicateState(C.teamOther)).disabled).toBe(true);

      // Leadership sees identities.
      const d = openDetails(C.teamAssigned);
      expect(detail(d, "Assigned agents")).toHaveTextContent("Avery Agent, Taylor Leader");
      if (desktop) {
        expect(within(rowEl(C.teamAssigned.id)).getByTestId("agents-stack")).toHaveTextContent("Avery Agent, Taylor Leader");
      }
    });

    it("Team Leader without View All: only Open Pool, own Personal and assigned Team", async () => {
      actAs("tlNoViewAll");
      renderPage();
      await settle();
      expect(rowIds().sort()).toEqual(sortedIds([C.open, C.teamAssigned, C.tlPersonal]));
      for (const hiddenName of ["Team Other Push", "Leader Built Team", "Agent Personal Book", "Other Agent Personal"]) {
        expect(screen.queryByText(hiddenName)).toBeNull();
      }
      expect((await duplicateState(C.tlPersonal)).disabled).toBe(false);
      expect((await duplicateState(C.open)).disabled).toBe(true);
    });

    it("Admin: sees agents' Personal campaigns; RPC-omitted rows use stored Total/Called and show — for Converted", async () => {
      renderPage();
      await settle();
      expect(rowIds().sort()).toEqual(sortedIds(ORG1_CAMPAIGNS));
      expect(screen.getByLabelText("7 campaigns")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "New Campaign" })).toBeEnabled();
      expect([...new Set(requestedStatsIds())].sort()).toEqual(sortedIds(ORG1_CAMPAIGNS));
      expect(returnedStatsIds()).not.toContain(C.otherPersonal.id);

      // D1-B: stored trigger-maintained columns for the omitted Personal rows.
      expect(within(rowEl(C.otherPersonal.id)).getByTestId("lead-progress")).toHaveTextContent("20 / 80");
      expect(within(rowEl(C.agentPersonal.id)).getByTestId("lead-progress")).toHaveTextContent("11 / 41");
      // Rows the RPC did return keep the RPC values.
      expect(within(rowEl(C.teamOther.id)).getByTestId("lead-progress")).toHaveTextContent("3 / 30");

      const d = openDetails(C.otherPersonal);
      expect(detail(d, "Total leads")).toHaveTextContent("80");
      expect(detail(d, "Called")).toHaveTextContent("20");
      expect(detail(d, "Converted")).toHaveTextContent("Not available for this campaign");
      expect(detail(d, "Contacted")).toHaveTextContent("Not available for this campaign");
      expect(detail(d, "Owner")).toHaveTextContent("Blake Agent");
      if (desktop) {
        expect(within(rowEl(C.otherPersonal.id)).getByText("Not available for this campaign")).toBeInTheDocument();
        expect(within(rowEl(C.teamAssigned.id)).getByText("6")).toBeInTheDocument();
      }
      // The unmaintained stored contacted/converted columns are never requested or rendered.
      const projection = String(opsFor("campaigns")[0].calls.find((c) => c.method === "select")?.args[0]);
      expect(projection).toBe(CAMPAIGN_LIST_COLUMNS);
      expect(projection).not.toMatch(/leads_contacted|leads_converted/);
      expect(document.body.textContent).not.toMatch(/777|666/);
      // Lead progress is never labelled with a lifecycle word.
      expect(screen.queryByText(/Untouched/i)).toBeNull();
      expect(document.body.textContent).not.toMatch(/Untouched/i);

      expect((await duplicateState(C.otherPersonal)).disabled).toBe(false);
    });

    it("Super Admin (role Admin + is_super_admin): the same org-wide scope and the same fallback", async () => {
      actAs("superAdmin");
      renderPage();
      await settle();
      expect(rowIds().sort()).toEqual(sortedIds(ORG1_CAMPAIGNS));
      expect(screen.getByRole("button", { name: "New Campaign" })).toBeEnabled();
      expect(within(rowEl(C.tlPersonal.id)).getByTestId("lead-progress")).toHaveTextContent("12 / 12");
      const d = openDetails(C.tlPersonal);
      expect(detail(d, "Converted")).toHaveTextContent("Not available for this campaign");
      expect((await duplicateState(C.tlPersonal)).disabled).toBe(false);
    });
  });

  describe("states", () => {
    it("loading shows the skeleton and never a 0 metric", async () => {
      h.control.campaigns = "hang";
      renderPage();
      expect(await screen.findByTestId("campaigns-skeleton")).toBeInTheDocument();
      await act(async () => { await Promise.resolve(); });
      expect(screen.getByTestId("campaigns-skeleton")).toBeInTheDocument();
      expect(screen.queryByText("0")).toBeNull();
      expect(screen.queryByText("No campaigns yet")).toBeNull();
      expect(screen.queryByLabelText(/^\d+ campaigns$/)).toBeNull();
    });

    it("metrics still loading render skeletons for every row, never 0", async () => {
      h.control.stats = "hang";
      renderPage();
      await screen.findByTestId(`campaign-row-${C.open.id}`);
      expect(screen.getAllByTestId("metric-loading").length).toBeGreaterThanOrEqual(ORG1_CAMPAIGNS.length * 2);
      expect(screen.queryByText("0")).toBeNull();
      expect(document.body.textContent).not.toMatch(/\b0 \/ 0\b/);
      expect(screen.queryByText("Metrics unavailable.")).toBeNull();
    });

    it("a failed list shows Couldn't load campaigns. with Retry — never No campaigns yet — and Retry recovers", async () => {
      h.control.campaigns = "error";
      renderPage();
      expect(await screen.findByText("Couldn't load campaigns.")).toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load campaigns.");
      expect(screen.queryByText("No campaigns yet")).toBeNull();
      expect(screen.queryByText("0")).toBeNull();
      h.control.campaigns = "ok";
      fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "Retry" }));
      await waitFor(() => expect(rowIds()).toHaveLength(ORG1_CAMPAIGNS.length));
      await settle();
      expect(screen.queryByText("Couldn't load campaigns.")).toBeNull();
    });

    it("an empty organization shows No campaigns yet with New Campaign for a creator", async () => {
      h.control.campaigns = "empty";
      renderPage();
      expect(await screen.findByText("No campaigns yet")).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: "New Campaign" })).toHaveLength(2); // header + empty state
      expect(screen.queryByText("Couldn't load campaigns.")).toBeNull();
      expect(statsOps()).toHaveLength(0); // nothing visible → no metrics request
    });

    it("an empty list for a non-creator shows No campaigns yet without New Campaign", async () => {
      actAs("agent");
      h.control.campaigns = "empty";
      renderPage();
      expect(await screen.findByText("No campaigns yet")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "New Campaign" })).toBeNull();
    });

    it("filtered-empty shows No campaigns match; Reset filters restores the full list", async () => {
      renderPage();
      await settle();
      fireEvent.change(screen.getByRole("textbox", { name: "Search campaigns" }), { target: { value: "zzz-no-match" } });
      expect(await screen.findByText("No campaigns match")).toBeInTheDocument();
      expect(screen.queryByText("No campaigns yet")).toBeNull();
      expect(screen.getByLabelText("7 campaigns")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
      await waitFor(() => expect(rowIds()).toHaveLength(ORG1_CAMPAIGNS.length));
      expect(screen.getByRole("textbox", { name: "Search campaigns" })).toHaveValue("");
      expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
    });

    it("a failed metrics request shows Metrics unavailable. and dashes (never 0); Retry recovers", async () => {
      h.control.stats = "error";
      renderPage();
      expect(await screen.findByText("Metrics unavailable.")).toBeInTheDocument();
      expect(screen.queryAllByTestId("metric-loading")).toHaveLength(0);
      const progress = within(rowEl(C.open.id)).getByTestId("lead-progress");
      expect(within(progress).getAllByText("Metrics unavailable")).toHaveLength(2); // called + total
      expect(within(progress).getAllByText("—")).toHaveLength(2);
      expect(screen.queryByText("0")).toBeNull();
      // Even rows the RPC would omit render the error dash, not stored values, while the request failed.
      expect(within(rowEl(C.otherPersonal.id)).getByTestId("lead-progress")).not.toHaveTextContent("20");

      h.control.stats = "ok";
      const notice = screen.getByText("Metrics unavailable.").closest("[role='status']") as HTMLElement;
      fireEvent.click(within(notice).getByRole("button", { name: "Retry" }));
      await waitFor(() => expect(screen.queryByText("Metrics unavailable.")).toBeNull());
      await settle();
      expect(within(rowEl(C.open.id)).getByTestId("lead-progress")).toHaveTextContent("50 / 100");
    });
  });

  describe("filters, search and sort", () => {
    it("search, type and status combine; Reset appears only when the view is not the default", async () => {
      renderPage();
      await settle();
      expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();

      fireEvent.change(screen.getByRole("textbox", { name: "Search campaigns" }), { target: { value: "TEAM" } });
      await waitFor(() => expect(rowIds().sort()).toEqual(sortedIds([C.teamAssigned, C.teamOther, C.tlTeam])));
      expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();

      await choose("Campaign type", "Team");
      expect(rowIds().sort()).toEqual(sortedIds([C.teamAssigned, C.teamOther, C.tlTeam]));
      await choose("Campaign status", "Paused");
      expect(rowIds()).toEqual([C.tlTeam.id]);

      fireEvent.change(screen.getByRole("textbox", { name: "Search campaigns" }), { target: { value: "push" } });
      expect(await screen.findByText("No campaigns match")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Reset" }));
      await waitFor(() => expect(rowIds()).toHaveLength(ORG1_CAMPAIGNS.length));
      expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
      expect(screen.getByRole("combobox", { name: "Campaign type" })).toHaveTextContent("All types");
      expect(screen.getByRole("combobox", { name: "Campaign status" })).toHaveTextContent("All statuses");

      await choose("Campaign type", "Personal");
      expect(rowIds().sort()).toEqual(sortedIds([C.agentPersonal, C.otherPersonal, C.tlPersonal]));
      fireEvent.click(screen.getByRole("button", { name: "Reset" }));
      await waitFor(() => expect(rowIds()).toHaveLength(ORG1_CAMPAIGNS.length));
    });

    it("the sort select and direction toggle order the FULL set, not just the rendered page", async () => {
      actAs("agent");
      const bulk = Array.from({ length: 150 }, (_, i) => {
        const n = String(i).padStart(3, "0");
        return camp({ id: `c-bulk-${n}`, name: `Bulk ${n}`, type: "Open Pool", created_at: `2026-0${1 + Math.floor(i / 30)}-${String(1 + (i % 28)).padStart(2, "0")}T10:00:${n.slice(1)}Z` });
      });
      h.db.campaigns = bulk;
      h.db.stats = Object.fromEntries(bulk.map((r, i) => [r.id, stat(150 - i + 1, 1, 1, 1)]));
      renderPage();
      await settle();
      expect(screen.getByText("Showing 100 of 150")).toBeInTheDocument();
      expect(rowIds()).toHaveLength(100);
      const newestFirst = [...bulk].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      expect(rowIds()[0]).toBe(newestFirst[0].id);
      expect(rowIds()).not.toContain("c-bulk-000");
      expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();

      await choose("Sort by", "Name");
      expect(rowIds()[0]).toBe("c-bulk-000");
      expect(rowIds()[99]).toBe("c-bulk-099");
      expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Sorted ascending, switch to descending" }));
      await waitFor(() => expect(rowIds()[0]).toBe("c-bulk-149"));

      // Metric sorts read the resolved metrics for every row: the largest total is the oldest row.
      await choose("Sort by", "Total leads");
      expect(rowIds()[0]).toBe("c-bulk-000");
      fireEvent.click(screen.getByRole("button", { name: "Show more" }));
      await waitFor(() => expect(rowIds()).toHaveLength(150));
      expect(screen.queryByText(/Showing \d+ of/)).toBeNull();
    }, 30_000);
  });

  describe("agency lock (organizations.status = suspended)", () => {
    it("disables the header New Campaign and Duplicate", async () => {
      h.db.organizations = [{ id: ORG1, status: "suspended" }];
      renderPage();
      await settle();
      await waitFor(() => expect(screen.getByRole("button", { name: "New Campaign" })).toBeDisabled());
      expect(screen.getByRole("button", { name: "New Campaign" })).toHaveAttribute("title", expect.stringMatching(/suspended\/archived/));
      const item = await openRowMenu(C.open);
      expect(item).toHaveAttribute("aria-disabled", "true");
      expect(item).toHaveTextContent("Unavailable while the agency is suspended or archived");
      fireEvent.click(item);
      expect(screen.queryByRole("alertdialog")).toBeNull();
      await closeMenu();
    });

    it("disables the empty-state New Campaign", async () => {
      h.db.organizations = [{ id: ORG1, status: "suspended" }];
      h.control.campaigns = "empty";
      renderPage();
      expect(await screen.findByText("No campaigns yet")).toBeInTheDocument();
      await waitFor(() => {
        const buttons = screen.getAllByRole("button", { name: "New Campaign" });
        expect(buttons).toHaveLength(2);
        for (const b of buttons) expect(b).toBeDisabled();
      });
    });

    it("a failed organization read fails open (unchanged semantics)", async () => {
      h.control.organizations = "error";
      renderPage();
      await settle();
      await waitFor(() => expect(opsFor("organizations")).toHaveLength(1));
      expect(screen.getByRole("button", { name: "New Campaign" })).toBeEnabled();
    });
  });

  describe("column preferences", () => {
    it("rendering issues user_preferences reads only — no insert/update on load or on re-render", async () => {
      h.db.prefs[U.admin] = {
        settings: {
          theme: "dark",
          // Predates `last_dialed`: normalization fills it in at render and must not write it back.
          campaigns_table: { v: 1, orgs: { [ORG1]: { order: ["status", "progress", "agents", "converted", "contacted", "created", "tags"], hidden: ["converted", "contacted", "tags"] } } },
        },
        updated_at: "2026-10-01T00:00:00.123456+00:00",
      };
      const { rerenderPage } = renderPage();
      await settle();
      await waitFor(() => expect(opsFor("user_preferences")).toHaveLength(1));
      const [read] = opsFor("user_preferences");
      expect(hasCall(read, "select")).toBe(true);
      expect(hasCall(read, "maybeSingle")).toBe(true);
      expect(read.calls.find((c) => c.method === "eq")?.args).toEqual(["user_id", U.admin]);
      if (desktop) {
        await waitFor(() => expect(screen.getByRole("columnheader", { name: "Created" })).toBeInTheDocument());
        expect(screen.queryByRole("columnheader", { name: "Converted" })).toBeNull();
        expect(screen.getByRole("button", { name: "Columns" })).toBeEnabled();
      }

      rerenderPage();
      fireEvent.change(screen.getByRole("textbox", { name: "Search campaigns" }), { target: { value: "open" } });
      await waitFor(() => expect(rowIds()).toEqual([C.open.id]));
      rerenderPage();
      await settle();
      expect(prefsWrites()).toEqual([]);
      expect(opsFor("user_preferences")).toHaveLength(1);
      expect(h.db.prefs[U.admin].updated_at).toBe("2026-10-01T00:00:00.123456+00:00");
    });

    it("View As (isImpersonating) issues no user_preferences request at all", async () => {
      actAs("adminViewingAsAgent");
      renderPage();
      await settle();
      expect(rowIds().length).toBeGreaterThan(0);
      await act(async () => { await Promise.resolve(); });
      expect(opsFor("user_preferences")).toEqual([]);
      if (desktop) expect(screen.getByRole("button", { name: "Columns" })).toBeDisabled();
    });
  });
});

/* ─── Desktop-only interactions ─── */

describe("Campaigns page — desktop table interactions", () => {
  beforeEach(() => setViewport(true));

  it("header sort operates over the full set and mirrors aria-sort", async () => {
    actAs("agent");
    const bulk = Array.from({ length: 120 }, (_, i) => {
      const n = String(i).padStart(3, "0");
      return camp({ id: `c-bulk-${n}`, name: `Bulk ${n}`, type: "Open Pool", created_at: `2026-05-${String(1 + (i % 28)).padStart(2, "0")}T${String(Math.floor(i / 28)).padStart(2, "0")}:00:00Z` });
    });
    h.db.campaigns = bulk;
    h.db.stats = Object.fromEntries(bulk.map((r, i) => [r.id, stat(100, 100 - (i % 100), 1, i)]));
    renderPage();
    await settle();
    expect(rowIds()).not.toContain("c-bulk-000");

    const campaignHeader = screen.getByRole("columnheader", { name: "Campaign" });
    expect(campaignHeader).toHaveAttribute("aria-sort", "none");
    fireEvent.click(within(campaignHeader).getByRole("button", { name: "Campaign" }));
    await waitFor(() => expect(rowIds()[0]).toBe("c-bulk-000"));
    expect(campaignHeader).toHaveAttribute("aria-sort", "ascending");
    expect(screen.getByRole("combobox", { name: "Sort by" })).toHaveTextContent("Name");
    fireEvent.click(within(campaignHeader).getByRole("button", { name: "Campaign" }));
    await waitFor(() => expect(rowIds()[0]).toBe("c-bulk-119"));
    expect(campaignHeader).toHaveAttribute("aria-sort", "descending");

    // Converted (desc by default): the highest converted value is the last-created id.
    const convertedHeader = screen.getByRole("columnheader", { name: "Converted" });
    fireEvent.click(within(convertedHeader).getByRole("button", { name: "Converted" }));
    await waitFor(() => expect(rowIds()[0]).toBe("c-bulk-119"));
    expect(convertedHeader).toHaveAttribute("aria-sort", "descending");
    expect(campaignHeader).toHaveAttribute("aria-sort", "none");
    fireEvent.click(within(convertedHeader).getByRole("button", { name: "Converted" }));
    await waitFor(() => expect(rowIds()[0]).toBe("c-bulk-000"));
  }, 30_000);

  it("Columns: Cancel never writes; Save writes once for this org and applies the layout", async () => {
    renderPage();
    await settle();
    await waitFor(() => expect(screen.getByRole("button", { name: "Columns" })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Show Contacted" }));
    expect(screen.getByRole("columnheader", { name: "Contacted" })).toBeInTheDocument(); // live preview
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("columnheader", { name: "Contacted" })).toBeNull());
    expect(prefsWrites()).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Show Contacted" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("checkbox", { name: "Show Contacted" })).toBeNull());
    expect(screen.getByRole("columnheader", { name: "Contacted" })).toBeInTheDocument();
    const writes = prefsWrites();
    expect(writes).toHaveLength(1);
    const payload = writes[0].calls.find((c) => c.method === "insert")?.args[0] as DbRow;
    expect(payload.user_id).toBe(U.admin);
    expect(payload.settings.campaigns_table.v).toBe(1);
    expect(Object.keys(payload.settings.campaigns_table.orgs)).toEqual([ORG1]);
    expect(payload.settings.campaigns_table.orgs[ORG1].hidden).not.toContain("contacted");
  });

  it("Duplicate inserts a Draft configuration copy (no leads) and refreshes the list", async () => {
    renderPage();
    await settle();
    fireEvent.click(await openRowMenu(C.teamAssigned));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Team Assigned Push");
    expect(opsFor("campaigns").filter((o) => hasCall(o, "insert"))).toHaveLength(0);
    const listReads = opsFor("campaigns").length;
    fireEvent.click(within(dialog).getByRole("button", { name: "Duplicate" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    const insert = opsFor("campaigns").find((o) => hasCall(o, "insert"))!;
    expect(insert.calls.find((c) => c.method === "insert")?.args[0]).toMatchObject({
      name: "Team Assigned Push (Copy)", type: "Team", status: "Draft", total_leads: 0, leads_contacted: 0, leads_converted: 0,
      created_by: U.admin, organization_id: ORG1,
    });
    expect(await screen.findByText("Team Assigned Push (Copy)")).toBeInTheDocument();
    expect(opsFor("campaigns").length).toBeGreaterThan(listReads + 1);
    expect(opsFor("campaign_leads")).toHaveLength(0);
  });

  it("Open navigates to the campaign; the chevron toggles details without navigating", async () => {
    renderPage();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: `Show details for ${C.open.name}` }));
    expect(screen.getByTestId(`campaign-details-${C.open.id}`)).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/campaigns");
    expect(screen.getByTestId("location")).not.toHaveTextContent(C.open.id);
    fireEvent.click(screen.getByRole("button", { name: `Open ${C.open.name}` }));
    expect(screen.getByTestId("location")).toHaveTextContent(`/campaigns/${C.open.id}`);
  });
});

/* ─── No organization ─── */

describe("Campaigns page — identity without an organization", () => {
  it("shows Couldn't load campaigns. (never empty, never a stuck skeleton) and issues no campaigns request", async () => {
    actAs("noOrg");
    renderPage();
    expect(await screen.findByText("Couldn't load campaigns.")).toBeInTheDocument();
    expect(screen.queryByText("No campaigns yet")).toBeNull();
    expect(screen.queryByTestId("campaigns-skeleton")).toBeNull();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(opsFor("campaigns")).toEqual([]);
    expect(opsFor("user_preferences")).toEqual([]);
    expect(statsOps()).toEqual([]);
  });

  // Regression: with no organization there is nothing to retry — no Retry control and no unscoped read.
  it("no organization offers no Retry and never sends an unscoped (organization_id = null) campaigns read", async () => {
    actAs("noOrg");
    renderPage();
    const alert = await screen.findByRole("alert");
    expect(within(alert).queryByRole("button", { name: "Retry" })).toBeNull();
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(opsFor("campaigns")).toEqual([]);
    expect(screen.getByText("Couldn't load campaigns.")).toBeInTheDocument();
  });
});

/* ─── Real PageGuard + real usePermissions ─── */

describe("Campaigns route — real PageGuard + real usePermissions", () => {
  beforeEach(() => { h.realPermissions = true; });

  it.each(["superAdminRoleString", "superAdminRoleStringFlagged"] as const)(
    "a \"Super Admin\" role string (%s) stays on the spinner and issues no campaigns query (pre-existing behavior)",
    async (key) => {
      actAs(key);
      const { container } = renderPage();
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      // DB_ROLE_TO_KEY has no "Super Admin" entry, so usePermissions keeps waiting for a role key.
      expect(container.querySelector(".animate-spin")).not.toBeNull();
      expect(screen.queryByRole("heading", { name: "Campaigns" })).toBeNull();
      expect(opsFor("campaigns")).toEqual([]);
      expect(opsFor("role_permissions")).toEqual([]);
      expect(statsOps()).toEqual([]);
      expect(opsFor("user_preferences")).toEqual([]);
    },
  );

  it("positive control: an Admin through the real chain reaches the page and loads campaigns", async () => {
    actAs("adminRealPerms");
    renderPage();
    expect(await screen.findByRole("heading", { name: "Campaigns" })).toBeInTheDocument();
    await settle();
    expect(opsFor("role_permissions")).toHaveLength(1);
    expect(rowIds()).toHaveLength(ORG1_CAMPAIGNS.length);
    expect(screen.getByRole("button", { name: "New Campaign" })).toBeEnabled();
  });
});

/* ─── Identity switch ─── */

describe("Campaigns page — identity switch", () => {
  it.each([false, true])("never commits user A's campaigns after switching to user B (desktop=%s)", async (desktop) => {
    setViewport(desktop);
    const commits: string[] = [];
    const snapshot = () => commits.push(document.body.textContent ?? "");
    function CommitSpy() {
      useLayoutEffect(() => { snapshot(); });
      return null;
    }
    actAs("admin");
    const { rerenderPage } = renderPage(<CommitSpy />, (page) => <Profiler id="campaigns" onRender={snapshot}>{page}</Profiler>);
    await settle();
    const aNames = ORG1_CAMPAIGNS.map((c) => c.name as string);
    for (const name of aNames) expect(screen.getByText(name)).toBeInTheDocument();

    const switchAt = commits.length;
    actAs("beta");
    rerenderPage();
    expect(await screen.findByText("Beta Org Campaign")).toBeInTheDocument();
    await settle();

    const after = commits.slice(switchAt);
    expect(after.length).toBeGreaterThan(1);
    for (const text of after) for (const name of aNames) expect(text).not.toContain(name);
    expect(rowIds()).toEqual([C.beta.id]);
    expect(screen.getByLabelText("1 campaigns")).toBeInTheDocument();
    // B's requests were made as B, scoped to B's organization.
    const bList = opsFor("campaigns").filter((o) => o.uid === U.beta);
    expect(bList.length).toBeGreaterThan(0);
    for (const op of bList) expect(op.calls.find((c) => c.method === "eq")?.args).toEqual(["organization_id", ORG2]);
    const prefsReads = opsFor("user_preferences").map((o) => o.calls.find((c) => c.method === "eq")?.args[1]);
    expect(prefsReads).toEqual([U.admin, U.beta]);
  });
});

/* ─── Server rendering ─── */

describe("Campaigns page — server render (renderToString)", () => {
  const listKey = [CAMPAIGNS_TABLE_QUERY_ROOT, "list", ORG1, U.admin];
  const project = (r: DbRow): CampaignRow =>
    Object.fromEntries(CAMPAIGN_LIST_COLUMNS.split(",").map((k) => [k.trim(), r[k.trim()] ?? null])) as unknown as CampaignRow;
  const rows = ORG1_CAMPAIGNS.map(project);
  const visibleIds = rows.map((r) => r.id).sort();
  const adminStats: Record<string, CampaignCardStats> = Object.fromEntries(
    ORG1_CAMPAIGNS.filter((c) => c.type !== "Personal").map((c) => {
      const s = STATS[c.id];
      return [c.id, { total: s.total_leads, called: s.called_leads, contacted: s.contacted_leads, converted: s.converted_leads, policiesSold: s.policies_sold }];
    }),
  );
  const assignees: AssigneeProfileMap = Object.fromEntries(
    PROFILES.map((p) => [p.id, { id: p.id, displayName: `${p.first_name} ${p.last_name}`, avatarUrl: null }]),
  );

  function serverHtml(client: QueryClient, node: React.ReactNode = <PageGuard pageName="Campaigns"><Campaigns /></PageGuard>) {
    return renderToString(
      <QueryClientProvider client={client}>
        <StaticRouter location="/campaigns">
          <TooltipProvider>{node}</TooltipProvider>
        </StaticRouter>
      </QueryClientProvider>,
    );
  }
  const parse = (html: string) => {
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.appendChild(host);
    hosts.push(host);
    return host;
  };

  const hosts: HTMLElement[] = [];
  beforeEach(() => {
    actAs("admin");
    setViewport(true); // the server snapshot must win: SSR always takes the stacked layout
    consoleError.mockImplementation(() => {});
  });
  afterEach(() => {
    for (const host of hosts.splice(0)) host.remove();
    // Radix primitives call useLayoutEffect when `document` exists (jsdom); on the server renderer
    // that is a dev-only notice. Anything else logged during a server render is a failure.
    const unexpected = consoleError.mock.calls
      .map((args) => args.map(String).join(" "))
      .filter((msg) => !/useLayoutEffect does nothing on the server/.test(msg));
    expect(unexpected).toEqual([]);
  });

  it("seeded cache: renders the stacked list with metrics and the stored fallback, issuing no requests", () => {
    const client = makeClient();
    client.setQueryData(listKey, rows);
    client.setQueryData([CAMPAIGNS_TABLE_QUERY_ROOT, "stats", ORG1, U.admin, idsHash(visibleIds)], adminStats);
    client.setQueryData([CAMPAIGNS_TABLE_QUERY_ROOT, "lastDialed", ORG1, U.admin], { [C.open.id]: "2026-10-09T09:00:00.000Z" });
    client.setQueryData([CAMPAIGNS_TABLE_QUERY_ROOT, "assignees", ORG1, U.admin, idsHash(collectAssigneeIds(rows))], assignees);
    client.setQueryData([CAMPAIGNS_TABLE_QUERY_ROOT, "orgStatus", ORG1, U.admin], "active");
    client.setQueryData([CAMPAIGNS_TABLE_QUERY_ROOT, "createAgents", ORG1, U.admin], []);

    let html = "";
    expect(() => { html = serverHtml(client); }).not.toThrow();
    const host = parse(html);
    expect(host.querySelector("table")).toBeNull();
    expect(within(host).getByRole("list", { name: "Campaigns" })).toBeInTheDocument();
    for (const c of ORG1_CAMPAIGNS) expect(within(host).getByText(c.name as string)).toBeInTheDocument();
    expect(within(host).getByLabelText("7 campaigns")).toBeInTheDocument();
    expect(within(host).getByTestId(`campaign-row-${C.open.id}`)).toHaveTextContent("50 / 100");
    expect(within(host).getByTestId(`campaign-row-${C.otherPersonal.id}`)).toHaveTextContent("20 / 80");
    expect(within(host).queryAllByTestId("metric-loading")).toHaveLength(0);
    expect(h.ops).toEqual([]);
  });

  it("empty cache entry: renders No campaigns yet", () => {
    const client = makeClient();
    client.setQueryData(listKey, []);
    let html = "";
    expect(() => { html = serverHtml(client); }).not.toThrow();
    expect(within(parse(html)).getByText("No campaigns yet")).toBeInTheDocument();
    expect(h.ops).toEqual([]);
  });

  it("errored list entry: renders Couldn't load campaigns. (not empty)", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } });
    const query = client.getQueryCache().build(client, { queryKey: listKey });
    query.setState({
      ...query.state, status: "error", error: new CampaignsQueryError("failed"), fetchStatus: "idle",
      errorUpdateCount: 1, errorUpdatedAt: Date.now(), fetchFailureCount: 1,
    });
    let html = "";
    expect(() => { html = serverHtml(client); }).not.toThrow();
    const host = parse(html);
    expect(within(host).getByText("Couldn't load campaigns.")).toBeInTheDocument();
    expect(within(host).queryByText("No campaigns yet")).toBeNull();
    expect(h.ops).toEqual([]);
  });

  it("no cache: renders the loading skeleton (never 0) without fetching", () => {
    let html = "";
    expect(() => { html = serverHtml(makeClient()); }).not.toThrow();
    const host = parse(html);
    expect(within(host).getByTestId("campaigns-skeleton")).toBeInTheDocument();
    expect(within(host).queryByText("0")).toBeNull();
    expect(h.ops).toEqual([]);
  });

  it("CampaignsTable renders directly on the server with seeded rows", () => {
    const stats: StatsView = { status: "ready", map: adminStats };
    const metricsById = Object.fromEntries(rows.map((r) => [r.id, resolveCampaignMetrics(r, stats)]));
    let html = "";
    expect(() => {
      html = serverHtml(makeClient(), (
        <CampaignsTable
          rows={rows}
          metricsById={metricsById}
          columns={visibleColumns(DEFAULT_COLUMN_LAYOUT)}
          sort={DEFAULT_SORT}
          onSort={() => {}}
          expandedId={C.otherPersonal.id}
          onToggle={() => {}}
          duplicateFor={(r) => duplicateEligibility("Admin", r, U.admin)}
          orgLocked={false}
          lastDialed={{ status: "ready", map: { [C.open.id]: "2026-10-09T09:00:00.000Z" } }}
          assignees={{ status: "ready", map: assignees }}
          nowMs={Date.UTC(2026, 9, 9, 12)}
          formatDate={h.branding.formatDate}
          onOpen={() => {}}
          onDuplicate={() => {}}
        />
      ));
    }).not.toThrow();
    const host = parse(html);
    const table = within(host).getByRole("table", { name: "Campaigns" });
    for (const label of ["Status", "Lead progress", "Agents", "Converted"]) {
      expect(within(table).getByRole("columnheader", { name: label })).toBeInTheDocument();
    }
    expect(within(table).queryByRole("columnheader", { name: "Contacted" })).toBeNull();
    for (const c of ORG1_CAMPAIGNS) expect(within(table).getByText(c.name as string)).toBeInTheDocument();
    const details = within(host).getByTestId(`campaign-details-${C.otherPersonal.id}`);
    expect(detail(details, "Converted")).toHaveTextContent("Not available for this campaign");
    expect(detail(details, "Total leads")).toHaveTextContent("80");
  });
});
