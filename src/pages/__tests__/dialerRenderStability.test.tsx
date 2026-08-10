/**
 * DialerPage render-stability regression (implementation_plan §11).
 *
 * FAIL-FIRST CONTRACT: on the unfixed DialerPage, the inline `= []` defaults on the
 * dispositions / call_scripts / pipeline_stages useQuery destructures mint a fresh array
 * identity every render while the query result is `undefined`; the three mirror effects
 * (`setDispositions(dispositionsData)` etc.) then fire on every render, `dispositions`
 * churns `reconcileTrustedStats`'s useCallback identity, and the mount effect keyed on
 * `[user?.id, reconcileTrustedStats]` re-runs each cycle — repeated getTodayStats reads of
 * `dialer_daily_stats`, a "Maximum update depth exceeded" warning, and unbounded commits.
 *
 * This suite renders the REAL DialerPage wiring (real useDialerSession / useLeadLock /
 * useHardClaim / useDialerStateMachine, real react-query with retries off) and mocks only
 * the process boundaries: the supabase client (per-table programmable: pending / reject /
 * resolve), TwilioContext (no-op, no credentials, nothing dispatched), Auth/Organization/
 * Calendar/Branding contexts, and usePermissions. No selected campaign. No focus or
 * realtime events are synthesized; the campaign-selection poll interval never elapses
 * within the sampling window.
 *
 * Bounded expectations (identical against main and the PR head — used to classify the
 * defect as pre-existing):
 *   - no React "Maximum update depth exceeded" console.error
 *   - dialer_daily_stats builder creations  <= 4 (mount + one legit dispositions-resolution re-run)
 *   - campaigns builder creations           <= 4
 *   - Profiler commit count                 <= 30 over the sampling window
 *   - the synchronous commit-cap killswitch never trips (the primary anti-loop guard)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { Profiler } from "react";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const ORG = "aaaaaaaa-0000-0000-0000-00000000000a";
const USER = "bbbbbbbb-0000-0000-0000-00000000000b";

type TableMode = "pending" | "reject" | "resolve";

const { state } = vi.hoisted(() => {
  const state = {
    fromCounts: {} as Record<string, number>,
    rpcCounts: {} as Record<string, number>,
    tableMode: {} as Record<string, TableMode>,
    tableData: {} as Record<string, unknown[]>,
  };
  return { state };
});

function resetState() {
  state.fromCounts = {};
  state.rpcCounts = {};
  state.tableMode = {};
  state.tableData = {};
}

/** Chainable, thenable query-builder stub. Every method returns the builder; awaiting it
 *  settles per the table's configured mode. `pending` never settles (data stays undefined
 *  in react-query for the whole sampling window — the loop precondition). */
function makeBuilder(table: string) {
  state.fromCounts[table] = (state.fromCounts[table] ?? 0) + 1;
  const b: Record<string, unknown> = {};
  for (const m of [
    "select", "insert", "update", "delete", "upsert", "eq", "neq", "in", "is", "not",
    "gte", "gt", "lte", "lt", "like", "ilike", "contains", "order", "limit", "range",
    "single", "maybeSingle", "csv", "abortSignal",
  ]) {
    b[m] = () => b;
  }
  (b as { then: unknown }).then = (
    onFulfilled: (v: unknown) => unknown,
    onRejected?: (e: unknown) => unknown,
  ) => {
    const mode = state.tableMode[table] ?? "resolve";
    if (mode === "pending") return new Promise(() => {}).then(onFulfilled, onRejected);
    if (mode === "reject") {
      return Promise.resolve({ data: null, error: { message: `boom:${table}` } }).then(
        onFulfilled,
        onRejected,
      );
    }
    return Promise.resolve({ data: state.tableData[table] ?? [], error: null }).then(
      onFulfilled,
      onRejected,
    );
  };
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => makeBuilder(table),
    rpc: (name: string) => {
      state.rpcCounts[name] = (state.rpcCounts[name] ?? 0) + 1;
      return Promise.resolve({ data: [], error: null });
    },
    functions: { invoke: async () => ({ data: null, error: null }) },
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    channel: () => {
      const ch = { on: () => ch, subscribe: () => ({ unsubscribe() {} }) };
      return ch;
    },
    removeChannel: () => {},
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: USER, email: "qa@render-stability.local" },
    profile: {
      id: USER, organization_id: ORG, role: "Admin", status: "Active",
      first_name: "QA", last_name: "Stability",
    },
    session: {},
    loading: false,
  }),
}));

vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: ORG, loading: false }),
}));

vi.mock("@/contexts/TwilioContext", () => ({
  // No credentials, nothing dispatched: every call surface is an inert spy.
  useTwilio: () => ({
    status: "disconnected", errorMessage: null, callState: "idle", callDuration: 0,
    currentCall: null, availableNumbers: [], selectedCallerNumber: null,
    setSelectedCallerNumber: vi.fn(), makeCall: vi.fn(), hangUp: vi.fn(),
    lastCallDirection: null, hangUpOrphan: vi.fn(), dismissOrphanCall: vi.fn(),
    orphanCall: null, initializeClient: vi.fn(), destroyClient: vi.fn(),
    getSmartCallerId: vi.fn(async () => null), setCallerIdCampaignGroupId: vi.fn(),
    applyDialSessionRingTimeout: vi.fn(),
  }),
}));

vi.mock("@/contexts/CalendarContext", () => ({
  useCalendar: () => ({ addAppointment: vi.fn() }),
}));

vi.mock("@/contexts/BrandingContext", () => ({
  useBranding: () => ({
    formatDate: (d: unknown) => String(d),
    formatDateTime: (d: unknown) => String(d),
    branding: {},
  }),
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    isLoading: false,
    permissions: {},
    has: () => true,
    getDataScope: () => "own",
    hasFeatureAccess: () => false,
  }),
}));

import DialerPage from "@/pages/DialerPage";

/* jsdom polyfills for heavy page chrome (Radix, charts, scroll) */
beforeEach(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (q: string) => ({
        matches: false, media: q, onchange: null,
        addListener() {}, removeListener() {},
        addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
      }),
    });
  }
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as Record<string, unknown>).ResizeObserver = class {
      observe() {} unobserve() {} disconnect() {}
    };
  }
  if (!("IntersectionObserver" in globalThis)) {
    (globalThis as Record<string, unknown>).IntersectionObserver = class {
      observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
    };
  }
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
  resetState();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const THE_THREE = ["dispositions", "call_scripts", "pipeline_stages"] as const;

/** Commit cap with a SYNCHRONOUS killswitch: on broken code the effect cascade re-commits
 *  continuously, allocating new arrays / react-query observers each cycle — it exhausts the
 *  heap before React's own max-update-depth guard trips and before any timer/microtask runs.
 *  So the Profiler onRender THROWS a sentinel once commits exceed the cap; that throw unwinds
 *  synchronously out of React's commit phase, deterministically ending the cascade. Fixed
 *  code never reaches the cap and never throws. */
const COMMIT_CAP = 60;
const LOOP_SENTINEL = "__DIALER_RENDER_LOOP__";

/** One sampling run's observations. `topReads` is a diagnostic summary of the busiest
 *  mocked tables, surfaced in the failure message so a red run names the looping query. */
type RenderSample = {
  commits: number;
  capTripped: boolean;
  maxDepthErrors: number;
  dailyStatsReads: number;
  campaignReads: number;
  topReads: string;
};

async function mountAndSample(): Promise<RenderSample> {
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  let commits = 0;
  let capTripped = false;
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const onRender = () => {
    commits += 1;
    if (commits > COMMIT_CAP) { capTripped = true; throw new Error(LOOP_SENTINEL); }
  };
  let view: ReturnType<typeof render> | undefined;
  try {
    view = render(
      <MemoryRouter initialEntries={["/dialer"]}>
        <QueryClientProvider client={qc}>
          <Profiler id="dialer-page" onRender={onRender}>
            <DialerPage />
          </Profiler>
        </QueryClientProvider>
      </MemoryRouter>,
    );
  } catch (e) {
    if (!(e instanceof Error && e.message === LOOP_SENTINEL)) throw e;
  }
  if (!capTripped) {
    // Healthy path: settle within a short real-time window (15s campaign poll never elapses).
    await new Promise((r) => setTimeout(r, 400));
  }
  const maxDepthErrors = errorSpy.mock.calls.filter((args) =>
    args.some((a) => typeof a === "string" && a.includes("Maximum update depth exceeded")),
  ).length;
  try { view?.unmount(); } catch { /* may have thrown mid-mount */ }
  qc.clear();
  const topReads = Object.entries(state.fromCounts)
    .sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t, n]) => `${t}:${n}`).join(", ");
  return {
    commits,
    capTripped,
    maxDepthErrors,
    dailyStatsReads: state.fromCounts["dialer_daily_stats"] ?? 0,
    campaignReads: state.fromCounts["campaigns"] ?? 0,
    topReads,
  };
}

function assertStable(s: RenderSample) {
  expect(s.capTripped, `unbounded render cascade (>${COMMIT_CAP} commits); top reads: ${s.topReads}`).toBe(false);
  expect(s.maxDepthErrors, "React max-update-depth warnings").toBe(0);
  expect(s.dailyStatsReads, "dialer_daily_stats builder creations (bounded, non-looping)").toBeLessThanOrEqual(4);
  expect(s.campaignReads, "campaigns builder creations (bounded, non-looping)").toBeLessThanOrEqual(4);
  expect(s.commits, "Profiler commits in sampling window").toBeLessThanOrEqual(30);
}

describe("DialerPage render stability (no selected campaign)", () => {
  it("stays bounded while dispositions/scripts/lead-stage queries are UNRESOLVED", async () => {
    for (const t of THE_THREE) state.tableMode[t] = "pending";
    assertStable(await mountAndSample());
  }, 30000);

  it("stays bounded when those queries REJECT", async () => {
    for (const t of THE_THREE) state.tableMode[t] = "reject";
    assertStable(await mountAndSample());
  }, 30000);

  it("stays bounded when those queries RESOLVE with stable data", async () => {
    state.tableData["dispositions"] = [];
    state.tableData["call_scripts"] = [];
    state.tableData["pipeline_stages"] = [];
    assertStable(await mountAndSample());
  }, 30000);
});
