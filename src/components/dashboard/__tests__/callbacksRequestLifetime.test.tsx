import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * Rev 1.3 correction 1 — callback request lifetime, asserted with the REAL
 * callback helpers (`fetchCallbackPage`, `fetchCallbackTotal`, the contact
 * resolver) over a mocked Supabase TRANSPORT. Each read is a request this test
 * can fail at once, hold, or let ignore its cancellation.
 *
 * The defect: one branch failing at once rejected the page (and the widget's
 * page + count pair) while sibling reads were still on the wire, so the section
 * lane was released and the next Refresh sent six more reads on top of them.
 */

type Result = { data?: unknown; count?: number | null; error: unknown };
type Req = {
  seq: number;
  table: string;
  key: string;
  kind: "rows" | "count" | "contacts";
  signal: AbortSignal | null;
  settled: boolean;
  settle: (v: Result) => void;
};
type Fate = "ok" | "fail" | "hold";

const h = vi.hoisted(() => ({
  reqs: [] as Req[],
  /** Decides each read's fate when it is sent. */
  fate: ((_req: { key: string; kind: string }) => "ok") as (req: { key: string; kind: string }) => Fate,
  /** Held reads end when their signal aborts (like fetch); false = a stalled read that ignores it. */
  honourAbort: true,
  rows: {} as Record<string, unknown[]>,
  counts: {} as Record<string, number>,
  contacts: {} as Record<"leads" | "clients" | "recruits", Array<{ id: string } & Record<string, unknown>>>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const ABORTED: Result = { data: null, count: null, error: { code: "", message: "AbortError: The operation was aborted." } };
  const FAILED: Result = { data: null, count: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
  const makeBuilder = (table: string) => {
    const filters: string[] = [];
    let head = false;
    let signal: AbortSignal | null = null;
    let ids: string[] = [];
    let sent: Promise<Result> | null = null;
    const b: Record<string, unknown> = {};
    const chain = (name: string) => (...args: unknown[]) => {
      filters.push(`${name}:${args.map(String).join(",")}`);
      return b;
    };
    for (const m of ["gte", "lt", "eq", "not", "or", "order", "limit", "range"]) b[m] = chain(m);
    b.is = (c: string, v: unknown) => {
      filters.push(`is:${c}=${v}`);
      return b;
    };
    b.in = (c: string, v: string[]) => {
      if (c === "id") ids = v;
      filters.push(`in:${c}`);
      return b;
    };
    b.select = (_cols: string, opts?: { head?: boolean }) => {
      if (opts?.head) head = true;
      return b;
    };
    b.abortSignal = (s: AbortSignal) => {
      signal = s;
      return b;
    };
    const send = (): Promise<Result> => {
      const isContact = table === "leads" || table === "clients" || table === "recruits";
      const key = isContact
        ? table
        : table === "appointments"
          ? "appointment"
          : filters.includes("is:callback_due_at=null")
            ? "campaign-legacy"
            : "campaign-due";
      const kind: Req["kind"] = isContact ? "contacts" : head ? "count" : "rows";
      return new Promise<Result>((resolve) => {
        const req: Req = {
          seq: h.reqs.length,
          table,
          key,
          kind,
          signal,
          settled: false,
          settle: (v) => {
            if (req.settled) return;
            req.settled = true;
            resolve(v);
          },
        };
        h.reqs.push(req);
        const fate = h.fate({ key, kind });
        const okResult = (): Result =>
          kind === "count"
            ? { count: h.counts[key] ?? 0, error: null }
            : kind === "contacts"
              ? { data: h.contacts[table as "leads" | "clients" | "recruits"].filter((r) => ids.includes(r.id)), error: null }
              : { data: h.rows[key] ?? [], error: null };
        if (signal?.aborted) return req.settle(ABORTED);
        if (fate === "ok") return req.settle(okResult());
        if (fate === "fail") return req.settle(FAILED);
        (req as Req & { ok: () => Result }).ok = okResult;
        if (h.honourAbort && signal) signal.addEventListener("abort", () => req.settle(ABORTED));
      });
    };
    b.then = (onFulfilled: (v: Result) => unknown, onRejected?: (e: unknown) => unknown) => {
      sent ??= send();
      return sent.then(onFulfilled, onRejected);
    };
    return b;
  };
  return { supabase: { from: (table: string) => makeBuilder(table) } };
});

vi.mock("@/lib/quick-call", () => ({ dispatchQuickCall: () => true }));

import CallbacksWidget from "@/components/dashboard/widgets/CallbacksWidget";
import { fetchCallbackPage, fetchCallbackTotal } from "@/lib/dashboard-callbacks";
import { DashboardQueryError } from "@/lib/dashboard-contact-identity";
import {
  DASHBOARD_SECTION_TIMEOUT_MS,
  DashboardRefreshTracker,
  resetDashboardSectionLanes,
} from "@/lib/dashboardRefresh";

const USER = "11111111-1111-1111-1111-111111111111";
const LEAD = "22222222-2222-2222-2222-222222222222";
const due = (minutesFromNow: number) => new Date(Date.now() + minutesFromNow * 60_000).toISOString();
const campaignRow = (name: string) => ({
  id: "cl-1", lead_id: LEAD, first_name: name, last_name: "Lane", phone: "+15555550100",
  callback_due_at: due(-30), scheduled_callback_at: null, callback_note: null, status: "Queued",
});

const outstanding = () => h.reqs.filter((r) => !r.settled);
const callbackReads = () => h.reqs.filter((r) => r.kind !== "contacts");
const settleHeld = () => {
  for (const r of outstanding()) r.settle((r as Req & { ok: () => Result }).ok());
};
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  resetDashboardSectionLanes();
  h.reqs.length = 0;
  h.fate = () => "ok";
  h.honourAbort = true;
  h.rows = { "campaign-due": [campaignRow("Casey")], "campaign-legacy": [], appointment: [] };
  h.counts = { "campaign-due": 1, "campaign-legacy": 0, appointment: 0 };
  h.contacts = { leads: [{ id: LEAD, first_name: "Casey", last_name: "Lane", phone: "+15555550100" }], clients: [], recruits: [] };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  resetDashboardSectionLanes();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the real callback helpers never settle while their own reads are still on the wire", () => {
  it("fetchCallbackPage: one branch failing at once cancels its siblings and rejects only after every read settled — no contact lookup, no partial page", async () => {
    h.fate = ({ key, kind }) => (kind === "rows" && key === "campaign-due" ? "fail" : "hold");
    const page = fetchCallbackPage({ isFiltered: true, userId: USER, pageSize: 15 });
    await expect(page).rejects.toMatchObject({ name: "DashboardQueryError", context: "callback-rows:campaign-due" });
    expect(h.reqs.filter((r) => r.kind === "rows")).toHaveLength(3);
    expect(outstanding()).toHaveLength(0);
    expect(h.reqs.filter((r) => r.key !== "campaign-due").every((r) => r.signal?.aborted)).toBe(true);
    expect(h.reqs.filter((r) => r.kind === "contacts")).toHaveLength(0);
  });

  it("fetchCallbackPage: sibling reads that ignore the cancel keep it pending until they really settle", async () => {
    h.honourAbort = false;
    h.fate = ({ key, kind }) => (kind === "rows" && key === "campaign-due" ? "fail" : "hold");
    let settled = false;
    const page = fetchCallbackPage({ isFiltered: true, userId: USER, pageSize: 15 }).finally(() => (settled = true));
    page.catch(() => {});
    await act(async () => {
      await Promise.resolve();
    });
    expect(outstanding()).toHaveLength(2);
    expect(settled).toBe(false);
    settleHeld();
    await expect(page).rejects.toBeInstanceOf(DashboardQueryError);
    expect(outstanding()).toHaveLength(0);
  });

  it("fetchCallbackTotal: a failed count waits for the other counts (cancelled) — never a partial total", async () => {
    h.honourAbort = false;
    h.fate = ({ key, kind }) => (kind === "count" && key === "appointment" ? "fail" : "hold");
    let settled = false;
    const total = fetchCallbackTotal({ isFiltered: true, userId: USER }).finally(() => (settled = true));
    total.catch(() => {});
    await act(async () => {
      await Promise.resolve();
    });
    expect(settled).toBe(false);
    expect(outstanding().every((r) => r.signal?.aborted)).toBe(true);
    settleHeld();
    await expect(total).rejects.toMatchObject({ context: "callback-count:appointment" });
  });

  it("a caller that cancelled meanwhile (superseded or past its bound) sends no contact lookup", async () => {
    h.honourAbort = false;
    h.fate = () => "hold";
    const controller = new AbortController();
    const page = fetchCallbackPage({ isFiltered: true, userId: USER, pageSize: 15, signal: controller.signal });
    page.catch(() => {});
    await act(async () => {
      await Promise.resolve();
    });
    controller.abort();
    settleHeld(); // the (stalled) branch reads answer anyway
    await expect(page).rejects.toBeInstanceOf(DashboardQueryError);
    expect(h.reqs.filter((r) => r.kind === "contacts")).toHaveLength(0);
  });

  it("success is unchanged: rows, exact total and contact resolution", async () => {
    const [rows, total] = await Promise.all([
      fetchCallbackPage({ isFiltered: true, userId: USER, pageSize: 15 }),
      fetchCallbackTotal({ isFiltered: true, userId: USER }),
    ]);
    expect(total).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ contactId: LEAD, contactType: "lead", contactName: "Casey Lane", canAct: true });
  });
});

const view = (signal: number, tracker: DashboardRefreshTracker) => (
  <MemoryRouter>
    <CallbacksWidget userId={USER} role="Agent" adminToggle="my" refreshSignal={signal} refreshTracker={tracker} />
  </MemoryRouter>
);

describe("the Callbacks section never overlaps its own reads", () => {
  it("partial failure: siblings are cancelled, the failure shows at once, and the next Refresh starts only after every earlier read settled", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    h.fate = ({ key, kind }) => (kind === "rows" && key === "campaign-due" ? "fail" : "hold");
    const tracker = new DashboardRefreshTracker();
    const { rerender } = render(view(0, tracker));
    await advance(10);
    expect(callbackReads()).toHaveLength(6);
    expect(outstanding()).toHaveLength(0);
    expect(screen.getByText("Couldn't load callbacks")).toBeInTheDocument();
    expect(screen.queryByText("Casey Lane")).not.toBeInTheDocument();

    h.fate = () => "ok";
    await advance(31_000);
    rerender(view(1, tracker));
    await advance(10);
    expect(callbackReads()).toHaveLength(12);
    // The second batch started only after the first had fully settled.
    expect(h.reqs.slice(0, 6).every((r) => r.settled)).toBe(true);
    expect(screen.getByText("Casey Lane")).toBeInTheDocument();
  });

  it("outstanding work beyond the 25 s bound: failure shows at the bound, a Refresh sends nothing (busy), and after the work settles the next Refresh recovers", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    h.honourAbort = false; // stalled reads: the cancel cannot end them
    h.fate = ({ key, kind }) => (kind === "rows" && key === "campaign-due" ? "fail" : "hold");
    const tracker = new DashboardRefreshTracker();
    const { rerender } = render(view(0, tracker));
    await advance(10);
    expect(callbackReads()).toHaveLength(6);
    expect(outstanding()).toHaveLength(5);

    await advance(DASHBOARD_SECTION_TIMEOUT_MS);
    expect(screen.getByText("Couldn't load callbacks")).toBeInTheDocument();

    // Refresh 31 s later, with five reads still on the wire: nothing new is sent.
    await advance(31_000);
    rerender(view(1, tracker));
    let summary!: Awaited<ReturnType<DashboardRefreshTracker["wait"]>>;
    await act(async () => {
      summary = await tracker.wait(1);
    });
    expect(summary.outcomes.callbacks).toEqual({ status: "deferred", until: null });
    expect(callbackReads()).toHaveLength(6);

    // The stalled reads finally land: discarded — never a partial list.
    await act(async () => settleHeld());
    await advance(10);
    expect(screen.queryByText("Casey Lane")).not.toBeInTheDocument();

    h.fate = () => "ok";
    rerender(view(2, tracker));
    await advance(10);
    expect(callbackReads()).toHaveLength(12);
    expect(screen.getByText("Casey Lane")).toBeInTheDocument();
  });

  it("a slow load is cancelled at the 25 s bound: every read ends, and the next Refresh sends one fresh set", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    h.fate = () => "hold"; // slow reads that do honour a cancel
    const tracker = new DashboardRefreshTracker();
    const { rerender } = render(view(0, tracker));
    await advance(10);
    expect(outstanding()).toHaveLength(6);
    await advance(DASHBOARD_SECTION_TIMEOUT_MS);
    expect(outstanding()).toHaveLength(0);
    expect(h.reqs.every((r) => r.signal?.aborted)).toBe(true);
    expect(screen.getByText("Couldn't load callbacks")).toBeInTheDocument();

    h.fate = () => "ok";
    await advance(31_000);
    rerender(view(1, tracker));
    await advance(10);
    expect(callbackReads()).toHaveLength(12);
    expect(screen.getByText("Casey Lane")).toBeInTheDocument();
  });

  it("page + count: a count failing at once holds the section until the page's reads settle too", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    h.honourAbort = false;
    h.fate = ({ key, kind }) => (kind === "count" && key === "campaign-due" ? "fail" : kind === "rows" ? "hold" : "ok");
    const tracker = new DashboardRefreshTracker();
    const { rerender } = render(view(0, tracker));
    await advance(10);
    expect(outstanding()).toHaveLength(3);
    await advance(40_000);
    rerender(view(1, tracker));
    await advance(10);
    expect(callbackReads()).toHaveLength(6);
    await act(async () => settleHeld());
    h.fate = () => "ok";
    rerender(view(2, tracker));
    await advance(10);
    expect(callbackReads()).toHaveLength(12);
    expect(screen.getByText("Casey Lane")).toBeInTheDocument();
  });

  it("a failed Refresh keeps the earlier complete page and total — never the new partial rows", async () => {
    const tracker = new DashboardRefreshTracker();
    const { rerender } = render(view(0, tracker));
    await waitFor(() => expect(screen.getByText("Casey Lane")).toBeInTheDocument());
    h.rows["campaign-due"] = [campaignRow("Newer")];
    h.contacts.leads = [{ id: LEAD, first_name: "Newer", last_name: "Lane", phone: "+15555550100" }];
    h.fate = ({ key, kind }) => (kind === "count" && key === "appointment" ? "fail" : "ok");
    rerender(view(1, tracker));
    await waitFor(() => expect(screen.getByText(/Couldn't refresh — showing callbacks from/)).toBeInTheDocument());
    expect(screen.getByText("Casey Lane")).toBeInTheDocument();
    expect(screen.queryByText("Newer Lane")).not.toBeInTheDocument();
  });
});
