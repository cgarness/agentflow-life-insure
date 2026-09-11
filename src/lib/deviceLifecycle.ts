/**
 * Inbound Calling v2 — the ONE Device lifecycle coordinator (corrective pass, defect 2).
 *
 * Every automatic initialization entry point (eager mount, network-online, unregistered/error
 * recovery, dialer panel open, dialer session start) goes through `requestInit`, which:
 *   - never starts or replaces a Device while a call is ringing, dialing or active (same identity):
 *     the request is DEFERRED and resumed by `onCallEnded()`;
 *   - is single-flight (an overlapping request joins the one in progress);
 *   - treats an identity change as an explicit teardown followed by a fresh generation;
 *   - binds every Device callback to the generation that created it, so a Device that finishes
 *     registering after a logout or identity change is retired and never reported ready.
 * Pure: the SDK wrapper, timers and call state are injected; unit-tested in
 * src/lib/__tests__/deviceLifecycle.test.ts.
 */

export interface LifecycleHandlers<D = unknown> {
  onRegistered(device: D): void;
  onUnregistered(device: D): void;
  onError(err: Error, device: D): void;
  onDeviceChange(device: D, lostActiveDevices: unknown[]): void;
}

export interface DeviceLifecycleDeps<D = unknown> {
  /**
   * Builds + registers a Device; resolves with it once registered; rejects on failure or staleness.
   * `isLive()` reports whether the requesting generation is still current: an init that awaits anything
   * BEFORE reaching the SDK wrapper (mic permission, a token) must re-check it after each await and
   * abandon the work when it is false — the wrapper only stamps its own generation when called.
   */
  init(handlers: LifecycleHandlers<D>, isLive: () => boolean): Promise<D>;
  /** Unregisters and destroys the current Device (idempotent). */
  destroy(): Promise<void>;
  /** Retires a Device that finished late (after a teardown). Optional: the wrapper may already do it. */
  retire?(device: D): void;
  /** true while a call is ringing, dialing or active — recovery must wait. */
  isCallLive(): boolean;
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  log?(message: string, meta?: Record<string, unknown>): void;
}

export interface DeviceLifecycleEvents<D = unknown> {
  onReady(device: D): void;
  onNotReady(reason: "unregistered" | "error" | "teardown" | "init_failed"): void;
  onError(err: Error): void;
  onDeviceChange(device: D, lostActiveDevices: unknown[]): void;
  onDeferred?(reason: string): void;
}

export type InitOutcome =
  | "started"
  | "already_ready"
  | "in_flight"
  | "deferred_live_call"
  | "no_identity"
  /** A newer logout or identity change arrived while this request waited for the previous teardown. */
  | "superseded";

export const LIFECYCLE_RECOVERY_DELAY_MS = 2_000;
export const LIFECYCLE_RECOVERY_MAX_ATTEMPTS = 3;
export const LIFECYCLE_RECOVERY_WINDOW_MS = 60_000;

export class DeviceLifecycle<D = unknown> {
  private gen = 0;
  private identity: string | null = null;
  private ready = false;
  private inFlight: Promise<void> | null = null;
  private deferredReason: string | null = null;
  private recoveryTimer: unknown = null;
  private recoveryAttempts = 0;
  private recoveryWindowStart = 0;
  private device: D | null = null;
  /** Bumped by every request and by every external teardown: a request that resumes after awaiting a
   *  teardown compares its own sequence number and stands down when something newer superseded it. */
  private requestSeq = 0;
  /** The teardown in progress (destruction is genuinely asynchronous); requests wait for it. */
  private tearingDown: Promise<void> | null = null;

  constructor(
    private readonly deps: DeviceLifecycleDeps<D>,
    private readonly events: DeviceLifecycleEvents<D>,
  ) {}

  snapshot() {
    return {
      generation: this.gen,
      identity: this.identity,
      ready: this.ready,
      inFlight: this.inFlight !== null,
      deferredReason: this.deferredReason,
      recoveryAttempts: this.recoveryAttempts,
    };
  }

  isReady(): boolean {
    return this.ready;
  }

  currentDevice(): D | null {
    return this.device;
  }

  /**
   * The single entry point for every initialization request. `identity` is the operator+organization
   * key; a different identity than the current one is an explicit change (teardown first).
   */
  async requestInit(identity: string | null, reason: string): Promise<InitOutcome> {
    if (!identity) return "no_identity";
    const seq = ++this.requestSeq;
    if (this.identity && this.identity !== identity) {
      // The requested identity is the intended one from now on; the previous generation is torn down
      // first. Destruction can take a while — see the sequence check after the await.
      this.identity = identity;
      void this.startTeardown("identity_change");
    }
    if (this.tearingDown) {
      await this.tearingDown;
      if (seq !== this.requestSeq) {
        // A logout or a newer identity arrived while this request waited: it must not resume.
        this.deps.log?.("device init request superseded while waiting for teardown", { reason, identity });
        return "superseded";
      }
    }
    this.identity = identity;
    if (this.ready) return "already_ready";
    if (this.deps.isCallLive()) {
      // Same-identity recovery must never interrupt a ringing, dialing or active call.
      this.deferredReason = reason;
      this.events.onDeferred?.(reason);
      this.deps.log?.("device init deferred until the call ends", { reason });
      return "deferred_live_call";
    }
    if (this.inFlight) return "in_flight";
    const gen = ++this.gen;
    this.deferredReason = null;
    const run = this.run(gen, reason);
    this.inFlight = run;
    void run.finally(() => {
      if (this.inFlight === run) this.inFlight = null;
    });
    return "started";
  }

  /**
   * Explicit teardown (logout, identity change, unmount). Invalidates every pending init, every older
   * callback AND every request still waiting for a previous teardown (`requestSeq`).
   */
  async teardown(reason: "logout" | "identity_change" | "unmount"): Promise<void> {
    this.requestSeq += 1;
    await this.startTeardown(reason);
  }

  private startTeardown(reason: "logout" | "identity_change" | "unmount"): Promise<void> {
    const t: Promise<void> = this.teardownInternal(reason).finally(() => {
      // Only the LAST teardown clears the marker: an older one finishing late must not unblock requests
      // that are waiting for a newer teardown still in progress.
      if (this.tearingDown === t) this.tearingDown = null;
    });
    this.tearingDown = t;
    return t;
  }

  private async teardownInternal(reason: "logout" | "identity_change" | "unmount"): Promise<void> {
    this.gen += 1;
    this.ready = false;
    this.inFlight = null;
    this.deferredReason = null;
    this.device = null;
    this.clearRecoveryTimer();
    this.recoveryAttempts = 0;
    if (reason !== "identity_change") this.identity = null;
    this.events.onNotReady("teardown");
    await this.deps.destroy();
  }

  /** The provider reports the call state returned to idle: a deferred recovery resumes now. */
  onCallEnded(): void {
    if (!this.deferredReason || !this.identity || this.ready || this.inFlight) return;
    const reason = this.deferredReason;
    this.deferredReason = null;
    void this.requestInit(this.identity, `deferred:${reason}`);
  }

  /** Bounded recovery after `unregistered` / `error`; the timer itself defers while a call is live. */
  scheduleRecovery(reason: string): void {
    if (this.recoveryTimer !== null || !this.identity) return;
    const now = this.deps.now();
    if (now - this.recoveryWindowStart > LIFECYCLE_RECOVERY_WINDOW_MS) {
      this.recoveryWindowStart = now;
      this.recoveryAttempts = 0;
    }
    if (this.recoveryAttempts >= LIFECYCLE_RECOVERY_MAX_ATTEMPTS) {
      this.deps.log?.("device recovery attempts exhausted for this window", { reason });
      return;
    }
    const gen = this.gen;
    this.recoveryTimer = this.deps.setTimeout(() => {
      this.recoveryTimer = null;
      if (gen !== this.gen && !this.identity) return;   // torn down meanwhile
      if (this.ready || this.inFlight || !this.identity) return;
      this.recoveryAttempts += 1;
      void this.requestInit(this.identity, `recovery:${reason}`);
    }, LIFECYCLE_RECOVERY_DELAY_MS);
  }

  private clearRecoveryTimer(): void {
    if (this.recoveryTimer !== null) {
      this.deps.clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
  }

  private async run(gen: number, reason: string): Promise<void> {
    const live = () => gen === this.gen;
    const handlers: LifecycleHandlers<D> = {
      onRegistered: (device) => {
        if (!live()) { this.deps.retire?.(device); return; }
        this.device = device;
        this.ready = true;
        // recoveryAttempts is deliberately NOT reset here: a flapping socket (register → unregister
        // loops) stays bounded to LIFECYCLE_RECOVERY_MAX_ATTEMPTS per window; the window resets it.
        this.events.onReady(device);
      },
      // The wrapper forwards events only for ITS current Device, so any event that reaches a live
      // generation concerns the Device this generation owns — including a replacement Device that
      // errors before it registers (this.device still names the previous one until `registered`).
      onUnregistered: (device) => {
        if (!live()) return;
        this.device = device;
        this.ready = false;
        this.events.onNotReady("unregistered");
        this.scheduleRecovery("unregistered");
      },
      onError: (err, device) => {
        if (!live()) return;
        this.device = device;
        this.ready = false;
        this.events.onError(err);
        this.events.onNotReady("error");
        this.scheduleRecovery("error");
      },
      onDeviceChange: (device, lost) => {
        if (!live()) return;
        this.events.onDeviceChange(device, lost);
      },
    };
    this.deps.log?.("device init starting", { reason, generation: gen });
    try {
      const device = await this.deps.init(handlers, live);
      if (!live()) {
        // Finished after a teardown / identity change: retire it, never report ready — unless a newer
        // generation already owns this very Device (a shared wrapper attempt), which is never retired.
        if (device !== this.device) this.deps.retire?.(device);
        return;
      }
      if (!this.ready) {
        // Defensive: the wrapper resolved without the registered callback (it should not).
        this.device = device;
        this.ready = true;
        this.events.onReady(device);
      }
    } catch (err) {
      if (!live()) return;   // stale rejection (TwilioInitStaleError or an abandoned attempt)
      this.ready = false;
      this.events.onError(err instanceof Error ? err : new Error(String(err)));
      this.events.onNotReady("init_failed");
      // A transient token-fetch / registration failure recovers by ITSELF (bounded, idle-only): the agent
      // must not have to open the dialer, switch tabs, reload or wait for a network event. A recovery
      // attempt that fails again lands here as well and schedules the next one until the window's cap.
      this.scheduleRecovery("init_failed");
    }
  }
}
