/**
 * Request discipline for organization standings and the Recent Wins feed.
 *
 * The leaderboard once polled its aggregate RPC every 4 s per tab, refreshed on
 * nearly every realtime INSERT (hidden tabs included), let slow requests pile up
 * and never backed off — enough load to slow the whole app (2026-09-23 incident).
 * Every standings / Recent Wins read now goes through one gate per viewer: one
 * request in flight, identical requests shared, at most one queued request per
 * channel, spacing that stretches with slow responses, per-endpoint backoff and a
 * long hold on the server's PT503 maintenance answer. The gate keeps scheduling
 * metadata only — never rows — so nothing can cross accounts or organizations.
 */

import { isPageActive } from "@/lib/pageActivity";

export type LeaderboardEndpoint = "org_standings" | "group_standings" | "wins";
export type LeaderboardChannel = "standings" | "wins";
/** initial = mount / filter change; auto = poll, realtime, focus, retry timer; manual = a person asked. */
export type LeaderboardRunMode = "initial" | "auto" | "manual";
export type LeaderboardFailureKind = "maintenance" | "busy" | "timeout" | "error";

export interface LeaderboardLoadError {
  code?: string | null;
  message?: string | null;
}

export interface LeaderboardLoadResult<T> {
  data: T | null;
  error: LeaderboardLoadError | null;
}

export type LeaderboardRunResult<T> =
  | { status: "ok"; data: T }
  | { status: "failed"; kind: LeaderboardFailureKind; retryAt: number }
  /** The endpoint is in backoff / maintenance: nothing was sent. */
  | { status: "blocked"; reason: "cooldown"; kind: LeaderboardFailureKind; retryAt: number }
  /** Too soon after the previous request: nothing was sent; the status is unchanged. */
  | { status: "blocked"; reason: "throttled"; availableAt: number }
  /** The tab is hidden or offline: nothing was sent; load again when it is visible and online. */
  | { status: "blocked"; reason: "inactive" }
  /** Replaced by newer work, released by its owner, or the gate was disposed. */
  | { status: "superseded" };

export interface LeaderboardRunRequest<T> {
  endpoint: LeaderboardEndpoint;
  channel: LeaderboardChannel;
  /** Consumer + endpoint + view + group + period START (never the moving end bound). */
  key: string;
  mode: LeaderboardRunMode;
  /** Released with {@link LeaderboardRequestGate.release} when the consumer unmounts or changes context. */
  owner: object;
  /** Do not join an in-flight request that started before this time (e.g. a realtime event's arrival). */
  notBefore?: number;
  load: (signal: AbortSignal) => PromiseLike<LeaderboardLoadResult<T>>;
}

export const LEADERBOARD_POLL_DEFAULT_MS = 30_000;
export const LEADERBOARD_POLL_MAX_MS = 300_000;
export const LEADERBOARD_AUTO_MIN_GAP_MS = 15_000;
export const LEADERBOARD_MANUAL_MIN_GAP_MS = 30_000;
export const LEADERBOARD_REQUEST_TIMEOUT_MS = 25_000;
const MAINTENANCE_HOLD_MS = 300_000;
const MAX_IDLE_GATES = 4;
/** Order in which a queued job's joiner modes are tried when it starts. */
const START_ORDER: LeaderboardRunMode[] = ["initial", "manual", "auto"];
const TIMED_OUT = Symbol("leaderboard-request-timeout");

export function classifyLeaderboardFailure(error: LeaderboardLoadError | null): LeaderboardFailureKind {
  if (error?.code === "PT503") return "maintenance";
  if (error?.code === "PT429") return "busy";
  return "error";
}

/** Next retry delay; jitter spreads many tabs apart when maintenance ends. */
export function leaderboardRetryDelayMs(
  kind: LeaderboardFailureKind,
  consecutiveFailures: number,
  random: () => number = Math.random,
): number {
  const jitter = (spread: number) => 1 + (random() * 2 - 1) * spread;
  if (kind === "maintenance") return Math.round(MAINTENANCE_HOLD_MS * jitter(0.1));
  const step = 2 ** (Math.max(1, consecutiveFailures) - 1);
  const base = kind === "busy" ? Math.min(120_000, 15_000 * step) : Math.min(300_000, 30_000 * step);
  return Math.round(base * jitter(0.2));
}

/** The legacy 4 s value and anything invalid fall back to 30 s; the ceiling is 5 min. */
export function resolveLeaderboardPollMs(raw: unknown): number {
  const ms = Number(raw);
  if (!Number.isFinite(ms) || ms < LEADERBOARD_POLL_DEFAULT_MS) return LEADERBOARD_POLL_DEFAULT_MS;
  return Math.min(ms, LEADERBOARD_POLL_MAX_MS);
}

/** Requests are sent only from a visible, online tab. */
export function canAutoRefreshLeaderboard(): boolean {
  return isPageActive();
}

type EndpointState = {
  failures: number;
  blockedUntil: number;
  kind: LeaderboardFailureKind | null;
  lastStartedAt: number | null;
  lastSettledAt: number | null;
  lastDurationMs: number;
};

type Job = {
  request: LeaderboardRunRequest<unknown>;
  /** Every joiner's mode: the job runs if ANY of them is allowed when it starts. */
  modes: Set<LeaderboardRunMode>;
  owners: Set<object>;
  startedAt: number | null;
  promise: Promise<LeaderboardRunResult<unknown>>;
  resolve: (result: LeaderboardRunResult<unknown>) => void;
};

export class LeaderboardRequestGate {
  private inFlight: Job | null = null;
  private controller: AbortController | null = null;
  private readonly queued = new Map<LeaderboardChannel, Job>();
  private readonly endpoints = new Map<LeaderboardEndpoint, EndpointState>();
  private disposed = false;

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly random: () => number = Math.random,
  ) {}

  get busy(): boolean {
    return this.inFlight !== null || this.queued.size > 0;
  }

  /** Active backoff / maintenance hold for an endpoint, if any. */
  cooldown(endpoint: LeaderboardEndpoint): { kind: LeaderboardFailureKind; until: number } | null {
    const s = this.state(endpoint);
    return s.kind && this.now() < s.blockedUntil ? { kind: s.kind, until: s.blockedUntil } : null;
  }

  /** Earliest automatic start: 15 s after any start, and longer after slow responses. */
  autoAvailableAt(endpoint: LeaderboardEndpoint): number {
    const s = this.state(endpoint);
    const afterStart = (s.lastStartedAt ?? -Infinity) + LEADERBOARD_AUTO_MIN_GAP_MS;
    const afterSettle =
      (s.lastSettledAt ?? -Infinity) + Math.max(LEADERBOARD_AUTO_MIN_GAP_MS, 2 * s.lastDurationMs);
    return Math.max(afterStart, afterSettle, s.kind ? s.blockedUntil : -Infinity);
  }

  /**
   * Earliest manual start: 30 s after the last request started, 15 s after it
   * returned (so a click never overlaps a timed-out query the server may still be
   * running), and never inside a maintenance / busy hold — the server's own hint
   * is "Avoid repeated retries".
   */
  manualAvailableAt(endpoint: LeaderboardEndpoint): number {
    const s = this.state(endpoint);
    return Math.max(
      this.now(),
      (s.lastStartedAt ?? -Infinity) + LEADERBOARD_MANUAL_MIN_GAP_MS,
      (s.lastSettledAt ?? -Infinity) + LEADERBOARD_AUTO_MIN_GAP_MS,
      this.serverHold(endpoint)?.until ?? -Infinity,
    );
  }

  /** A maintenance / busy hold: the server asked clients not to retry sooner. */
  private serverHold(endpoint: LeaderboardEndpoint) {
    const hold = this.cooldown(endpoint);
    return hold && (hold.kind === "maintenance" || hold.kind === "busy") ? hold : null;
  }

  run<T>(request: LeaderboardRunRequest<T>): Promise<LeaderboardRunResult<T>> {
    if (this.disposed) return Promise.resolve({ status: "superseded" });
    const queued = this.queued.get(request.channel);
    const inFlight = this.inFlight;
    if (
      inFlight?.request.key === request.key &&
      (request.notBefore === undefined || (inFlight.startedAt ?? 0) >= request.notBefore)
    ) {
      inFlight.owners.add(request.owner);
      // The owner came back to what is already running (e.g. Today → Week → Today):
      // its queued detour is abandoned and must never reach the network.
      this.dropQueued(request.owner, request.channel, request.key);
      return inFlight.promise as Promise<LeaderboardRunResult<T>>;
    }
    if (queued?.request.key === request.key) {
      queued.owners.add(request.owner);
      // Joining never makes a queued job stricter (a manual joiner must not turn
      // an accepted filter switch into one refused by the manual spacing rule).
      queued.modes.add(request.mode);
      return queued.promise as Promise<LeaderboardRunResult<T>>;
    }
    const refusal = this.refusal(request.endpoint, request.mode);
    if (refusal) return Promise.resolve(refusal);

    let resolve!: Job["resolve"];
    const promise = new Promise<LeaderboardRunResult<unknown>>((r) => (resolve = r));
    const job: Job = {
      request: request as LeaderboardRunRequest<unknown>,
      modes: new Set([request.mode]),
      owners: new Set([request.owner]),
      startedAt: null,
      promise,
      resolve,
    };
    if (this.inFlight) {
      queued?.resolve({ status: "superseded" });
      this.queued.set(request.channel, job);
    } else {
      void this.start(job);
    }
    return promise as Promise<LeaderboardRunResult<T>>;
  }

  /** Drops a queued job on `channel` that only `owner` wants and that is not `keepKey`. */
  private dropQueued(owner: object, channel: LeaderboardChannel, keepKey: string): void {
    const job = this.queued.get(channel);
    if (!job || job.request.key === keepKey || job.owners.size !== 1 || !job.owners.has(owner)) return;
    this.queued.delete(channel);
    job.resolve({ status: "superseded" });
  }

  /** A consumer went away: its not-yet-started work is dropped without a network call. */
  release(owner: object): void {
    for (const [channel, job] of this.queued) {
      job.owners.delete(owner);
      if (job.owners.size === 0) {
        this.queued.delete(channel);
        job.resolve({ status: "superseded" });
      }
    }
    this.inFlight?.owners.delete(owner);
  }

  /** Drop queued work, abort the in-flight request and refuse new runs. */
  dispose(): void {
    this.disposed = true;
    for (const job of this.queued.values()) job.resolve({ status: "superseded" });
    this.queued.clear();
    this.controller?.abort();
  }

  private state(endpoint: LeaderboardEndpoint): EndpointState {
    let s = this.endpoints.get(endpoint);
    if (!s) {
      s = { failures: 0, blockedUntil: 0, kind: null, lastStartedAt: null, lastSettledAt: null, lastDurationMs: 0 };
      this.endpoints.set(endpoint, s);
    }
    return s;
  }

  /** Checked when a run is requested AND again right before a queued run starts. */
  private refusal(endpoint: LeaderboardEndpoint, mode: LeaderboardRunMode): LeaderboardRunResult<never> | null {
    // Every mode: a hidden or offline tab sends nothing, queued work included.
    if (!isPageActive()) return { status: "blocked", reason: "inactive" };
    const now = this.now();
    if (mode === "manual") {
      const serverHold = this.serverHold(endpoint);
      if (serverHold) {
        return { status: "blocked", reason: "cooldown", kind: serverHold.kind, retryAt: serverHold.until };
      }
      const availableAt = this.manualAvailableAt(endpoint);
      return now < availableAt ? { status: "blocked", reason: "throttled", availableAt } : null;
    }
    const hold = this.cooldown(endpoint);
    if (hold) return { status: "blocked", reason: "cooldown", kind: hold.kind, retryAt: hold.until };
    if (mode === "auto") {
      const availableAt = this.autoAvailableAt(endpoint);
      if (now < availableAt) return { status: "blocked", reason: "throttled", availableAt };
    }
    return null;
  }

  /** Checked again right before a queued job starts: it runs if any joiner's mode is allowed. */
  private startRefusal(job: Job): LeaderboardRunResult<never> | null {
    let first: LeaderboardRunResult<never> | null = null;
    for (const mode of START_ORDER) {
      if (!job.modes.has(mode)) continue;
      const refusal = this.refusal(job.request.endpoint, mode);
      if (!refusal) return null;
      first ??= refusal;
    }
    return first;
  }

  private async start(job: Job): Promise<void> {
    const refusal = this.startRefusal(job);
    if (refusal) {
      job.resolve(refusal);
      this.next();
      return;
    }
    const s = this.state(job.request.endpoint);
    const controller = new AbortController();
    const startedAt = this.now();
    this.inFlight = job;
    this.controller = controller;
    job.startedAt = startedAt;
    s.lastStartedAt = startedAt;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<typeof TIMED_OUT>((r) => {
      timer = setTimeout(() => r(TIMED_OUT), LEADERBOARD_REQUEST_TIMEOUT_MS);
    });
    let result: LeaderboardRunResult<unknown>;
    try {
      // The race frees the lane at the timeout even if the load never settles.
      const response = await Promise.race([
        Promise.resolve().then(() => job.request.load(controller.signal)),
        timeout,
      ]);
      if (response === TIMED_OUT) {
        controller.abort();
        result = this.fail(s, "timeout");
      } else if (response?.error || response?.data == null) {
        result = this.fail(s, classifyLeaderboardFailure(response?.error ?? null));
      } else {
        s.failures = 0;
        s.blockedUntil = 0;
        s.kind = null;
        result = { status: "ok", data: response.data };
      }
    } catch {
      result = this.fail(s, "error");
    } finally {
      clearTimeout(timer);
    }
    s.lastSettledAt = this.now();
    s.lastDurationMs = s.lastSettledAt - startedAt;
    if (this.controller === controller) this.controller = null;
    this.inFlight = null;
    job.resolve(this.disposed ? { status: "superseded" } : result);
    this.next();
  }

  private fail(s: EndpointState, kind: LeaderboardFailureKind): LeaderboardRunResult<never> {
    s.failures = Math.min(s.failures + 1, 10);
    s.kind = kind;
    s.blockedUntil = this.now() + leaderboardRetryDelayMs(kind, s.failures, this.random);
    return { status: "failed", kind, retryAt: s.blockedUntil };
  }

  private next(): void {
    if (this.disposed || this.inFlight) return;
    for (const channel of ["standings", "wins"] as const) {
      const job = this.queued.get(channel);
      if (!job) continue;
      this.queued.delete(channel);
      void this.start(job);
      return;
    }
  }
}

const gates = new Map<string, LeaderboardRequestGate>();

/**
 * The gate for one viewer (`${authUserId}:${organizationId}`), shared by the
 * Leaderboard page, TV mode and the Dashboard widget so a maintenance hold or
 * backoff survives navigation. Only idle gates are ever evicted.
 */
export function getLeaderboardRequestGate(identity: string): LeaderboardRequestGate {
  const gate = gates.get(identity) ?? new LeaderboardRequestGate();
  gates.delete(identity);
  gates.set(identity, gate);
  for (const [key, stale] of gates) {
    if (gates.size <= MAX_IDLE_GATES) break;
    if (key === identity || stale.busy) continue;
    stale.dispose();
    gates.delete(key);
  }
  return gate;
}

/** Tests only: abort and forget every viewer's scheduling state. */
export function resetLeaderboardRequestGates(): void {
  for (const gate of gates.values()) gate.dispose();
  gates.clear();
}
