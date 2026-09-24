/** Nonessential standings must never create an unbounded request queue. */
export interface LeaderboardRequestError {
  code?: string;
  message?: string;
}

export interface LeaderboardResponse<T> {
  data: T | null;
  error: LeaderboardRequestError | null;
}

interface GateOptions {
  now?: () => number;
  successTtlMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  timeoutMs?: number;
  maxEntries?: number;
}

type CachedResponse = {
  value: LeaderboardResponse<unknown>;
  expiresAt: number;
};

const errorResult = (code: string, message: string): LeaderboardResponse<null> => ({
  data: null,
  error: { code, message },
});

/**
 * Component-owned, memory-only gate. Keys MUST include real user, organization,
 * view/group, and period start. No data is shared between authenticated users.
 *
 * Identical requests share one promise; different contexts serialize. A brief
 * successful snapshot is reused; failures open a global cooldown so changing a
 * filter or repeatedly pressing Retry cannot defeat backoff. The server also
 * enforces concurrency: aborting HTTP cannot guarantee cancellation in Postgres.
 */
export class LeaderboardRequestGate {
  private readonly now: () => number;
  private readonly successTtlMs: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly timeoutMs: number;
  private readonly maxEntries: number;
  private readonly cache = new Map<string, CachedResponse>();
  private readonly pending = new Map<string, Promise<LeaderboardResponse<unknown>>>();
  private tail: Promise<unknown> = Promise.resolve();
  private failures = 0;
  private blockedUntil = 0;
  private lastError: LeaderboardRequestError | null = null;
  private epoch = 0;
  private controller: AbortController | null = null;

  constructor(options: GateOptions = {}) {
    this.now = options.now ?? Date.now;
    this.successTtlMs = options.successTtlMs ?? 10_000;
    this.retryBaseMs = options.retryBaseMs ?? 30_000;
    this.retryMaxMs = options.retryMaxMs ?? 300_000;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.maxEntries = options.maxEntries ?? 8;
  }

  /** Clear identity-scoped state and prevent queued old-identity work. */
  reset(): void {
    this.epoch += 1;
    this.cache.clear();
    this.failures = 0;
    this.blockedUntil = 0;
    this.lastError = null;
    this.controller?.abort();
    // Keep the tail/pending promises until they settle; never open a second lane.
  }

  run<T>(
    key: string,
    load: (signal: AbortSignal) => PromiseLike<LeaderboardResponse<T>>,
    isCurrent: () => boolean = () => true,
  ): Promise<LeaderboardResponse<T>> {
    const epoch = this.epoch;
    const pendingKey = `${epoch}:${key}`;
    const existing = this.pending.get(pendingKey);
    if (existing) return existing as Promise<LeaderboardResponse<T>>;
    if (this.pending.size >= this.maxEntries) {
      return Promise.resolve(errorResult('CLIENT_BUSY', 'Standings refresh is already queued.'));
    }

    const work = this.tail.then(async (): Promise<LeaderboardResponse<T>> => {
      if (epoch !== this.epoch || !isCurrent()) {
        return errorResult('CLIENT_CANCELLED', 'Standings request was superseded.');
      }
      const now = this.now();
      const cached = this.cache.get(key);
      if (cached && now < cached.expiresAt) return cached.value as LeaderboardResponse<T>;
      if (now < this.blockedUntil && this.lastError) {
        return { data: null, error: this.lastError };
      }

      const controller = new AbortController();
      this.controller = controller;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const aborted = new Promise<LeaderboardResponse<T>>((resolve) => {
        controller.signal.addEventListener('abort', () => {
          resolve(errorResult('CLIENT_ABORTED', 'Standings refresh was interrupted.'));
        }, { once: true });
      });
      const timedOut = new Promise<LeaderboardResponse<T>>((resolve) => {
        timer = setTimeout(() => {
          // Resolve with the timeout before aborting the transport.
          resolve(errorResult('CLIENT_TIMEOUT', 'Standings refresh timed out.'));
          controller.abort();
        }, this.timeoutMs);
      });
      let result: LeaderboardResponse<T>;
      try {
        const request = Promise.resolve().then(() => load(controller.signal));
        result = await Promise.race([request, timedOut, aborted]);
        if (!result || (!result.error && result.data === null)) {
          result = errorResult('EMPTY_RESPONSE', 'Standings response was unavailable.');
        }
      } catch {
        result = errorResult('NETWORK_ERROR', 'Could not refresh standings.');
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        if (this.controller === controller) this.controller = null;
      }
      if (epoch !== this.epoch || !isCurrent()) {
        return errorResult('CLIENT_CANCELLED', 'Standings request was superseded.');
      }
      if (result.error) {
        this.failures = Math.min(this.failures + 1, 10);
        const delay = result.error.code === 'PT503'
          ? this.retryMaxMs
          : Math.min(this.retryMaxMs, this.retryBaseMs * 2 ** (this.failures - 1));
        this.cache.delete(key);
        this.cache.set(key, { value: result, expiresAt: this.now() + delay });
        // A denied Group endpoint must not prevent fallback to the authorized org endpoint.
        if (result.error.code !== '42501') {
          this.blockedUntil = this.now() + delay;
          this.lastError = result.error;
        }
        while (this.cache.size > this.maxEntries) this.cache.delete(this.cache.keys().next().value!);
      } else {
        this.failures = 0;
        this.blockedUntil = 0;
        this.lastError = null;
        this.cache.delete(key);
        this.cache.set(key, { value: result, expiresAt: this.now() + this.successTtlMs });
        while (this.cache.size > this.maxEntries) this.cache.delete(this.cache.keys().next().value!);
      }
      return result;
    });
    this.pending.set(pendingKey, work);
    this.tail = work.then(() => undefined, () => undefined);
    void work.finally(() => {
      if (this.pending.get(pendingKey) === work) this.pending.delete(pendingKey);
    });
    return work;
  }
}

/** Reject invalid or legacy four-second settings rather than creating a hot loop. */
export function leaderboardPollMs(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 30_000
    ? Math.min(parsed, 300_000)
    : 30_000;
}

export function canRefreshLeaderboard(): boolean {
  return (typeof document === 'undefined' || document.visibilityState === 'visible') &&
    (typeof navigator === 'undefined' || navigator.onLine !== false);
}

export function leaderboardErrorMessage(error: LeaderboardRequestError | null, hasSnapshot: boolean): string {
  if (error?.code === 'PT503') return 'Standings temporarily paused. Refresh will resume automatically.';
  if (error?.code === 'PT429' || error?.code === 'CLIENT_BUSY') return 'Standings are busy. Please try again shortly.';
  return hasSnapshot ? "Couldn't refresh standings." : "Couldn't load the leaderboard.";
}
