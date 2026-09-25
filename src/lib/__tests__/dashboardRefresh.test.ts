import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  DASHBOARD_REFRESH_WAIT_MS,
  DASHBOARD_SECTION_TIMEOUT_MS,
  DashboardRefreshTracker,
  DashboardSectionError,
  DashboardSectionLane,
  type DashboardSectionOutcome,
} from "@/lib/dashboardRefresh";

/**
 * Dashboard section lanes: one load on the wire per section, identical requests
 * shared, other scopes serialized behind it, nothing dispatched while the tab is
 * hidden or offline, and every wait bounded. The Refresh tracker waits only for
 * work actually started, never longer than its bound.
 */

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
const deferred = <T,>(): Deferred<T> => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const setVisibility = (state: "visible" | "hidden") =>
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
const setOnline = (online: boolean) =>
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });

const tick = () => Promise.resolve().then(() => Promise.resolve());

afterEach(() => {
  Reflect.deleteProperty(document, "visibilityState");
  Reflect.deleteProperty(navigator, "onLine");
  vi.useRealTimers();
});

describe("DashboardSectionLane", () => {
  let lane: DashboardSectionLane;
  beforeEach(() => {
    lane = new DashboardSectionLane();
  });

  it("the same scope joins the load on the wire: one request for a mount, a Refresh and a remount", async () => {
    const d = deferred<string>();
    const load = vi.fn(() => d.promise);
    const a = lane.run("u|my", {}, load);
    const b = lane.run("u|my", {}, load);
    const c = lane.run("u|my", {}, load);
    await tick();
    expect(load).toHaveBeenCalledTimes(1);
    d.resolve("rows");
    expect(await a).toEqual({ status: "ok", data: "rows" });
    expect(await b).toEqual({ status: "ok", data: "rows" });
    expect(await c).toEqual({ status: "ok", data: "rows" });
  });

  it("another scope never overlaps: the running load is aborted and the new one starts only after it settles", async () => {
    const first = deferred<string>();
    const signals: AbortSignal[] = [];
    // Like fetch: an aborted signal rejects, even one aborted before the call.
    const loadA = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      if (signal.aborted) first.reject(new Error("aborted"));
      signal.addEventListener("abort", () => first.reject(new Error("aborted")));
      return first.promise;
    });
    const loadB = vi.fn(() => Promise.resolve("B"));
    const owner = {};
    const a = lane.run("A", owner, loadA);
    await tick();
    const b = lane.run("B", owner, loadB);
    expect(signals[0].aborted).toBe(true);
    expect(loadB).not.toHaveBeenCalled();
    // A switch-abort is a cancellation, never a failure.
    expect(await a).toEqual({ status: "superseded" });
    expect(await b).toEqual({ status: "ok", data: "B" });
    expect(loadB).toHaveBeenCalledTimes(1);
  });

  it("A → B → A on a load that ignores the abort: B is never sent and A runs again only after the first A settled", async () => {
    const first = deferred<string>();
    const loadA = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue("A2");
    const loadB = vi.fn(() => Promise.resolve("B"));
    const owner = {};
    const a1 = lane.run("A", owner, loadA);
    const b = lane.run("B", owner, loadB);
    const a2 = lane.run("A", owner, loadA);
    expect(await b).toEqual({ status: "superseded" });
    expect(loadA).toHaveBeenCalledTimes(1);
    first.resolve("A1");
    expect(await a1).toEqual({ status: "superseded" });
    expect(await a2).toEqual({ status: "ok", data: "A2" });
    expect(loadA).toHaveBeenCalledTimes(2);
    expect(loadB).not.toHaveBeenCalled();
  });

  it("a failure keeps its fallback for the hook; any other error has none", async () => {
    const withFallback = await lane.run("A", {}, () =>
      Promise.reject(new DashboardSectionError("x", { data: 5 })),
    );
    expect(withFallback).toEqual({ status: "failed", fallback: { data: 5 } });
    const plain = await lane.run("A", {}, () => Promise.reject(new Error("boom")));
    expect(plain).toEqual({ status: "failed", fallback: null });
  });

  it("is bounded: at 25 s a load that ignores the abort is reported failed, later requests send nothing until it settles", async () => {
    vi.useFakeTimers();
    const stuck = deferred<string>();
    const load = vi.fn().mockReturnValueOnce(stuck.promise).mockResolvedValue("fresh");
    const first = lane.run("A", {}, load);
    await vi.advanceTimersByTimeAsync(DASHBOARD_SECTION_TIMEOUT_MS);
    expect(await first).toEqual({ status: "failed", fallback: null });
    expect(await lane.run("A", {}, load)).toEqual({ status: "busy" });
    expect(await lane.run("B", {}, load)).toEqual({ status: "busy" });
    expect(load).toHaveBeenCalledTimes(1);
    // The late answer is discarded; the lane is free again.
    stuck.resolve("late");
    await vi.advanceTimersByTimeAsync(0);
    expect(await lane.run("A", {}, load)).toEqual({ status: "ok", data: "fresh" });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("sends nothing from a hidden or offline tab — immediate or queued — and says so", async () => {
    setOnline(false);
    const load = vi.fn(() => Promise.resolve("x"));
    expect(await lane.run("A", {}, load)).toEqual({ status: "inactive" });
    expect(load).not.toHaveBeenCalled();

    setOnline(true);
    const running = deferred<string>();
    const first = lane.run("A", {}, () => running.promise);
    const queued = lane.run("B", {}, load);
    setVisibility("hidden");
    running.resolve("A");
    await first;
    expect(await queued).toEqual({ status: "inactive" });
    expect(load).not.toHaveBeenCalled();
  });

  it("releasing an owner drops its queued work unsent; its load on the wire runs on so a remount can join it", async () => {
    const running = deferred<string>();
    const loadA = vi.fn(() => running.promise);
    const loadB = vi.fn(() => Promise.resolve("B"));
    const owner = {};
    lane.run("A", owner, loadA);
    const queued = lane.run("B", owner, loadB);
    lane.release(owner);
    expect(await queued).toEqual({ status: "superseded" });
    const rejoined = lane.run("A", {}, loadA);
    expect(loadA).toHaveBeenCalledTimes(1);
    running.resolve("A");
    expect(await rejoined).toEqual({ status: "ok", data: "A" });
    await tick();
    expect(loadB).not.toHaveBeenCalled();
  });
});

describe("DashboardRefreshTracker", () => {
  const ok = (): Promise<DashboardSectionOutcome> => Promise.resolve({ status: "ok" });

  it("waits for the work every section reported, and no longer", async () => {
    const tracker = new DashboardRefreshTracker();
    const slow = deferred<DashboardSectionOutcome>();
    tracker.report(1, "stats", ok());
    const done = tracker.wait(1, ["stats", "appointments"]);
    let settled = false;
    void done.then(() => (settled = true));
    await tick();
    tracker.report(1, "appointments", slow.promise);
    await tick();
    expect(settled).toBe(false);
    slow.resolve({ status: "failed" });
    expect(await done).toEqual({ outcomes: { stats: { status: "ok" }, appointments: { status: "failed" } }, pending: [] });
  });

  it("a deferred section resolves at once and never holds up the others", async () => {
    const tracker = new DashboardRefreshTracker();
    tracker.report(1, "leaderboard", Promise.resolve({ status: "deferred", until: 123 }));
    tracker.report(1, "stats", ok());
    const summary = await tracker.wait(1, ["leaderboard", "stats"]);
    expect(summary.outcomes.leaderboard).toEqual({ status: "deferred", until: 123 });
    expect(summary.pending).toEqual([]);
  });

  it("is bounded: work that never settles is left pending at the wait bound", async () => {
    vi.useFakeTimers();
    const tracker = new DashboardRefreshTracker();
    tracker.report(1, "stats", ok());
    tracker.report(1, "callbacks", new Promise<DashboardSectionOutcome>(() => {}));
    const done = tracker.wait(1, ["stats", "callbacks"]);
    await vi.advanceTimersByTimeAsync(DASHBOARD_REFRESH_WAIT_MS);
    expect(await done).toEqual({ outcomes: { stats: { status: "ok" } }, pending: ["callbacks"] });
  });

  it("waits only for mounted sections; one that unmounts meanwhile counts as skipped", async () => {
    const tracker = new DashboardRefreshTracker();
    const unregisterStats = tracker.register("stats");
    const unregisterSchedule = tracker.register("appointments");
    expect(tracker.mountedSections().sort()).toEqual(["appointments", "stats"]);
    tracker.report(1, "stats", ok());
    const done = tracker.wait(1);
    unregisterSchedule();
    expect(await done).toEqual({
      outcomes: { stats: { status: "ok" }, appointments: { status: "skipped" } },
      pending: [],
    });
    unregisterStats();
    expect(tracker.mountedSections()).toEqual([]);
  });
});
