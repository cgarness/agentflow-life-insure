import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, waitFor, act, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * Dashboard sections (rev 1.2 corrections):
 * 1. One load per section on the wire — a Refresh, a remount or a repeated
 *    signal never starts a second one, a section still pending when the next
 *    Refresh becomes eligible sends nothing new, and every wait is bounded.
 * 2. Nothing is sent while the tab is hidden or offline; the load runs once
 *    when the tab is visible and online again.
 * 3. A failed refresh keeps the same selection's data and says so; a failed
 *    first load never shows the section's valid-empty message.
 */

type QueryResult = { data: unknown; error: unknown; count?: number | null };
type Held = { table: string; resolve: (v: QueryResult) => void };

const h = vi.hoisted(() => ({
  queries: [] as string[],
  inFlight: {} as Record<string, number>,
  maxInFlight: {} as Record<string, number>,
  result: ((_table: string) => ({ data: [], error: null, count: 0 })) as (table: string) => QueryResult,
  /** Tables whose reads wait for a manual resolve. */
  hold: new Set<string>(),
  /** Held reads ignore the abort signal (like a stalled request). */
  ignoreAbort: false,
  held: [] as Held[],
  callbackPage: vi.fn(),
  callbackTotal: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => {
  const makeQuery = (table: string) => {
    let signal: AbortSignal | null = null;
    const q: Record<string, unknown> = {};
    const chain = () => q;
    for (const m of ["select", "eq", "in", "gte", "lt", "lte", "not", "or", "order", "limit"]) q[m] = chain;
    q.abortSignal = (s: AbortSignal) => {
      signal = s;
      return q;
    };
    const settle = (): Promise<QueryResult> => {
      h.queries.push(table);
      h.inFlight[table] = (h.inFlight[table] ?? 0) + 1;
      h.maxInFlight[table] = Math.max(h.maxInFlight[table] ?? 0, h.inFlight[table]);
      const done = (v: QueryResult) => {
        h.inFlight[table] -= 1;
        return v;
      };
      if (!h.hold.has(table)) return Promise.resolve(h.result(table)).then(done);
      return new Promise<QueryResult>((resolve) => {
        let finished = false;
        const finish = (v: QueryResult) => {
          if (finished) return;
          finished = true;
          resolve(done(v));
        };
        h.held.push({ table, resolve: finish });
        if (!h.ignoreAbort && signal) {
          const abort = () => finish({ data: null, error: { code: "", message: "AbortError" } });
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort);
        }
      });
    };
    q.maybeSingle = () => settle();
    q.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      settle().then(onFulfilled, onRejected);
    return q;
  };
  return { supabase: { from: (table: string) => makeQuery(table) } };
});

vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ getDataScope: () => "all" }) }));
vi.mock("@/lib/quick-call", () => ({ dispatchQuickCall: () => true }));
vi.mock("@/components/voicemail/VoicemailPlayer", () => ({ VoicemailPlayer: () => null }));
vi.mock("@/lib/dashboard-callbacks", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchCallbackPage: h.callbackPage,
  fetchCallbackTotal: h.callbackTotal,
}));

import AppointmentsWidget from "@/components/dashboard/widgets/AppointmentsWidget";
import MissedCallsWidget from "@/components/dashboard/widgets/MissedCallsWidget";
import AnniversariesWidget from "@/components/dashboard/widgets/AnniversariesWidget";
import GoalProgressWidget from "@/components/dashboard/widgets/GoalProgressWidget";
import CallbacksWidget from "@/components/dashboard/widgets/CallbacksWidget";
import StatCards from "@/components/dashboard/StatCards";
import { useDashboardStats } from "@/hooks/useDashboardStats";
import {
  DASHBOARD_SECTION_TIMEOUT_MS,
  DashboardRefreshTracker,
  resetDashboardSectionLanes,
} from "@/lib/dashboardRefresh";

const USER = "aaaa0000-0000-0000-0000-000000000001";
const APPT = { id: "a1", title: "Review", contact_name: "Pat Lee", start_time: new Date().toISOString(), type: "Sales Call", status: "Scheduled" };
const CALL = {
  id: "c1", contact_id: null, contact_name: "Jordan Kay", contact_phone: "+15555550100",
  created_at: new Date().toISOString(), disposition_name: null, direction: "inbound", is_missed: true,
  missed_reason: null, outcome: null, agent_id: null, answered_by_agent_id: null, voicemail_id: null,
};
const soon = new Date();
soon.setDate(soon.getDate() + 3);
const CLIENT = { id: "k1", first_name: "Riley", last_name: "Stone", phone: "+15555550111", effective_date: soon.toISOString().slice(0, 10), policy_type: "Term", assigned_agent_id: USER };
const GOALS = { monthly_call_goal: 100, monthly_policies_goal: 0, monthly_appointment_goal: 0, monthly_premium_goal: 0 };
const CALLBACK_ROW = {
  key: "cb1", source: "campaign", contactId: "l1", contactType: "lead", contactName: "Casey Callback",
  phone: "+15555550122", dueAt: new Date(Date.now() - 60_000).toISOString(), canAct: true, blockedReason: null,
};
const FAIL: QueryResult = { data: null, error: { message: "statement timeout" }, count: null };

const reads = (table: string) => h.queries.filter((t) => t === table).length;
const setVisibility = (state: "visible" | "hidden", dispatch = true) => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  if (dispatch) document.dispatchEvent(new Event("visibilitychange"));
};
const setOnline = (online: boolean, dispatch = true) => {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
  if (dispatch) window.dispatchEvent(new Event(online ? "online" : "offline"));
};
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  resetDashboardSectionLanes();
  h.queries.length = 0;
  h.inFlight = {};
  h.maxInFlight = {};
  h.hold = new Set();
  h.ignoreAbort = false;
  h.held.length = 0;
  h.result = (t) =>
    t === "appointments" ? { data: [APPT], error: null } :
    t === "calls" ? { data: [CALL], error: null } :
    t === "clients" ? { data: [CLIENT], error: null } :
    t === "profiles" ? { data: GOALS, error: null } :
    { data: [], error: null, count: 0 };
  h.callbackPage.mockReset().mockResolvedValue([CALLBACK_ROW]);
  h.callbackTotal.mockReset().mockResolvedValue(1);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  resetDashboardSectionLanes();
  Reflect.deleteProperty(document, "visibilityState");
  Reflect.deleteProperty(navigator, "onLine");
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type SectionProps = { refreshSignal?: number; refreshTracker?: DashboardRefreshTracker | null };

/** Two sections sharing one Refresh signal and tracker, like the Dashboard. */
const Pair: React.FC<SectionProps> = (p) => (
  <MemoryRouter>
    <AppointmentsWidget userId={USER} role="Agent" adminToggle="my" {...p} />
    <MissedCallsWidget userId={USER} role="Agent" adminToggle="my" {...p} />
  </MemoryRouter>
);

describe("correction 1: coordinated, non-overlapping refresh", () => {
  it("a widget still pending when the next Refresh becomes eligible starts no second load; the waits stay bounded and the other sections refresh", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    h.hold = new Set(["appointments"]);
    h.ignoreAbort = true; // a stalled request: the abort cannot end it
    const tracker = new DashboardRefreshTracker();
    const view = render(<Pair refreshSignal={0} refreshTracker={tracker} />);
    await advance(10);
    expect(reads("appointments")).toBe(1);
    expect(screen.getByText("Jordan Kay")).toBeInTheDocument();

    // Refresh 1 while Schedule's first load is still running: it joins, nothing new is sent.
    await advance(10_000);
    view.rerender(<Pair refreshSignal={1} refreshTracker={tracker} />);
    const first = tracker.wait(1);
    await advance(10);
    expect(reads("appointments")).toBe(1);
    expect(reads("calls")).toBe(2);
    // Bounded: at the section's 25 s bound Schedule is reported failed; the wait ends there.
    await advance(DASHBOARD_SECTION_TIMEOUT_MS);
    const summary1 = await first;
    expect(summary1.outcomes).toEqual({ appointments: { status: "failed" }, missed_calls: { status: "ok" } });
    expect(screen.getByText("Couldn't load your schedule")).toBeInTheDocument();
    expect(screen.queryByText("Your schedule is clear for today")).not.toBeInTheDocument();

    // Refresh 2, eligible 30 s later, with the stalled read still on the wire: Schedule
    // sends nothing and does not hold the wait; Missed Calls refreshes.
    await advance(30_000);
    view.rerender(<Pair refreshSignal={2} refreshTracker={tracker} />);
    const summary2 = await tracker.wait(2);
    expect(summary2.outcomes.appointments).toEqual({ status: "deferred", until: null });
    expect(summary2.outcomes.missed_calls).toEqual({ status: "ok" });
    expect(reads("appointments")).toBe(1);
    expect(reads("calls")).toBe(3);

    // The stalled answer finally lands: discarded (it was reported failed); the lane is free again.
    h.hold = new Set();
    await act(async () => h.held[0].resolve({ data: [APPT], error: null }));
    await advance(10);
    expect(screen.queryByText("Pat Lee")).not.toBeInTheDocument();
    view.rerender(<Pair refreshSignal={3} refreshTracker={tracker} />);
    await advance(10);
    expect(reads("appointments")).toBe(2);
    expect(screen.getByText("Pat Lee")).toBeInTheDocument();
    expect(h.maxInFlight.appointments).toBe(1);
  });

  it("a remount while a load is running (edit-mode toggle) joins it instead of sending a second request", async () => {
    h.hold = new Set(["appointments"]);
    const first = render(<Pair />);
    await waitFor(() => expect(reads("appointments")).toBe(1));
    first.unmount();
    render(<Pair />);
    await flush();
    expect(reads("appointments")).toBe(1);
    await act(async () => h.held[0].resolve({ data: [APPT], error: null }));
    await waitFor(() => expect(screen.getByText("Pat Lee")).toBeInTheDocument());
    expect(h.maxInFlight.appointments).toBe(1);
  });

  it("Callbacks (not abortable): Personal → Team → Personal never sends the Team read, never overlaps, and shows no failure", async () => {
    let releaseFirst!: () => void;
    h.callbackPage.mockReset().mockImplementationOnce(
      () => new Promise((resolve) => (releaseFirst = () => resolve([CALLBACK_ROW]))),
    ).mockResolvedValue([CALLBACK_ROW]);
    const view = render(
      <MemoryRouter>
        <CallbacksWidget userId={USER} role="Admin" adminToggle="my" />
      </MemoryRouter>,
    );
    await waitFor(() => expect(h.callbackPage).toHaveBeenCalledTimes(1));
    view.rerender(
      <MemoryRouter>
        <CallbacksWidget userId={USER} role="Admin" adminToggle="team" />
      </MemoryRouter>,
    );
    view.rerender(
      <MemoryRouter>
        <CallbacksWidget userId={USER} role="Admin" adminToggle="my" />
      </MemoryRouter>,
    );
    await flush();
    expect(h.callbackPage).toHaveBeenCalledTimes(1);
    await act(async () => releaseFirst());
    await waitFor(() => expect(screen.getByText("Casey Callback")).toBeInTheDocument());
    const scopes = h.callbackPage.mock.calls.map((c) => (c[0] as { isFiltered: boolean }).isFiltered);
    expect(scopes.every(Boolean)).toBe(true); // never the Team (unfiltered) read
    expect(screen.queryByText(/Couldn't/)).not.toBeInTheDocument();
  });
});

describe("newest run wins", () => {
  it("Refresh, then Personal → Team → Personal: the abandoned read's answer never ends the running reload's state", async () => {
    const view = (toggle: "my" | "team", signal: number) => (
      <MemoryRouter>
        <CallbacksWidget userId={USER} role="Admin" adminToggle={toggle} refreshSignal={signal} />
      </MemoryRouter>
    );
    const { rerender } = render(view("my", 0));
    await waitFor(() => expect(screen.getByText("Casey Callback")).toBeInTheDocument());
    const releases: Array<() => void> = [];
    h.callbackPage.mockImplementation(() => new Promise((resolve) => releases.push(() => resolve([CALLBACK_ROW]))));

    rerender(view("my", 1)); // Refresh: a slow read the lane cannot abort
    await waitFor(() => expect(releases).toHaveLength(1));
    rerender(view("team", 1));
    rerender(view("my", 1)); // back: a fresh read is queued behind the abandoned one
    await flush();
    expect(screen.getByText("Refreshing…")).toBeInTheDocument();

    await act(async () => releases[0]()); // the abandoned read settles
    await waitFor(() => expect(releases).toHaveLength(2));
    expect(screen.getByText("Refreshing…")).toBeInTheDocument();
    await act(async () => releases[1]());
    await waitFor(() => expect(screen.queryByText("Refreshing…")).not.toBeInTheDocument());
    expect(screen.getByText("Casey Callback")).toBeInTheDocument();
  });
});

describe("correction 2: nothing is sent while hidden or offline", () => {
  it("an offline mount sends nothing, says so (never 'clear'), and loads once when back online", async () => {
    setOnline(false, false);
    const tracker = new DashboardRefreshTracker();
    render(<Pair refreshTracker={tracker} refreshSignal={0} />);
    await flush();
    expect(h.queries).toEqual([]);
    expect(screen.getAllByText("You're offline")).toHaveLength(2);
    expect(screen.getByText("Your schedule will load when you reconnect.")).toBeInTheDocument();
    expect(screen.queryByText("Your schedule is clear for today")).not.toBeInTheDocument();
    expect(screen.queryByText("All caught up!")).not.toBeInTheDocument();

    act(() => setOnline(true));
    await waitFor(() => expect(screen.getByText("Pat Lee")).toBeInTheDocument());
    expect(screen.getByText("Jordan Kay")).toBeInTheDocument();
    expect(reads("appointments")).toBe(1);
    expect(reads("calls")).toBe(1);
  });

  it("a follow-on read never goes out after the tab went hidden mid-load; the section loads once when shown", async () => {
    h.hold = new Set(["calls"]);
    render(<MissedCallsWidget userId={USER} role="Agent" adminToggle="my" />);
    await waitFor(() => expect(h.held).toHaveLength(1));
    act(() => setVisibility("hidden"));
    await act(async () => h.held[0].resolve({ data: [{ ...CALL, contact_id: "l1" }], error: null }));
    await flush();
    expect(reads("leads")).toBe(0);
    expect(reads("clients")).toBe(0);
    h.hold = new Set();
    h.result = (t) => (t === "calls" ? { data: [CALL], error: null } : { data: [], error: null });
    act(() => setVisibility("visible"));
    await waitFor(() => expect(screen.getByText("Jordan Kay")).toBeInTheDocument());
    expect(reads("calls")).toBe(2);
  });

  it("a hidden mount sends nothing until the tab is shown, then loads once", async () => {
    setVisibility("hidden", false);
    render(<Pair />);
    await flush();
    expect(h.queries).toEqual([]);
    act(() => setVisibility("visible"));
    await waitFor(() => expect(screen.getByText("Pat Lee")).toBeInTheDocument());
    expect(reads("appointments")).toBe(1);
  });

  it("a Refresh while offline sends nothing, keeps the rows with an offline note, and refreshes on reconnect", async () => {
    const tracker = new DashboardRefreshTracker();
    const view = render(<Pair refreshSignal={0} refreshTracker={tracker} />);
    await waitFor(() => expect(screen.getByText("Pat Lee")).toBeInTheDocument());
    act(() => setOnline(false));
    view.rerender(<Pair refreshSignal={1} refreshTracker={tracker} />);
    const summary = await tracker.wait(1);
    expect(summary.outcomes).toEqual({ appointments: { status: "inactive" }, missed_calls: { status: "inactive" } });
    expect(reads("appointments")).toBe(1);
    await waitFor(() => expect(screen.getByText(/You're offline — showing your schedule from/)).toBeInTheDocument());
    expect(screen.getByText("Pat Lee")).toBeInTheDocument();
    act(() => setOnline(true));
    await waitFor(() => expect(reads("appointments")).toBe(2));
    await waitFor(() => expect(screen.queryByText(/You're offline/)).not.toBeInTheDocument());
  });
});

describe("correction 3: a failed refresh keeps the data and says so", () => {
  const cases: Array<{
    name: string;
    element: (signal: number) => React.ReactElement;
    rows: string;
    fail: () => void;
    label: string;
  }> = [
    {
      name: "Schedule",
      element: (s) => <AppointmentsWidget userId={USER} role="Agent" adminToggle="my" refreshSignal={s} />,
      rows: "Pat Lee",
      fail: () => (h.result = (t) => (t === "appointments" ? FAIL : { data: [], error: null })),
      label: "your schedule",
    },
    {
      name: "Missed Calls",
      element: (s) => <MissedCallsWidget userId={USER} role="Agent" adminToggle="my" refreshSignal={s} />,
      rows: "Jordan Kay",
      fail: () => (h.result = (t) => (t === "calls" ? FAIL : { data: [], error: null })),
      label: "missed calls",
    },
    {
      name: "Anniversaries",
      element: (s) => <AnniversariesWidget userId={USER} role="Agent" adminToggle="my" refreshSignal={s} />,
      rows: "Riley Stone",
      fail: () => (h.result = (t) => (t === "clients" ? FAIL : { data: [], error: null })),
      label: "anniversaries",
    },
    {
      name: "Goal Progress",
      element: (s) => <GoalProgressWidget userId={USER} refreshSignal={s} />,
      rows: "Monthly Calls",
      fail: () => (h.result = (t) => (t === "calls" ? FAIL : t === "profiles" ? { data: GOALS, error: null } : { data: [], error: null })),
      label: "goal progress",
    },
    {
      name: "Callbacks",
      element: (s) => <CallbacksWidget userId={USER} role="Agent" adminToggle="my" refreshSignal={s} />,
      rows: "Casey Callback",
      fail: () => h.callbackPage.mockRejectedValue(new Error("statement timeout")),
      label: "callbacks",
    },
  ];

  for (const c of cases) {
    it(`${c.name}: a failed Refresh keeps the rows and shows "Couldn't refresh — showing ${c.label} from …"`, async () => {
      const view = render(<MemoryRouter>{c.element(0)}</MemoryRouter>);
      await waitFor(() => expect(screen.getByText(c.rows)).toBeInTheDocument());
      c.fail();
      view.rerender(<MemoryRouter>{c.element(1)}</MemoryRouter>);
      await waitFor(() =>
        expect(screen.getByText(new RegExp(`Couldn't refresh — showing ${c.label} from`))).toBeInTheDocument(),
      );
      expect(screen.getByText(c.rows)).toBeInTheDocument();
      // The raw database error never reaches the page.
      expect(document.body.textContent ?? "").not.toContain("statement timeout");
    });
  }

  it("a failed first load never shows a section's valid-empty message", async () => {
    h.result = () => FAIL;
    render(
      <MemoryRouter>
        <AppointmentsWidget userId={USER} role="Agent" adminToggle="my" />
        <MissedCallsWidget userId={USER} role="Agent" adminToggle="my" />
        <AnniversariesWidget userId={USER} role="Agent" adminToggle="my" />
        <GoalProgressWidget userId={USER} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("Couldn't load your schedule")).toBeInTheDocument());
    expect(screen.getByText("Couldn't load missed calls")).toBeInTheDocument();
    expect(screen.getByText("Couldn't load anniversaries")).toBeInTheDocument();
    expect(screen.getByText("Couldn't load goal progress")).toBeInTheDocument();
    for (const empty of ["Your schedule is clear for today", "All caught up!", "No policy anniversaries soon", "No goals configured"]) {
      expect(screen.queryByText(empty)).not.toBeInTheDocument();
    }
  });

  it("over an empty result, a failed Refresh shows the empty message only together with the stale note", async () => {
    h.result = () => ({ data: [], error: null });
    const view = render(<MissedCallsWidget userId={USER} role="Agent" adminToggle="my" refreshSignal={0} />);
    await waitFor(() => expect(screen.getByText("All caught up!")).toBeInTheDocument());
    h.result = () => FAIL;
    view.rerender(<MissedCallsWidget userId={USER} role="Agent" adminToggle="my" refreshSignal={1} />);
    await waitFor(() => expect(screen.getByText(/Couldn't refresh — showing missed calls from/)).toBeInTheDocument());
    expect(screen.getByText("All caught up!")).toBeInTheDocument();
  });

  it("Missed Calls: a failed contact lookup is a failure, never rows claiming 'no linked contact'", async () => {
    const view = render(<MissedCallsWidget userId={USER} role="Agent" adminToggle="my" refreshSignal={0} />);
    await waitFor(() => expect(screen.getByText("Jordan Kay")).toBeInTheDocument());
    h.result = (t) =>
      t === "calls" ? { data: [{ ...CALL, contact_id: "l1", contact_name: "Lee Lookup" }], error: null } : t === "leads" ? FAIL : { data: [], error: null };
    view.rerender(<MissedCallsWidget userId={USER} role="Agent" adminToggle="my" refreshSignal={1} />);
    await waitFor(() => expect(screen.getByText(/Couldn't refresh — showing missed calls from/)).toBeInTheDocument());
    expect(screen.getByText("Jordan Kay")).toBeInTheDocument();
    expect(screen.queryByText("Lee Lookup")).not.toBeInTheDocument();
  });

  it("after midnight a failed Refresh never keeps yesterday's schedule as today's", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 25, 23, 59, 0));
    const view = render(<MemoryRouter><AppointmentsWidget userId={USER} role="Agent" adminToggle="my" refreshSignal={0} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Pat Lee")).toBeInTheDocument());
    vi.setSystemTime(new Date(2026, 8, 26, 0, 1, 0));
    h.result = () => FAIL;
    view.rerender(<MemoryRouter><AppointmentsWidget userId={USER} role="Agent" adminToggle="my" refreshSignal={1} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Couldn't load your schedule")).toBeInTheDocument());
    expect(screen.queryByText("Pat Lee")).not.toBeInTheDocument();
  });
});

describe("stat cards", () => {
  const Harness: React.FC<{ signal: number }> = ({ signal }) => {
    const { data, loading, section } = useDashboardStats(USER, "Agent", "my", "day", { refreshSignal: signal });
    return <StatCards role="Agent" userId={USER} adminToggle="my" timeRange="day" stats={data} loading={loading} status={section} />;
  };
  const counts = (n: number) => (t: string) => (t === "calls" ? { data: [], error: null, count: n } : { data: [], error: null, count: 0 });

  it("a failed Refresh keeps the numbers and shows 'Couldn't refresh — showing stats from …'", async () => {
    h.result = counts(12);
    const view = render(<Harness signal={0} />);
    await waitFor(() => expect(screen.getByText("12")).toBeInTheDocument());
    h.result = () => FAIL;
    view.rerender(<Harness signal={1} />);
    await waitFor(() => expect(screen.getByText(/Couldn't refresh — showing stats from/)).toBeInTheDocument());
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("after midnight a failed Refresh never keeps yesterday's numbers as today's", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 25, 23, 59, 0));
    h.result = counts(12);
    const view = render(<Harness signal={0} />);
    await waitFor(() => expect(screen.getByText("12")).toBeInTheDocument());
    vi.setSystemTime(new Date(2026, 8, 26, 0, 1, 0));
    h.result = () => FAIL;
    view.rerender(<Harness signal={1} />);
    await waitFor(() => expect(screen.getByText("Couldn't load stats. Use Refresh to try again.")).toBeInTheDocument());
    expect(screen.queryByText("12")).not.toBeInTheDocument();
  });

  it("a failed first load never renders a made-up 0 or $0", async () => {
    h.result = () => FAIL;
    render(<Harness signal={0} />);
    await waitFor(() => expect(screen.getByText("Couldn't load stats. Use Refresh to try again.")).toBeInTheDocument());
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.queryByText("$0")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
  });

  it("a partly failed first load shows what loaded, '—' for the rest, and says it may be incomplete", async () => {
    h.result = (t) => (t === "appointments" ? FAIL : t === "calls" ? { data: [], error: null, count: 7 } : { data: [], error: null, count: 0 });
    render(<Harness signal={0} />);
    await waitFor(() => expect(screen.getByText(/Some stats couldn't be loaded/)).toBeInTheDocument());
    expect(screen.getByText("7")).toBeInTheDocument();
    // The Appointments card: its value is "—", never 0.
    expect(screen.getByText("Appointments Today").parentElement?.textContent).toContain("—");
    expect(screen.getByText("Appointments Today").parentElement?.textContent).not.toMatch(/\b0\b/);
  });

  it("an offline mount sends none of the nine queries and loads once on reconnect", async () => {
    setOnline(false, false);
    const { result } = renderHook(() => useDashboardStats(USER, "Agent", "my", "day"));
    await flush();
    expect(h.queries).toEqual([]);
    expect(result.current.section.offline).toBe(true);
    expect(result.current.data).toBeNull();
    act(() => setOnline(true));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(h.queries).toHaveLength(9);
  });
});
