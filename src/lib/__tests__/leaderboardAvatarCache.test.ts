import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AVATAR_BATCH_SIZE, AVATAR_FRESH_MS, AVATAR_MAX_BYTES, AVATAR_MAX_ENTRIES,
  LeaderboardAvatarCache, type AvatarLoader, type AvatarRow } from "@/lib/leaderboardAvatarCache";
import { LeaderboardRequestGate, type LeaderboardLoadResult } from "@/lib/leaderboardRequestGate";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const resources: Array<{ dispose: () => void }> = [];
const flush = () => vi.advanceTimersByTimeAsync(0);
const photo = (id: string): AvatarRow => ({ id, avatar_url: `photo:${id}` });
function deferred() {
  let resolve!: (value: LeaderboardLoadResult<AvatarRow[]>) => void;
  const promise = new Promise<LeaderboardLoadResult<AvatarRow[]>>(r => { resolve = r; });
  return { promise, resolve };
}
function setup(load: AvatarLoader = (_org, ids) => Promise.resolve({ data: ids.map(photo), error: null })) {
  const gate = new LeaderboardRequestGate(() => Date.now(), () => 0.5);
  const loader = vi.fn(load);
  const cache = new LeaderboardAvatarCache("viewer:org", "org", gate, loader, () => Date.now());
  resources.push(cache, gate);
  const owner = {};
  const notify = vi.fn();
  const release = cache.subscribe(owner, notify);
  const demand = (ids: string[], enabled = true, roster = ids) => cache.demand(owner, ids, roster, enabled);
  return { gate, loader, cache, owner, notify, release, demand };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-26T12:00:00Z"));
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});
afterEach(() => {
  for (const resource of resources.splice(0)) resource.dispose();
  vi.useRealTimers();
});

describe("bounded private leaderboard photos", () => {
  it("coalesces page/widget IDs, caches nulls, and never refetches for a fresh refresh", async () => {
    const s = setup((_org, ids) => Promise.resolve({ data: ids.filter(id => id !== "b").map(photo), error: null }));
    const widget = {};
    s.cache.subscribe(widget, () => {});
    s.demand(["a", "b"]);
    s.cache.demand(widget, ["a"], ["a", "b"], true);
    await flush();
    expect(s.loader).toHaveBeenCalledTimes(1);
    expect(s.loader.mock.calls[0].slice(0, 2)).toEqual(["org", ["a", "b"]]);
    expect([...s.cache.read(["a", "b"])]).toEqual([["a", "photo:a"], ["b", null]]);
    s.demand(["b", "a"]); await flush();
    await vi.advanceTimersByTimeAsync(AVATAR_FRESH_MS);
    expect(s.loader).toHaveBeenCalledTimes(1); // Expiry alone does not poll.
    s.demand(["a", "b"]); await flush();
    expect(s.loader).toHaveBeenCalledTimes(2);
  });

  it("reuses a fresh photo after navigation and ignores IDs outside the current roster", async () => {
    const s = setup(); s.demand(["a", "injected"], true, ["a"]); await flush();
    s.release();
    const next = {};
    s.cache.subscribe(next, () => {}); s.cache.demand(next, ["a"], ["a"], true); await flush();
    expect(s.loader).toHaveBeenCalledTimes(1);
    expect(s.loader.mock.calls[0][1]).toEqual(["a"]);
    expect(s.cache.read(["a"]).get("a")).toBe("photo:a");
  });

  it("yields between batches to standings and wins, with only one request active", async () => {
    const d = deferred();
    const order: string[] = [];
    const s = setup((_org, ids) => { order.push("photos"); return order.length === 1 ? d.promise : Promise.resolve({ data: ids.map(photo), error: null }); });
    const ids = Array.from({ length: AVATAR_BATCH_SIZE + 1 }, (_, i) => `agent-${i.toString().padStart(2, "0")}`);
    s.demand(ids); await flush();
    const wins = s.gate.run({ endpoint: "wins", channel: "wins", key: "wins", mode: "initial", owner: {},
      load: () => { order.push("wins"); return Promise.resolve({ data: [], error: null }); } });
    const stats = s.gate.run({ endpoint: "org_standings", channel: "standings", key: "stats", mode: "initial", owner: {},
      load: () => { order.push("stats"); return Promise.resolve({ data: [], error: null }); } });
    expect(order).toEqual(["photos"]);
    d.resolve({ data: ids.slice(0, AVATAR_BATCH_SIZE).map(photo), error: null });
    await flush(); await Promise.all([wins, stats]);
    expect(order).toEqual(["photos", "stats", "wins"]);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(order).toEqual(["photos", "stats", "wins", "photos"]);
    expect(s.loader.mock.calls.map(c => c[1].length)).toEqual([20, 1]);
  });

  it("sends nothing while hidden and never dispatches a queued obsolete view", async () => {
    const s = setup();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    s.demand(["old"]); await flush(); expect(s.loader).not.toHaveBeenCalled();
    s.demand(["new"]);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange")); await flush();
    expect(s.loader.mock.calls.map(c => c[1])).toEqual([["new"]]);
  });

  it("a hidden tab stops unfinished batches and reconnect only reads current demand", async () => {
    const s = setup(); const ids = Array.from({ length: 22 }, (_, i) => String(i));
    s.demand(ids); await flush();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    window.dispatchEvent(new Event("offline"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.loader).toHaveBeenCalledTimes(1);
    s.demand(["replacement"]);
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    window.dispatchEvent(new Event("online")); await flush();
    expect(s.loader.mock.calls[1][1]).toEqual(["replacement"]);
  });

  it("a failed photo read keeps its cached image without a self-sustaining retry", async () => {
    const s = setup(); s.demand(["a"]); await flush();
    await vi.advanceTimersByTimeAsync(AVATAR_FRESH_MS);
    s.loader.mockResolvedValue({ data: null, error: { message: "network" } });
    s.demand(["a"]); await flush();
    expect(s.cache.read(["a"]).get("a")).toBe("photo:a");
    await vi.advanceTimersByTimeAsync(600_000);
    expect(s.loader).toHaveBeenCalledTimes(2);
    s.demand(["a"], false); await flush();
    expect(s.loader).toHaveBeenCalledTimes(2);
  });

  it("clears the deferred batch timer when the last photo demand becomes unavailable", async () => {
    const s = setup(); const ids = Array.from({ length: 21 }, (_, i) => String(i));
    s.demand(ids); await flush();
    expect(s.loader).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    s.demand(ids, false); await flush();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.loader).toHaveBeenCalledTimes(1);
  });

  it("rejects unsolicited response IDs rather than poisoning another agent's image", async () => {
    const s = setup(() => Promise.resolve({ data: [photo("foreign")], error: null }));
    s.demand(["a"]); await flush();
    expect(s.cache.read(["a", "foreign"]).size).toBe(0);
  });

  it("times out/aborts photos after five seconds and ignores a later success", async () => {
    const d = deferred(); const s = setup(() => d.promise);
    s.demand(["a"]); await flush();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(s.loader.mock.calls[0][2].aborted).toBe(true);
    expect(s.gate.busy).toBe(false);
    d.resolve({ data: [photo("a")], error: null }); await flush();
    expect(s.cache.read(["a"]).size).toBe(0);
  });

  it("unmount and identity disposal cancel work and cannot repopulate the old cache", async () => {
    const d = deferred(); const s = setup(() => d.promise);
    s.demand(["a"]); await flush(); s.release();
    expect(s.loader.mock.calls[0][2].aborted).toBe(true);
    s.cache.dispose(); d.resolve({ data: [photo("a")], error: null }); await flush();
    expect(s.cache.read(["a"]).size).toBe(0);
  });

  it("bounds large strings and entry metadata without eviction-driven fetch loops", async () => {
    const big = "x".repeat(AVATAR_MAX_BYTES / 2 + 1);
    const s = setup((_org, ids) => Promise.resolve({ data: ids.map(id => ({ id, avatar_url: id === "000" ? big : "x".repeat(80_000) })), error: null }));
    const ids = Array.from({ length: AVATAR_MAX_ENTRIES + 20 }, (_, i) => String(i).padStart(3, "0"));
    s.demand(ids); await flush();
    await vi.advanceTimersByTimeAsync(15_000 * Math.ceil(AVATAR_MAX_ENTRIES / AVATAR_BATCH_SIZE));
    const rows = s.cache.read(ids);
    expect(rows.size).toBe(AVATAR_MAX_ENTRIES);
    expect(rows.get("000")).toBeNull();
    expect([...rows.values()].reduce((n, url) => n + (url?.length ?? 0) * 2, 0)).toBeLessThanOrEqual(AVATAR_MAX_BYTES);
    const count = s.loader.mock.calls.length;
    s.demand(ids); await flush();
    expect(s.loader).toHaveBeenCalledTimes(count);
    expect(s.loader.mock.calls.flatMap(c => c[1])).toHaveLength(AVATAR_MAX_ENTRIES);
  });
});
