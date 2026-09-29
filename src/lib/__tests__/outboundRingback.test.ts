// Outbound ringback helper — the tone itself (US cadence, level) and the owner-scoped, idempotent
// start/stop contract that keeps it to exactly one loop, never alongside carrier early media.
import { describe, expect, it, vi } from "vitest";
import {
  OutboundRingback,
  RINGBACK_EDGE_SECONDS,
  RINGBACK_OFF_SECONDS,
  RINGBACK_ON_SECONDS,
  RINGBACK_PEAK_LEVEL,
  renderRingbackCycle,
} from "@/lib/outboundRingback";
import { FakeAudioContext, type FakeAudioOptions } from "./fixtures/fakeRingbackAudio";

function setup(opts: FakeAudioOptions = {}, extra: { noAudio?: boolean } = {}) {
  const contexts: FakeAudioContext[] = [];
  const timers: Array<() => void> = [];
  const log = vi.fn();
  const ringback = new OutboundRingback({
    createAudioContext: () => {
      if (extra.noAudio) return null;
      const ctx = new FakeAudioContext(opts);
      contexts.push(ctx);
      return ctx;
    },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    log,
  });
  const ctx = () => contexts[0];
  const audible = () => contexts.reduce((n, c) => n + c.audibleCount(), 0);
  return { ringback, contexts, ctx, audible, timers, log };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

/** Goertzel power of `hz` over `samples` — enough to tell which tones are present. */
function tonePower(samples: Float32Array, sampleRate: number, hz: number): number {
  const w = (2 * Math.PI * hz) / sampleRate;
  const coeff = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (const x of samples) {
    const s0 = x + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return (s1 * s1 + s2 * s2 - coeff * s1 * s2) / samples.length;
}

describe("renderRingbackCycle — US ringback: 440 Hz + 480 Hz, 2 s on / 4 s off", () => {
  const rate = 8000;
  const cycle = renderRingbackCycle(rate);
  const on = RINGBACK_ON_SECONDS * rate;

  it("one cycle is exactly 6 s, the burst 2 s, the rest exact silence", () => {
    expect(cycle.length).toBe((RINGBACK_ON_SECONDS + RINGBACK_OFF_SECONDS) * rate);
    expect(RINGBACK_ON_SECONDS).toBe(2);
    expect(RINGBACK_OFF_SECONDS).toBe(4);
    const burstEnergy = cycle.slice(0, on).reduce((a, x) => a + x * x, 0);
    expect(burstEnergy).toBeGreaterThan(on * 0.1);
    expect(cycle.slice(on).every((x) => x === 0)).toBe(true);
  });

  it("the burst carries 440 and 480 Hz, and nothing else of note", () => {
    const burst = cycle.slice(0, on);
    const p440 = tonePower(burst, rate, 440);
    const p480 = tonePower(burst, rate, 480);
    expect(p440).toBeGreaterThan(10);
    expect(p480).toBeGreaterThan(10);
    for (const other of [350, 400, 620, 1000]) {
      expect(tonePower(burst, rate, other)).toBeLessThan(p440 / 100);
    }
  });

  it("peaks at full scale before the output gain, and fades in/out so the loop never clicks", () => {
    const peak = cycle.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
    expect(peak).toBeLessThanOrEqual(1);
    expect(peak).toBeGreaterThan(0.9);
    expect(cycle[0]).toBe(0);
    expect(Math.abs(cycle[on - 1])).toBeLessThan(1e-6);
    const edge = Math.round(RINGBACK_EDGE_SECONDS * rate);
    for (let i = 0; i < edge; i++) expect(Math.abs(cycle[i])).toBeLessThanOrEqual((i / edge) + 1e-9);
  });
});

describe("OutboundRingback — ringing(hasEarlyMedia) decisions", () => {
  it("ringing(false) starts ONE looping ringback at a low headset level", () => {
    const { ringback, ctx, audible } = setup();
    const call = {};
    expect(ringback.onRinging(call, false)).toBe("synthetic");
    expect(ringback.isPlaying(call)).toBe(true);
    expect(audible()).toBe(1);
    const [source] = ctx().sources;
    const [gain] = ctx().gains;
    expect(source.loop).toBe(true);
    expect(source.connectedTo).toBe(gain);
    expect(gain.connectedTo).toBe(ctx().destination);
    expect(gain.gain.value).toBe(RINGBACK_PEAK_LEVEL);
    expect(RINGBACK_PEAK_LEVEL).toBeLessThanOrEqual(0.2);
  });

  it("ringing(true) plays no synthetic tone — the carrier's early media is the ringback", () => {
    const { ringback, contexts, audible } = setup();
    const call = {};
    expect(ringback.onRinging(call, true)).toBe("carrier");
    expect(ringback.isPlaying()).toBe(false);
    expect(audible()).toBe(0);
    expect(contexts).toHaveLength(0); // no audio context is even created
  });

  it("duplicate ringing(false) events never create a second loop", () => {
    const { ringback, ctx, audible } = setup();
    const call = {};
    for (let i = 0; i < 5; i++) expect(ringback.onRinging(call, false)).toBe("synthetic");
    expect(ctx().sources).toHaveLength(1);
    expect(audible()).toBe(1);
  });

  it("early media arriving mid-ring (false → true) silences the synthetic tone immediately", () => {
    const { ringback, ctx, audible } = setup();
    const call = {};
    ringback.onRinging(call, false);
    expect(audible()).toBe(1);
    expect(ringback.onRinging(call, true)).toBe("carrier");
    expect(audible()).toBe(0);
    expect(ringback.isPlaying()).toBe(false);
    expect(ctx().gains[0].gain.events).toContainEqual(["ramp", 0, RINGBACK_EDGE_SECONDS]);
  });

  it("once a call had early media it never gets the synthetic tone (true → false, or a direct start)", () => {
    const { ringback, audible } = setup();
    const call = {};
    ringback.onRinging(call, true);
    expect(ringback.onRinging(call, false)).toBe("carrier");
    expect(ringback.start(call)).toBe(false);
    expect(audible()).toBe(0);
  });

  it("a non-boolean hasEarlyMedia changes nothing", () => {
    const { ringback, audible } = setup();
    const call = {};
    expect(ringback.onRinging(call, undefined)).toBe("none");
    expect(audible()).toBe(0);
    ringback.onRinging(call, false);
    expect(ringback.onRinging(call, "yes")).toBe("none");
    expect(audible()).toBe(1);
  });
});

describe("OutboundRingback — ownership and idempotency", () => {
  it("stop() and stop(owner) are idempotent and safe with nothing playing", () => {
    const { ringback, audible } = setup();
    expect(() => { ringback.stop(); ringback.stop({}); }).not.toThrow();
    const call = {};
    ringback.start(call);
    ringback.stop(call);
    ringback.stop(call);
    ringback.stop();
    expect(audible()).toBe(0);
  });

  it("a stale owner can neither stop nor replace-by-stopping the current call's tone", () => {
    const { ringback, audible } = setup();
    const stale = {};
    const current = {};
    ringback.start(current);
    ringback.stop(stale);
    ringback.onRinging(stale, true); // a stale call's early media only concerns the stale call
    expect(ringback.isPlaying(current)).toBe(true);
    expect(audible()).toBe(1);
  });

  it("starting another owner silences the previous tone first — two loops never overlap", () => {
    const { ringback, ctx, audible } = setup();
    const first = {};
    const second = {};
    ringback.start(first);
    ringback.start(second);
    expect(audible()).toBe(1);
    expect(ctx().sources[0].stopped).toBe(true);
    expect(ringback.isPlaying(first)).toBe(false);
    expect(ringback.isPlaying(second)).toBe(true);
  });

  it("an unconditional stop() silences whichever call owns the tone", () => {
    const { ringback, audible } = setup();
    ringback.start({});
    ringback.stop();
    expect(audible()).toBe(0);
    expect(ringback.isPlaying()).toBe(false);
  });

  it("restart after stop reuses the context and the rendered cycle, and a new loop plays", () => {
    const { ringback, contexts, ctx, audible } = setup();
    const call = {};
    ringback.start(call);
    ringback.stop(call);
    ringback.start(call);
    expect(contexts).toHaveLength(1);
    expect(ctx().buffers).toHaveLength(1);
    expect(ctx().sources).toHaveLength(2);
    expect(audible()).toBe(1);
  });
});

describe("OutboundRingback — release and context lifecycle", () => {
  it("stop frees the nodes on `ended` and suspends the idle context", async () => {
    const { ringback, ctx } = setup();
    const call = {};
    ringback.start(call);
    ringback.stop(call);
    await flush();
    expect(ctx().sources[0].disconnected).toBe(true);
    expect(ctx().gains[0].disconnected).toBe(true);
    expect(ctx().suspendCalls).toBe(1);
  });

  it("nodes are still freed when `ended` never fires (fallback timer)", () => {
    const { ringback, ctx, timers } = setup({ autoEnded: false });
    ringback.start({});
    ringback.stop();
    expect(ctx().sources[0].disconnected).toBe(false);
    timers.forEach((t) => t());
    expect(ctx().sources[0].disconnected).toBe(true);
    expect(ctx().gains[0].disconnected).toBe(true);
  });

  it("every start resumes the context, so a suspend pending from the last stop cannot mute the next ring", async () => {
    const { ringback, ctx } = setup();
    const call = {};
    ringback.start(call);
    ringback.stop(call);
    await flush(); // idle → suspended
    expect(ctx().state).toBe("suspended");
    ringback.start({});
    expect(ctx().resumeCalls).toBe(2);
    await flush();
    expect(ctx().state).toBe("running");
  });

  it("a later `ended` of an old loop never suspends the context under a newer tone", async () => {
    const { ringback, ctx } = setup();
    ringback.start({});
    ringback.start({}); // first loop stopped, its `ended` fires after the second starts
    await flush();
    expect(ctx().suspendCalls).toBe(0);
    expect(ctx().state).toBe("running");
  });

  it("a suspended context releases immediately (no fade to wait for)", () => {
    const { ringback, ctx } = setup({ initialState: "suspended", resume: "pending" });
    ringback.start({});
    ringback.stop();
    expect(ctx().sources[0].stopped).toBe(true);
    expect(ctx().sources[0].disconnected).toBe(true);
  });
});

describe("OutboundRingback — audio failures never reach the call", () => {
  it("no Web Audio in this browser: nothing plays, nothing throws", () => {
    const { ringback } = setup({}, { noAudio: true });
    const call = {};
    expect(ringback.onRinging(call, false)).toBe("none");
    expect(ringback.isPlaying()).toBe(false);
    expect(() => ringback.stop()).not.toThrow();
  });

  it("autoplay policy rejects resume(): no throw, no unhandled rejection, and stop still works", async () => {
    const { ringback, audible, log } = setup({ initialState: "suspended", resume: "reject" });
    const call = {};
    expect(() => ringback.onRinging(call, false)).not.toThrow();
    await flush();
    expect(log).toHaveBeenCalledWith("audio context resume blocked", expect.anything());
    ringback.stop(call);
    expect(audible()).toBe(0);
  });

  it("a Web Audio exception while building the tone is swallowed and leaves no loop behind", () => {
    const { ringback, audible, ctx } = setup({ failCreateBufferSource: true });
    expect(ringback.start({})).toBe(false);
    expect(ringback.isPlaying()).toBe(false);
    expect(audible()).toBe(0);
    expect(ctx().gains[0].disconnected).toBe(true);
  });
});
