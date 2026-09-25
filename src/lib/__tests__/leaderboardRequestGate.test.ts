import { describe, it, expect, vi, afterEach } from "vitest";
import {
  LeaderboardRequestGate,
  LEADERBOARD_REQUEST_TIMEOUT_MS,
  classifyLeaderboardFailure,
  getLeaderboardRequestGate,
  leaderboardRetryDelayMs,
  resetLeaderboardRequestGates,
  resolveLeaderboardPollMs,
  type LeaderboardLoadResult,
  type LeaderboardRunRequest,
} from "@/lib/leaderboardRequestGate";
import {
  STANDINGS_STATUS_OK,
  standingsDetail,
  standingsHeadline,
  tvTickerText,
  type StandingsStatus,
} from "@/lib/leaderboardStatusCopy";

/**
 * The request gate is what stops the leaderboard from amplifying load again
 * (2026-09-23 incident: 4 s polling, realtime refreshes in hidden tabs, piled-up
 * slow requests, no backoff). These tests pin each of its rules in isolation.
 */

type Res = LeaderboardLoadResult<unknown>;
const deferred = () => {
  let resolve!: (v: Res) => void;
  const promise = new Promise<Res>((r) => (resolve = r));
  return { promise, resolve };
};

let clock = 1_000_000;
const now = () => clock;
const mid = () => 0.5;
const OWNER = {};
const PT503 = { code: "PT503", message: "Standings temporarily paused" };
const PT429 = { code: "PT429", message: "Standings are busy" };

const req = (over: Partial<LeaderboardRunRequest<unknown>>): LeaderboardRunRequest<unknown> => ({
  endpoint: "org_standings",
  channel: "standings",
  key: "k",
  mode: "initial",
  owner: OWNER,
  load: () => Promise.resolve({ data: [], error: null }),
  ...over,
});

afterEach(() => {
  clock = 1_000_000;
  vi.useRealTimers();
  resetLeaderboardRequestGates();
});

describe("classification, backoff and cadence", () => {
  it("maps the pause to maintenance and the future guard to busy; everything else is an error", () => {
    expect(classifyLeaderboardFailure(PT503)).toBe("maintenance");
    expect(classifyLeaderboardFailure(PT429)).toBe("busy");
    expect(classifyLeaderboardFailure({ code: "42501" })).toBe("error");
    expect(classifyLeaderboardFailure({ code: "" })).toBe("error");
    expect(classifyLeaderboardFailure(null)).toBe("error");
  });

  it("holds maintenance for 5 minutes (±10 %) and backs off errors 30 s → 5 min, busy 15 s → 2 min", () => {
    expect(leaderboardRetryDelayMs("maintenance", 1, mid)).toBe(300_000);
    expect(leaderboardRetryDelayMs("maintenance", 1, () => 0)).toBe(270_000);
    expect(leaderboardRetryDelayMs("maintenance", 1, () => 1)).toBe(330_000);
    expect(leaderboardRetryDelayMs("error", 1, mid)).toBe(30_000);
    expect(leaderboardRetryDelayMs("error", 2, mid)).toBe(60_000);
    expect(leaderboardRetryDelayMs("timeout", 4, mid)).toBe(240_000);
    expect(leaderboardRetryDelayMs("error", 9, mid)).toBe(300_000);
    expect(leaderboardRetryDelayMs("busy", 1, mid)).toBe(15_000);
    expect(leaderboardRetryDelayMs("busy", 9, mid)).toBe(120_000);
  });

  it("polls every 30 s by default, rejects the legacy 4 s value, and caps at 5 min", () => {
    expect(resolveLeaderboardPollMs(undefined)).toBe(30_000);
    expect(resolveLeaderboardPollMs("")).toBe(30_000);
    expect(resolveLeaderboardPollMs("4000")).toBe(30_000);
    expect(resolveLeaderboardPollMs("abc")).toBe(30_000);
    expect(resolveLeaderboardPollMs("60000")).toBe(60_000);
    expect(resolveLeaderboardPollMs("9999999")).toBe(300_000);
  });
});

describe("serialize and coalesce", () => {
  it("20 simultaneous identical refreshes make ONE request", async () => {
    const g = new LeaderboardRequestGate(now, mid);
    const d = deferred();
    let calls = 0;
    const runs = Array.from({ length: 20 }, () =>
      g.run(req({ mode: "auto", load: () => ((calls += 1), d.promise) })),
    );
    await Promise.resolve();
    expect(calls).toBe(1);
    d.resolve({ data: [1], error: null });
    const results = await Promise.all(runs);
    expect(results.every((r) => r.status === "ok")).toBe(true);
  });

  it("allows one request in flight; a newer queued request replaces an older one, which never touches the network", async () => {
    const g = new LeaderboardRequestGate(now, mid);
    const a = deferred();
    const b = deferred();
    const loads: string[] = [];
    const p1 = g.run(req({ key: "today", load: () => (loads.push("today"), a.promise) }));
    const p2 = g.run(req({ key: "week", load: () => (loads.push("week"), b.promise) }));
    const p3 = g.run(req({ key: "month", load: () => (loads.push("month"), b.promise) }));
    await Promise.resolve();
    expect(loads).toEqual(["today"]);
    expect(await p2).toEqual({ status: "superseded" });
    a.resolve({ data: ["today"], error: null });
    expect(await p1).toEqual({ status: "ok", data: ["today"] });
    await Promise.resolve();
    await Promise.resolve();
    expect(loads).toEqual(["today", "month"]);
    b.resolve({ data: ["month"], error: null });
    expect(await p3).toEqual({ status: "ok", data: ["month"] });
  });

  it("runs queued standings before queued wins, still one at a time", async () => {
    const g = new LeaderboardRequestGate(now, mid);
    const a = deferred();
    const order: string[] = [];
    const first = g.run(req({ key: "first", load: () => (order.push("first"), a.promise) }));
    const wins = g.run(req({ endpoint: "wins", channel: "wins", key: "wins", load: () => (order.push("wins"), Promise.resolve({ data: [], error: null })) }));
    const standings = g.run(req({ key: "second", load: () => (order.push("second"), Promise.resolve({ data: [], error: null })) }));
    a.resolve({ data: [], error: null });
    await Promise.all([first, wins, standings]);
    expect(order).toEqual(["first", "second", "wins"]);
  });

  it("a manual joiner never makes a queued filter switch refusable (it still runs within 30 s of the last start)", async () => {
    const g = new LeaderboardRequestGate(now, mid);
    const inFlight = deferred();
    const week = deferred();
    let weekCalls = 0;
    const today = g.run(req({ key: "today", load: () => inFlight.promise }));
    const switched = g.run(req({ key: "week", mode: "initial", load: () => ((weekCalls += 1), week.promise) }));
    const retry = g.run(req({ key: "week", mode: "manual", load: () => ((weekCalls += 1), week.promise) }));
    expect(retry).toBe(switched);
    clock += 5_000;
    inFlight.resolve({ data: ["today"], error: null });
    await today;
    await Promise.resolve();
    await Promise.resolve();
    expect(weekCalls).toBe(1);
    week.resolve({ data: ["week"], error: null });
    expect(await switched).toEqual({ status: "ok", data: ["week"] });
  });

  it("a realtime event never joins a read that started before it arrived", async () => {
    const g = new LeaderboardRequestGate(now, mid);
    const a = deferred();
    const b = deferred();
    const p1 = g.run(req({ endpoint: "wins", channel: "wins", key: "w", mode: "auto", load: () => a.promise }));
    clock += 1_000;
    const p2 = g.run(req({ endpoint: "wins", channel: "wins", key: "w", notBefore: clock, load: () => b.promise }));
    expect(p2).not.toBe(p1);
    a.resolve({ data: ["before the win"], error: null });
    await p1;
    b.resolve({ data: ["with the win"], error: null });
    expect(await p2).toEqual({ status: "ok", data: ["with the win"] });
  });
});

describe("cooldowns and holds", () => {
  it("a PT503 holds the endpoint: automatic, initial and manual runs send nothing; other endpoints are unaffected", async () => {
    const g = new LeaderboardRequestGate(now, mid);
    let calls = 0;
    const paused = () => ((calls += 1), Promise.resolve({ data: null, error: PT503 }));
    expect(await g.run(req({ load: paused }))).toEqual({ status: "failed", kind: "maintenance", retryAt: clock + 300_000 });

    for (const mode of ["auto", "initial", "manual"] as const) {
      expect(await g.run(req({ key: "other", mode, load: paused }))).toEqual({
        status: "blocked",
        reason: "cooldown",
        kind: "maintenance",
        retryAt: clock + 300_000,
      });
    }
    clock += 60_000;
    expect(await g.run(req({ key: "other", mode: "manual", load: paused }))).toMatchObject({ status: "blocked", reason: "cooldown" });
    expect(calls).toBe(1);
    expect(g.manualAvailableAt("org_standings")).toBe(1_000_000 + 300_000);

    expect(await g.run(req({ endpoint: "group_standings", key: "g", load: () => Promise.resolve({ data: ["g"], error: null }) }))).toEqual({ status: "ok", data: ["g"] });
    expect(await g.run(req({ endpoint: "wins", channel: "wins", key: "w", load: () => Promise.resolve({ data: [], error: null }) }))).toEqual({ status: "ok", data: [] });

    clock = 1_000_000 + 300_001;
    expect(await g.run(req({ key: "other", mode: "initial", load: () => Promise.resolve({ data: [9], error: null }) }))).toEqual({ status: "ok", data: [9] });
    expect(g.cooldown("org_standings")).toBeNull();
  });

  it("a PT429 busy hold also refuses manual runs; an ordinary error does not", async () => {
    const g = new LeaderboardRequestGate(now, mid);
    await g.run(req({ load: () => Promise.resolve({ data: null, error: PT429 }) }));
    clock += 10_000; // inside the first 15 s busy hold
    let calls = 0;
    expect(await g.run(req({ mode: "manual", load: () => ((calls += 1), Promise.resolve({ data: [], error: null })) }))).toMatchObject({ status: "blocked", reason: "cooldown", kind: "busy" });
    expect(calls).toBe(0);

    const g2 = new LeaderboardRequestGate(now, mid);
    await g2.run(req({ load: () => Promise.resolve({ data: null, error: { code: "500" } }) }));
    expect(await g2.run(req({ mode: "auto", load: () => ((calls += 1), Promise.resolve({ data: [], error: null })) }))).toMatchObject({ status: "blocked", reason: "cooldown", kind: "error" });
    clock += 30_000;
    expect(await g2.run(req({ mode: "manual", load: () => ((calls += 1), Promise.resolve({ data: [1], error: null })) }))).toEqual({ status: "ok", data: [1] });
    expect(calls).toBe(1);
  });

  it("re-checks the hold when a queued run starts: an in-flight PT503 plus a queued period switch is ONE request", async () => {
    const g = new LeaderboardRequestGate(now, mid);
    const a = deferred();
    let calls = 0;
    const today = g.run(req({ key: "today", load: () => ((calls += 1), a.promise) }));
    const week = g.run(req({ key: "week", load: () => ((calls += 1), a.promise) }));
    a.resolve({ data: null, error: PT503 });
    expect(await today).toMatchObject({ status: "failed", kind: "maintenance" });
    expect(await week).toMatchObject({ status: "blocked", reason: "cooldown", kind: "maintenance" });
    expect(calls).toBe(1);
  });

  it("spaces automatic runs 15 s from any start, and twice the response time after a slow answer", async () => {
    const g = new LeaderboardRequestGate(now, mid);
    await g.run(req({}));
    clock += 10_000;
    expect(await g.run(req({ mode: "auto" }))).toEqual({ status: "blocked", reason: "throttled", availableAt: 1_000_000 + 15_000 });

    const slow = deferred();
    clock = 2_000_000;
    const p = g.run(req({ key: "slow", load: () => slow.promise }));
    clock += 20_000;
    slow.resolve({ data: [1], error: null });
    await p;
    expect(g.autoAvailableAt("org_standings")).toBe(clock + 40_000);
    expect(await g.run(req({ key: "slow", mode: "auto" }))).toEqual({ status: "blocked", reason: "throttled", availableAt: clock + 40_000 });
  });

  it("spaces manual runs 30 s after the last start and 15 s after the last response", async () => {
    const g = new LeaderboardRequestGate(now, mid);
    await g.run(req({}));
    expect(await g.run(req({ mode: "manual" }))).toEqual({ status: "blocked", reason: "throttled", availableAt: 1_000_000 + 30_000 });
    clock += 30_000;
    expect(await g.run(req({ mode: "manual" }))).toEqual({ status: "ok", data: [] });
  });
});

describe("timeouts, owners and disposal", () => {
  it("frees the lane at 25 s even if the load never settles; the queued run starts and a late answer changes nothing", async () => {
    vi.useFakeTimers();
    const g = new LeaderboardRequestGate(now, mid);
    let aborted = false;
    const hung = deferred();
    const p1 = g.run(req({
      key: "hung",
      load: (signal) => {
        signal.addEventListener("abort", () => (aborted = true));
        return hung.promise;
      },
    }));
    let winsStarted = false;
    const p2 = g.run(req({ endpoint: "wins", channel: "wins", key: "w", load: () => ((winsStarted = true), Promise.resolve({ data: ["w"], error: null })) }));
    await vi.advanceTimersByTimeAsync(LEADERBOARD_REQUEST_TIMEOUT_MS - 1);
    expect(winsStarted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p1).toMatchObject({ status: "failed", kind: "timeout" });
    expect(aborted).toBe(true);
    expect(await p2).toEqual({ status: "ok", data: ["w"] });
    const hold = g.cooldown("org_standings");
    hung.resolve({ data: ["late"], error: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(g.cooldown("org_standings")).toEqual(hold);
  });

  it("release drops an owner's queued work without a network call; other owners' work continues", async () => {
    const g = new LeaderboardRequestGate(now, mid);
    const a = deferred();
    const other = {};
    let calls = 0;
    const p1 = g.run(req({ owner: other, key: "1", load: () => ((calls += 1), a.promise) }));
    const p2 = g.run(req({ endpoint: "wins", channel: "wins", key: "w", load: () => ((calls += 1), a.promise) }));
    g.release(OWNER);
    expect(await p2).toEqual({ status: "superseded" });
    a.resolve({ data: [1], error: null });
    expect(await p1).toEqual({ status: "ok", data: [1] });
    await Promise.resolve();
    expect(calls).toBe(1);
  });

  it("dispose supersedes queued and in-flight work and refuses new runs", async () => {
    const g = new LeaderboardRequestGate(now, mid);
    const a = deferred();
    const p1 = g.run(req({ key: "1", load: () => a.promise }));
    const p2 = g.run(req({ endpoint: "wins", channel: "wins", key: "2", load: () => a.promise }));
    g.dispose();
    a.resolve({ data: [1], error: null });
    expect(await p1).toEqual({ status: "superseded" });
    expect(await p2).toEqual({ status: "superseded" });
    expect(await g.run(req({ key: "3" }))).toEqual({ status: "superseded" });
  });

  it("keeps one gate per viewer, shares it across surfaces, and never evicts a busy gate", async () => {
    const a = getLeaderboardRequestGate("user-a:org-1");
    expect(getLeaderboardRequestGate("user-a:org-1")).toBe(a);
    expect(getLeaderboardRequestGate("user-b:org-1")).not.toBe(a);

    const d = deferred();
    void a.run(req({ load: () => d.promise }));
    for (let i = 0; i < 6; i += 1) getLeaderboardRequestGate(`user-${i}:org-2`);
    expect(getLeaderboardRequestGate("user-a:org-1")).toBe(a);
    d.resolve({ data: [], error: null });
  });
});

describe("status copy", () => {
  const status = (over: Partial<StandingsStatus>): StandingsStatus => ({ ...STANDINGS_STATUS_OK, ...over });
  const fmt = (ms: number) => `T${ms}`;

  it("never tells people to check their connection during maintenance", () => {
    expect(standingsHeadline("maintenance", false)).toBe("Standings are paused for maintenance.");
    const detail = standingsDetail(status({ kind: "maintenance", nextCheckAt: 5_000 }), false, 1_000, fmt);
    expect(detail).toBe("The leaderboard is temporarily unavailable. We'll check again automatically at T5000.");
    expect(detail).not.toMatch(/connection/i);
  });

  it("promises a next check only when one is scheduled in the future", () => {
    expect(standingsDetail(status({ kind: "error", nextCheckAt: null }), false, 1_000, fmt)).toBe("Standings are unavailable right now.");
    expect(standingsDetail(status({ kind: "error", nextCheckAt: 500 }), false, 1_000, fmt)).toBe("Standings are unavailable right now.");
    expect(standingsDetail(status({ kind: "error", nextCheckAt: 5_000, offline: true }), false, 1_000, fmt)).toBe(
      "Standings are unavailable right now. You're offline — standings will refresh when you reconnect.",
    );
  });

  it("states the snapshot time over stale standings", () => {
    expect(standingsDetail(status({ kind: "maintenance", lastUpdatedAt: 700, nextCheckAt: 5_000 }), true, 1_000, fmt)).toBe(
      "Showing results from T700. We'll check again automatically at T5000.",
    );
    expect(standingsHeadline("error", true)).toBe("Couldn't refresh standings.");
    expect(standingsHeadline("error", false)).toBe("Couldn't load the leaderboard.");
    expect(standingsHeadline("error", false, "widget")).toBe("Couldn't load standings");
  });

  it("the TV ticker says 'No wins yet' only after a successful empty read", () => {
    const base = { customBanner: null, winsTicker: "🏆 No wins yet — get dialing!", standings: STANDINGS_STATUS_OK, format: fmt };
    expect(tvTickerText({ ...base, winsStatus: { kind: "ok", lastUpdatedAt: 1 } })).toBe("🏆 No wins yet — get dialing!");
    expect(tvTickerText({ ...base, winsStatus: { kind: "loading", lastUpdatedAt: null } })).toBe("Loading recent wins…");
    expect(tvTickerText({ ...base, winsStatus: { kind: "error", lastUpdatedAt: null } })).toBe("Recent wins unavailable");
    expect(
      tvTickerText({ ...base, winsStatus: { kind: "loading", lastUpdatedAt: null }, standings: status({ kind: "maintenance" }) }),
    ).toBe("Standings paused for maintenance");
    expect(tvTickerText({ ...base, customBanner: " Big day! ", winsStatus: { kind: "error", lastUpdatedAt: null } })).toBe("Big day!");
  });
});

describe("review round 2", () => {
  it("coming back to the in-flight request drops the owner's abandoned queued detour", async () => {
    const g = new LeaderboardRequestGate(now, mid);
    const a = deferred();
    let weekCalls = 0;
    const today = g.run(req({ key: "today", load: () => a.promise }));
    const week = g.run(req({ key: "week", load: () => ((weekCalls += 1), Promise.resolve({ data: [], error: null })) }));
    const back = g.run(req({ key: "today", load: () => a.promise }));
    expect(back).toBe(today);
    expect(await week).toEqual({ status: "superseded" });
    a.resolve({ data: ["today"], error: null });
    await today;
    await Promise.resolve();
    expect(weekCalls).toBe(0);
  });

  it("never drops a queued job another owner also wants", async () => {
    const g = new LeaderboardRequestGate(now, mid);
    const a = deferred();
    const other = {};
    let weekCalls = 0;
    const today = g.run(req({ key: "today", load: () => a.promise }));
    const week = g.run(req({ key: "week", load: () => ((weekCalls += 1), Promise.resolve({ data: ["w"], error: null })) }));
    void g.run(req({ key: "week", owner: other, load: () => Promise.resolve({ data: ["w"], error: null }) }));
    void g.run(req({ key: "today", load: () => a.promise }));
    a.resolve({ data: ["today"], error: null });
    await today;
    expect(await week).toEqual({ status: "ok", data: ["w"] });
    expect(weekCalls).toBe(1);
  });
});
