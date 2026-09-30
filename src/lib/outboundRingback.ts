/**
 * Outbound ringback fallback — what the agent hears while the lead's phone rings.
 *
 * SDK facts (Twilio Voice SDK 2.18.1, verified in node_modules/@twilio/voice-sdk/es5/twilio/call.js and
 * call.d.ts, pinned by src/lib/__tests__/outboundRingbackSdkPinned.test.ts):
 *  - `Call` emits `ringing` as `emit('ringing', hasEarlyMedia)` with `hasEarlyMedia = !!payload.sdp`
 *    (typed `ringingEvent(hasEarlyMedia: boolean)`), and only while the Call is `connecting` or
 *    `ringing` — so it can fire again mid-ring and `false` → `true` (early media arriving late) is possible.
 *  - With early media the SDK plays the carrier's audio itself. Without it there is nothing to hear,
 *    and the SDK leaves any ringback to the application.
 *  - `device.audio.outgoing()` is a one-shot chime played on `accept` (after the answer), not a
 *    ringback, so it cannot fill the ring phase; it stays disabled in twilio-voice.ts.
 *
 * This module plays a US ringback (440 Hz + 480 Hz, 2 s on / 4 s off) from one pre-rendered looping
 * Web Audio buffer — no timers, so a throttled background tab cannot break the cadence. There is ONE
 * tone per page. `start`/`stop` are idempotent and OWNER-scoped (the owner is the outbound Call): a
 * stop for another owner is ignored, and starting a new owner silences the previous one first, so
 * loops never overlap. An owner that ever reported early media never gets the synthetic tone. The
 * caller decides which Call is current; TwilioContext only lets the current, unfinished outbound
 * Call drive it. Every audio failure (no Web Audio, autoplay policy, a closed context) is swallowed:
 * the tone is a courtesy and can never block or fail a call.
 */

/** US ringback tone pair (Hz), summed. */
export const RINGBACK_FREQUENCIES_HZ: readonly number[] = [440, 480];
export const RINGBACK_ON_SECONDS = 2;
export const RINGBACK_OFF_SECONDS = 4;
/** Peak of the summed tones, 0–1 full scale (≈ −20 dBFS): clearly audible on a headset, never loud. */
export const RINGBACK_PEAK_LEVEL = 0.1;
/** Fade at each burst edge and on stop, so neither the cadence nor an early stop clicks. */
export const RINGBACK_EDGE_SECONDS = 0.01;
/** Nodes are released on `ended`; this fallback releases them if `ended` never fires (suspended context). */
const RELEASE_FALLBACK_MS = 250;

/** Structural view of the Web Audio surface this module uses (tests pass a fake). */
export interface RingbackAudioParam {
  value: number;
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  cancelScheduledValues(time: number): unknown;
}
export interface RingbackAudioNode {
  connect(destination: unknown): unknown;
  disconnect(): void;
}
export interface RingbackGainNode extends RingbackAudioNode {
  gain: RingbackAudioParam;
}
export interface RingbackAudioBuffer {
  getChannelData(channel: number): Float32Array;
}
export interface RingbackBufferSource extends RingbackAudioNode {
  buffer: RingbackAudioBuffer | null;
  loop: boolean;
  onended: (() => void) | null;
  start(when?: number): void;
  stop(when?: number): void;
}
export interface RingbackAudioContext {
  readonly state: string;
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly destination: unknown;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  createBuffer(channels: number, length: number, sampleRate: number): RingbackAudioBuffer;
  createBufferSource(): RingbackBufferSource;
  createGain(): RingbackGainNode;
}

/** What the agent hears after a `ringing` signal. */
export type RingingAudio = "synthetic" | "carrier" | "none";

/**
 * One 6 s ringback cycle at `sampleRate`, normalized to a peak of 1: both tones for the first 2 s
 * (with a short fade in and out), then 4 s of exact silence. Loops seamlessly (it ends in silence).
 */
export function renderRingbackCycle(sampleRate: number): Float32Array {
  const total = Math.round((RINGBACK_ON_SECONDS + RINGBACK_OFF_SECONDS) * sampleRate);
  const on = Math.round(RINGBACK_ON_SECONDS * sampleRate);
  const edge = Math.max(1, Math.round(RINGBACK_EDGE_SECONDS * sampleRate));
  const amplitude = 1 / RINGBACK_FREQUENCIES_HZ.length;
  const out = new Float32Array(total);
  for (let i = 0; i < on; i++) {
    const t = i / sampleRate;
    let sample = 0;
    for (const hz of RINGBACK_FREQUENCIES_HZ) sample += Math.sin(2 * Math.PI * hz * t);
    const envelope = Math.min(1, i / edge, (on - 1 - i) / edge);
    out[i] = amplitude * sample * envelope;
  }
  return out;
}

export interface OutboundRingbackDeps {
  /** Returns a Web Audio context, or null when the browser has none. */
  createAudioContext: () => RingbackAudioContext | null;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  log?: (message: string, meta?: Record<string, unknown>) => void;
}

interface Playback {
  owner: object;
  source: RingbackBufferSource;
  gain: RingbackGainNode;
}

export class OutboundRingback {
  private ctx: RingbackAudioContext | null = null;
  private cycle: { ctx: RingbackAudioContext; buffer: RingbackAudioBuffer } | null = null;
  private playback: Playback | null = null;
  /** Calls that reported early media: the carrier's audio is theirs, never the synthetic tone. */
  private readonly earlyMediaOwners = new WeakSet<object>();

  constructor(private readonly deps: OutboundRingbackDeps) {}

  /**
   * Applies one Voice SDK `ringing(hasEarlyMedia)` signal for `owner`. `true` stops this owner's
   * synthetic tone and marks it early-media for good; `false` starts the synthetic tone unless the
   * owner already had early media. Anything else (not a boolean) changes nothing.
   */
  onRinging(owner: object, hasEarlyMedia: unknown): RingingAudio {
    if (hasEarlyMedia === true) {
      this.earlyMediaOwners.add(owner);
      this.stop(owner);
      return "carrier";
    }
    if (hasEarlyMedia !== false) return "none";
    if (this.earlyMediaOwners.has(owner)) return "carrier";
    return this.start(owner) ? "synthetic" : "none";
  }

  /** Starts the synthetic tone for `owner` (a no-op if it already plays). Never throws. */
  start(owner: object): boolean {
    if (this.playback?.owner === owner) return true;
    if (this.earlyMediaOwners.has(owner)) return false;
    this.stop();   // one tone per page: a previous owner's tone never overlaps this one
    let source: RingbackBufferSource | null = null;
    let gain: RingbackGainNode | null = null;
    try {
      const ctx = this.context();
      if (!ctx) return false;
      gain = ctx.createGain();
      gain.gain.value = RINGBACK_PEAK_LEVEL;
      gain.connect(ctx.destination);
      source = ctx.createBufferSource();
      source.buffer = this.cycleFor(ctx);
      source.loop = true;
      source.connect(gain);
      source.start();
      this.playback = { owner, source, gain };
      // Always resume: it also overrides a suspend still pending from the previous stop. A context the
      // autoplay policy keeps suspended leaves the tone armed but silent; stop() still works.
      this.resume(ctx);
      return true;
    } catch (e) {
      this.log("synthetic ringback unavailable", { error: e instanceof Error ? e.message : String(e) });
      try { source?.disconnect(); } catch { /* never connected */ }
      try { gain?.disconnect(); } catch { /* never connected */ }
      return false;
    }
  }

  /** Stops the tone: any owner's when `owner` is omitted, otherwise only that owner's. Never throws. */
  stop(owner?: object): void {
    const playback = this.playback;
    if (!playback) return;
    if (owner !== undefined && playback.owner !== owner) return;
    this.playback = null;
    this.release(playback);
  }

  /** True while a tone is armed — for `owner` only when given. */
  isPlaying(owner?: object): boolean {
    if (!this.playback) return false;
    return owner === undefined || this.playback.owner === owner;
  }

  private context(): RingbackAudioContext | null {
    if (this.ctx && this.ctx.state !== "closed") return this.ctx;
    this.ctx = this.deps.createAudioContext();
    return this.ctx;
  }

  private cycleFor(ctx: RingbackAudioContext): RingbackAudioBuffer {
    if (this.cycle?.ctx === ctx) return this.cycle.buffer;
    const samples = renderRingbackCycle(ctx.sampleRate);
    const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buffer.getChannelData(0).set(samples);
    this.cycle = { ctx, buffer };
    return buffer;
  }

  private resume(ctx: RingbackAudioContext): void {
    try {
      void Promise.resolve(ctx.resume()).catch((e: unknown) => {
        this.log("audio context resume blocked", { error: e instanceof Error ? e.message : String(e) });
      });
    } catch (e) {
      this.log("audio context resume failed", { error: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Silences `playback` at once (a 10 ms fade when the context runs), then frees its nodes. */
  private release(playback: Playback): void {
    const { source, gain } = playback;
    let released = false;
    const finish = () => {
      if (released) return;
      released = true;
      try { source.disconnect(); } catch { /* already disconnected */ }
      try { gain.disconnect(); } catch { /* already disconnected */ }
      this.suspendIfIdle();
    };
    const ctx = this.ctx;
    if (ctx && ctx.state === "running") {
      try {
        const now = ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(RINGBACK_PEAK_LEVEL, now);
        gain.gain.linearRampToValueAtTime(0, now + RINGBACK_EDGE_SECONDS);
        source.onended = finish;
        source.stop(now + RINGBACK_EDGE_SECONDS);
        (this.deps.setTimeout ?? setTimeout)(finish, RELEASE_FALLBACK_MS);
        return;
      } catch {
        /* fall through to an immediate stop */
      }
    }
    try { gain.gain.value = 0; } catch { /* ignore */ }
    try { source.stop(); } catch { /* never started or already stopped */ }
    finish();
  }

  /**
   * An idle context is suspended so no audio thread runs between calls; start() resumes it. Also
   * issued when the context still reads "suspended": a resume() from start() may be in flight, and
   * the queued suspend() lands after it instead of leaving the device open.
   */
  private suspendIfIdle(): void {
    const ctx = this.ctx;
    if (!ctx || this.playback || ctx.state === "closed") return;
    try {
      void Promise.resolve(ctx.suspend()).catch(() => { /* resumed or closed meanwhile */ });
    } catch {
      /* ignore */
    }
  }

  private log(message: string, meta?: Record<string, unknown>): void {
    try {
      this.deps.log?.(message, meta);
    } catch {
      /* logging never affects audio */
    }
  }
}

function createBrowserAudioContext(): RingbackAudioContext | null {
  if (typeof window === "undefined") return null;
  const AC =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  return new AC() as unknown as RingbackAudioContext;
}

const outboundRingback = new OutboundRingback({
  createAudioContext: createBrowserAudioContext,
  log: (message, meta) => console.warn(`[outboundRingback] ${message}`, meta ?? {}),
});

/** Routes one outbound Voice SDK `ringing(hasEarlyMedia)` event for the current Call `owner`. */
export function handleOutboundRinging(owner: object, hasEarlyMedia: unknown): RingingAudio {
  return outboundRingback.onRinging(owner, hasEarlyMedia);
}

/** Starts the synthetic ringback for `owner` (idempotent). */
export function startOutboundRingback(owner: object): boolean {
  return outboundRingback.start(owner);
}

/** Stops the synthetic ringback — only `owner`'s when given, any when omitted (idempotent). */
export function stopOutboundRingback(owner?: object): void {
  outboundRingback.stop(owner);
}

export function isOutboundRingbackPlaying(owner?: object): boolean {
  return outboundRingback.isPlaying(owner);
}
