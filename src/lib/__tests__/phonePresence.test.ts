// Inbound Calling v2 — presence with registration GENERATIONS (implementation_plan.md rev 3 §6.2,
// §12 `phonePresence.test.ts`). Fail-first against a fake RPC: the registration id is minted in memory
// and never persisted, `seq` increments before every send, and the duplicate-tab / reload / delayed
// pagehide / reordered heartbeat / logout sequences can never hide a live registration.
import { describe, expect, it } from "vitest";
import { PhonePresence, type HeartbeatArgs } from "@/lib/phonePresence";

function harness(opts: { uuids?: string[]; rpcResult?: (a: HeartbeatArgs) => { applied: boolean; reason: string } } = {}) {
  const sent: HeartbeatArgs[] = [];
  const keepalive: HeartbeatArgs[] = [];
  const intervals: Array<{ fn: () => void; ms: number }> = [];
  let cleared = 0;
  const uuids = [...(opts.uuids ?? ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222", "33333333-3333-3333-3333-333333333333"])];
  const presence = new PhonePresence({
    rpc: async (a) => { sent.push(a); return opts.rpcResult ? opts.rpcResult(a) : { applied: true, reason: "ok" }; },
    keepalive: (a) => { keepalive.push(a); },
    uuid: () => uuids.shift() ?? "99999999-9999-9999-9999-999999999999",
    now: () => 1_000,
    heartbeatMs: 45_000,
    setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
    clearInterval: () => { cleared += 1; },
  });
  return { presence, sent, keepalive, intervals, get cleared() { return cleared; } };
}

describe("P1 — a registration generation is minted in memory on every `registered`", () => {
  it("registered ⇒ new id, seq 1, registered:true; the id is never read from storage", async () => {
    const h = harness();
    await h.presence.onRegistered();
    expect(h.sent).toEqual([{ p_registration_id: "11111111-1111-1111-1111-111111111111", p_seq: 1, p_registered: true, p_state: "registered", p_detail: null }]);
    expect(h.intervals[0].ms).toBe(45_000);
  });

  it("a reload / second registered event mints a DIFFERENT id and restarts seq at 1 (the old row simply expires)", async () => {
    const h = harness();
    await h.presence.onRegistered();
    await h.presence.onUnregistered("reload");
    await h.presence.onRegistered();
    expect(h.sent.map((a) => `${a.p_registration_id.slice(0, 8)}:${a.p_seq}:${a.p_registered}`)).toEqual([
      "11111111:1:true", "11111111:2:false", "22222222:1:true",
    ]);
  });

  it("seq increments before EVERY send (heartbeat, ring detail, unregister)", async () => {
    const h = harness();
    await h.presence.onRegistered();
    await h.presence.heartbeat("visible");
    h.presence.noteRing(19_480, "cancel");
    await Promise.resolve();
    await h.presence.onUnregistered("pagehide");
    expect(h.sent.map((a) => a.p_seq)).toEqual([1, 2, 3, 4]);
    expect(h.sent[2].p_detail).toBe("ring:19480:cancel");
  });
});

describe("P2 — nothing can hide a LIVE registration", () => {
  it("duplicate tab: two PhonePresence instances never share an id, so tab B closing cannot touch tab A", async () => {
    const a = harness({ uuids: ["aaaaaaaa-0000-0000-0000-0000000000a1"] });
    const b = harness({ uuids: ["bbbbbbbb-0000-0000-0000-0000000000b1"] });
    await a.presence.onRegistered();
    await b.presence.onRegistered();
    b.presence.flushUnregisterKeepalive("pagehide");
    expect(b.keepalive[0].p_registration_id).toBe("bbbbbbbb-0000-0000-0000-0000000000b1");
    expect(a.sent.every((x) => x.p_registration_id === "aaaaaaaa-0000-0000-0000-0000000000a1")).toBe(true);
    expect(a.presence.snapshot().registered).toBe(true);
  });

  it("delayed pagehide of the OLD generation carries the old id — the new generation is untouched", async () => {
    const h = harness();
    await h.presence.onRegistered();                        // gen 1
    const late = h.presence.flushUnregisterKeepalive("pagehide"); // gen 1 closed (seq 2)
    await h.presence.onRegistered();                        // gen 2
    expect(late?.p_registration_id).toBe("11111111-1111-1111-1111-111111111111");
    expect(h.sent[h.sent.length - 1]).toMatchObject({ p_registration_id: "22222222-2222-2222-2222-222222222222", p_seq: 1, p_registered: true });
  });

  it("a reordered older heartbeat is reported stale by the server and changes nothing locally", async () => {
    const h = harness({ rpcResult: (a) => (a.p_seq >= 2 ? { applied: true, reason: "ok" } : { applied: false, reason: "stale_seq" }) });
    await h.presence.onRegistered();
    const r = await h.presence.heartbeat();
    expect(r).toEqual({ applied: true, reason: "ok" });
    const snap = h.presence.snapshot();
    expect(snap.history.map((x) => (typeof x.result === "object" && x.result ? x.result.reason : x.result))).toEqual(["stale_seq", "ok"]);
    expect(snap.registered).toBe(true);
  });

  it("logout: one synchronous keepalive write with the NEXT seq closes the current generation; later heartbeats are suppressed", async () => {
    const h = harness();
    await h.presence.onRegistered();
    const args = h.presence.flushUnregisterKeepalive("logout");
    expect(args).toEqual({ p_registration_id: "11111111-1111-1111-1111-111111111111", p_seq: 2, p_registered: false, p_state: "unregistered", p_detail: "logout" });
    expect(h.keepalive).toEqual([args]);
    expect(await h.presence.heartbeat()).toBeNull();
    expect(h.cleared).toBeGreaterThan(0);
  });

  it("before any registration there is nothing to close or heartbeat", async () => {
    const h = harness();
    expect(h.presence.flushUnregisterKeepalive("pagehide")).toBeNull();
    expect(await h.presence.heartbeat()).toBeNull();
    expect(await h.presence.onUnregistered()).toBeNull();
    expect(h.sent).toEqual([]);
  });

  it("an RPC failure is recorded and never throws into the Device lifecycle", async () => {
    const boom = new PhonePresence({ rpc: async () => { throw new Error("offline"); }, uuid: () => "11111111-1111-1111-1111-111111111111", now: () => 1, setInterval: () => 1, clearInterval: () => {} });
    await expect(boom.onRegistered()).resolves.toBeNull();
    expect(boom.snapshot().history[0].result).toBe("error");
  });
});

describe("P3 — errors close the generation; reset forgets it", () => {
  it("device error ⇒ registered:false with the error detail (max 64 chars)", async () => {
    const h = harness();
    await h.presence.onRegistered();
    await h.presence.onError("x".repeat(100));
    expect(h.sent[1]).toMatchObject({ p_registered: false, p_state: "error", p_seq: 2 });
    expect(h.sent[1].p_detail?.length).toBe(64);
  });

  it("reset (identity change) forgets the id; the next registered starts a fresh generation", async () => {
    const h = harness();
    await h.presence.onRegistered();
    h.presence.reset();
    expect(h.presence.snapshot()).toMatchObject({ registrationId: null, seq: 0, registered: false });
    await h.presence.onRegistered();
    expect(h.sent[1]).toMatchObject({ p_registration_id: "22222222-2222-2222-2222-222222222222", p_seq: 1 });
  });
});
