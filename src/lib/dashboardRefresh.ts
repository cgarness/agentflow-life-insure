import { isPageActive } from "@/lib/pageActivity";

/**
 * Request discipline for the Dashboard's sections (stat cards and widgets).
 *
 * The Dashboard has no automatic refresh: sections load when they mount (or
 * their user / perspective / period changes) and when someone presses Refresh.
 * Each section has ONE lane per viewer: one load on the wire, identical requests
 * share it (a Refresh, a remount or a repeated signal never starts a second
 * load), a different scope waits for the running load to settle instead of
 * overlapping it, and nothing is sent while the tab is hidden or offline — the
 * activity check runs right before every dispatch, queued work included. A lane
 * holds scheduling metadata and one promise; it never caches rows.
 */

export type DashboardSectionKey =
  | "stats"
  | "callbacks"
  | "appointments"
  | "goal_progress"
  | "leaderboard"
  | "missed_calls"
  | "anniversaries";

/** A dispatched load is aborted after this long (same bound as the leaderboard gate). */
export const DASHBOARD_SECTION_TIMEOUT_MS = 25_000;
/** The Refresh control waits at most this long for the work it started. */
export const DASHBOARD_REFRESH_WAIT_MS = 20_000;
const MAX_IDLE_LANES = 32;

/** What one section did with one Refresh. */
export type DashboardSectionOutcome =
  /** Work ran (or was already running and was joined) and succeeded. */
  | { status: "ok" }
  /** Work ran and failed; same-selection data stays on screen. */
  | { status: "failed" }
  /** Nothing was sent: the section is spaced or held (the leaderboard gate) until `until`. */
  | { status: "deferred"; until: number | null }
  /** Nothing was sent: the tab is hidden or offline; it loads when visible and online. */
  | { status: "inactive" }
  /** Replaced by newer work, or the section went away. */
  | { status: "superseded" }
  /** Nothing to load (no viewer yet). */
  | { status: "skipped" };

/**
 * A section load's failure. `fallback`, when given, is shown only if nothing for
 * the scope is on screen yet (the stat cards' first-load behaviour).
 */
export class DashboardSectionError<T = unknown> extends Error {
  readonly fallback: { data: T } | null;

  constructor(message: string, fallback?: { data: T }, cause?: unknown) {
    super(message);
    this.name = "DashboardSectionError";
    this.fallback = fallback ?? null;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

export type DashboardSectionRunResult<T> =
  | { status: "ok"; data: T }
  /** Failed, or passed its bound (then reported at the bound, even if it never settles). */
  | { status: "failed"; fallback: { data: T } | null }
  /** Nothing was sent: an earlier load past its bound still holds the lane. */
  | { status: "busy" }
  | { status: "inactive" }
  | { status: "superseded" };

type Job = {
  scope: string;
  load: (signal: AbortSignal) => Promise<unknown>;
  owners: Set<object>;
  controller: AbortController | null;
  /** Aborted because every owner moved on: it ends as superseded, never as a failure. */
  abandoned: boolean;
  /** Past DASHBOARD_SECTION_TIMEOUT_MS: already reported as failed, still holding the lane. */
  timedOut: boolean;
  promise: Promise<DashboardSectionRunResult<unknown>>;
  resolve: (result: DashboardSectionRunResult<unknown>) => void;
};

export class DashboardSectionLane {
  private inFlight: Job | null = null;
  private queued: Job | null = null;
  private disposed = false;

  get busy(): boolean {
    return this.inFlight !== null || this.queued !== null;
  }

  run<T>(scope: string, owner: object, load: (signal: AbortSignal) => Promise<T>): Promise<DashboardSectionRunResult<T>> {
    if (this.disposed) return Promise.resolve({ status: "superseded" });
    const inFlight = this.inFlight;
    // A load past its bound still holds the lane (it ignored the abort): nothing
    // else is sent until it settles, and nobody waits on it again.
    if (inFlight?.timedOut) return Promise.resolve({ status: "busy" });
    // An abandoned (aborted) load is never joined: its answer is a cancellation,
    // not this scope's data. A fresh job waits for it instead.
    if (inFlight?.scope === scope && !inFlight.abandoned) {
      inFlight.owners.add(owner);
      // Back to what is already running: a queued detour of this owner is abandoned unsent.
      if (this.queued && this.queued.owners.size === 1 && this.queued.owners.has(owner)) {
        this.queued.resolve({ status: "superseded" });
        this.queued = null;
      }
      return inFlight.promise as Promise<DashboardSectionRunResult<T>>;
    }
    if (this.queued?.scope === scope) {
      this.queued.owners.add(owner);
      return this.queued.promise as Promise<DashboardSectionRunResult<T>>;
    }

    let resolve!: Job["resolve"];
    const promise = new Promise<DashboardSectionRunResult<unknown>>((r) => (resolve = r));
    const job: Job = {
      scope,
      load,
      owners: new Set([owner]),
      controller: null,
      abandoned: false,
      timedOut: false,
      promise,
      resolve,
    };
    if (inFlight) {
      // Another scope is on the wire (or an abandoned load of this one). This owner
      // no longer wants it: abort it when nobody else does (it settles at once if
      // the load honours the signal). The new job starts only after it settles —
      // never alongside it.
      inFlight.owners.delete(owner);
      if (inFlight.owners.size === 0 && !inFlight.abandoned) {
        inFlight.abandoned = true;
        inFlight.controller?.abort();
      }
      this.queued?.resolve({ status: "superseded" });
      this.queued = job;
    } else {
      this.start(job);
    }
    return promise as Promise<DashboardSectionRunResult<T>>;
  }

  /**
   * A consumer went away: its queued work is dropped unsent. A load on the wire
   * runs to its bound, so an immediate remount (edit-mode toggle) joins it
   * instead of sending a second request.
   */
  release(owner: object): void {
    if (this.queued) {
      this.queued.owners.delete(owner);
      if (this.queued.owners.size === 0) {
        this.queued.resolve({ status: "superseded" });
        this.queued = null;
      }
    }
    this.inFlight?.owners.delete(owner);
  }

  /** Tests only: drop queued work and abort the load on the wire. */
  dispose(): void {
    this.disposed = true;
    this.queued?.resolve({ status: "superseded" });
    this.queued = null;
    this.inFlight?.controller?.abort();
  }

  private start(job: Job): void {
    // Re-checked right before every dispatch, queued work included.
    if (!isPageActive()) {
      job.resolve({ status: "inactive" });
      return;
    }
    const controller = new AbortController();
    job.controller = controller;
    this.inFlight = job;
    const timer = setTimeout(() => {
      // Bounded: whoever waits learns now that it failed; the lane stays occupied
      // until the load really settles (a late answer is discarded). Work queued
      // behind it could not start before then, so it is refused rather than left waiting.
      job.timedOut = true;
      controller.abort();
      job.resolve({ status: "failed", fallback: null });
      this.queued?.resolve({ status: "busy" });
      this.queued = null;
    }, DASHBOARD_SECTION_TIMEOUT_MS);
    void Promise.resolve()
      .then(() => job.load(controller.signal))
      .then(
        (data): DashboardSectionRunResult<unknown> => ({ status: "ok", data }),
        (error: unknown): DashboardSectionRunResult<unknown> => ({
          status: "failed",
          fallback: error instanceof DashboardSectionError ? error.fallback : null,
        }),
      )
      .then((result) => {
        // The lane is freed only when the load really settles: a load that ignores
        // the abort keeps it, and later requests join it rather than overlap it.
        clearTimeout(timer);
        this.inFlight = null;
        // No-op after the bound (already reported). An abandoned load was cancelled
        // on purpose: superseded, never "failed".
        job.resolve(this.disposed || job.abandoned ? { status: "superseded" } : result);
        this.next();
      });
  }

  private next(): void {
    if (this.disposed || this.inFlight || !this.queued) return;
    const job = this.queued;
    this.queued = null;
    this.start(job);
  }
}

const lanes = new Map<string, DashboardSectionLane>();

/** The lane for one viewer's section (`${userId}|${section}`); only idle lanes are evicted. */
export function getDashboardSectionLane(key: string): DashboardSectionLane {
  const lane = lanes.get(key) ?? new DashboardSectionLane();
  lanes.delete(key);
  lanes.set(key, lane);
  for (const [other, stale] of lanes) {
    if (lanes.size <= MAX_IDLE_LANES) break;
    if (other === key || stale.busy) continue;
    lanes.delete(other);
  }
  return lane;
}

/** Tests only: abort and forget every lane. */
export function resetDashboardSectionLanes(): void {
  for (const lane of lanes.values()) lane.dispose();
  lanes.clear();
}

export interface DashboardRefreshSummary {
  outcomes: Partial<Record<DashboardSectionKey, DashboardSectionOutcome>>;
  /** Sections whose work was still running (or that never reported) when the wait ended. */
  pending: DashboardSectionKey[];
}

/** Boxed so awaiting the report does not also await the work it carries. */
type Report = { work: Promise<DashboardSectionOutcome> };

type Slot = {
  promise: Promise<Report>;
  resolve: (report: Report) => void;
  reported: boolean;
};

/**
 * Collects, for each Refresh, the work every section actually started (or
 * joined), so the Refresh control can wait for it — bounded, never forever.
 * A section that sent nothing (spaced, held, offline) reports at once.
 */
export class DashboardRefreshTracker {
  private readonly slots = new Map<string, Slot>();
  private readonly mounted = new Map<DashboardSectionKey, number>();
  private latest = 0;

  /**
   * A section on screen. A Refresh waits only for sections registered when it is
   * pressed; one that unmounts meanwhile counts as skipped (never a 20 s wait).
   */
  register(section: DashboardSectionKey): () => void {
    this.mounted.set(section, (this.mounted.get(section) ?? 0) + 1);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const left = (this.mounted.get(section) ?? 1) - 1;
      if (left > 0) {
        this.mounted.set(section, left);
        return;
      }
      this.mounted.delete(section);
      if (this.latest > 0) this.report(this.latest, section, Promise.resolve({ status: "skipped" }));
    };
  }

  /** The sections a Refresh pressed now would wait for. */
  mountedSections(): DashboardSectionKey[] {
    return [...this.mounted.keys()];
  }

  report(signal: number, section: DashboardSectionKey, work: Promise<DashboardSectionOutcome>): void {
    const slot = this.slot(signal, section);
    if (slot.reported) return;
    slot.reported = true;
    slot.resolve({ work });
  }

  async wait(
    signal: number,
    sections: DashboardSectionKey[] = this.mountedSections(),
    timeoutMs: number = DASHBOARD_REFRESH_WAIT_MS,
  ): Promise<DashboardRefreshSummary> {
    const outcomes: DashboardRefreshSummary["outcomes"] = {};
    const settled = sections.map(async (section) => {
      const { work } = await this.slot(signal, section).promise;
      outcomes[section] = await work.catch((): DashboardSectionOutcome => ({ status: "failed" }));
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    await Promise.race([Promise.all(settled), deadline]);
    clearTimeout(timer);
    return { outcomes: { ...outcomes }, pending: sections.filter((s) => !(s in outcomes)) };
  }

  private slot(signal: number, section: DashboardSectionKey): Slot {
    if (signal > this.latest) {
      this.latest = signal;
      for (const key of this.slots.keys()) {
        if (Number(key.split("|")[0]) < signal - 1) this.slots.delete(key);
      }
    }
    const key = `${signal}|${section}`;
    let slot = this.slots.get(key);
    if (!slot) {
      let resolve!: Slot["resolve"];
      const promise = new Promise<Report>((r) => (resolve = r));
      slot = { promise, resolve, reported: false };
      this.slots.set(key, slot);
    }
    return slot;
  }
}
