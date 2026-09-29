/**
 * A recording fake of the Web Audio surface `src/lib/outboundRingback.ts` uses. Every buffer source
 * the code creates is kept, so a test can count exactly how many ringback loops are audible: a source
 * is AUDIBLE from `start()` until `stop()` and connected to the output until `disconnect()`.
 */
import type {
  RingbackAudioBuffer,
  RingbackAudioContext,
  RingbackAudioParam,
  RingbackBufferSource,
  RingbackGainNode,
} from "@/lib/outboundRingback";

export class FakeParam implements RingbackAudioParam {
  value = 1;
  readonly events: Array<[string, number, number?]> = [];
  setValueAtTime(value: number, time: number) { this.events.push(["set", value, time]); this.value = value; }
  linearRampToValueAtTime(value: number, time: number) { this.events.push(["ramp", value, time]); }
  cancelScheduledValues(time: number) { this.events.push(["cancel", time]); }
}

export class FakeGain implements RingbackGainNode {
  gain = new FakeParam();
  connectedTo: unknown = null;
  disconnected = false;
  connect(dest: unknown) { this.connectedTo = dest; return dest; }
  disconnect() { this.disconnected = true; }
}

export class FakeBuffer implements RingbackAudioBuffer {
  readonly data: Float32Array;
  constructor(readonly length: number, readonly sampleRate: number) { this.data = new Float32Array(length); }
  getChannelData() { return this.data; }
}

export class FakeSource implements RingbackBufferSource {
  buffer: RingbackAudioBuffer | null = null;
  loop = false;
  onended: (() => void) | null = null;
  connectedTo: unknown = null;
  started = false;
  stopped = false;
  stopAt: number | undefined;
  disconnected = false;
  constructor(private readonly ctx: FakeAudioContext) {}
  connect(dest: unknown) { this.connectedTo = dest; return dest; }
  disconnect() { this.disconnected = true; }
  start() {
    if (this.started) throw new Error("InvalidStateError: start() called twice");
    this.started = true;
  }
  stop(when?: number) {
    if (!this.started) throw new Error("InvalidStateError: stop() before start()");
    this.stopped = true;
    this.stopAt = when;
    // A running context reaches the stop time and fires `ended` (async, like the browser).
    if (this.ctx.state === "running" && this.ctx.autoEnded) queueMicrotask(() => this.onended?.());
  }
  /** Audible = started and not yet stopped. */
  get audible() { return this.started && !this.stopped; }
}

export interface FakeAudioOptions {
  initialState?: "running" | "suspended";
  /** Resume outcome: "run" (default), "reject" (autoplay policy), "pending" (never settles). */
  resume?: "run" | "reject" | "pending";
  sampleRate?: number;
  /** When false, `stop()` never fires `ended` (exercises the release fallback). */
  autoEnded?: boolean;
  failCreateBufferSource?: boolean;
}

export class FakeAudioContext implements RingbackAudioContext {
  state: string;
  currentTime = 0;
  readonly sampleRate: number;
  readonly destination = { kind: "destination" };
  readonly sources: FakeSource[] = [];
  readonly gains: FakeGain[] = [];
  readonly buffers: FakeBuffer[] = [];
  resumeCalls = 0;
  suspendCalls = 0;
  readonly autoEnded: boolean;
  constructor(private readonly opts: FakeAudioOptions = {}) {
    this.state = opts.initialState ?? "running";
    this.sampleRate = opts.sampleRate ?? 8000;
    this.autoEnded = opts.autoEnded ?? true;
  }
  resume(): Promise<void> {
    this.resumeCalls += 1;
    const mode = this.opts.resume ?? "run";
    if (mode === "reject") return Promise.reject(new Error("NotAllowedError: autoplay policy"));
    if (mode === "pending") return new Promise<void>(() => {});
    this.state = "running";
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.suspendCalls += 1;
    this.state = "suspended";
    return Promise.resolve();
  }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    const b = new FakeBuffer(length, sampleRate);
    this.buffers.push(b);
    return b;
  }
  createBufferSource() {
    if (this.opts.failCreateBufferSource) throw new Error("createBufferSource failed");
    const s = new FakeSource(this);
    this.sources.push(s);
    return s;
  }
  createGain() {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  /** Loops audible right now (the invariant under test: never more than one). */
  audibleCount() { return this.sources.filter((s) => s.audible).length; }
}
