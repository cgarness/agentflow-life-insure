import { supabase } from "@/integrations/supabase/client";
import { getLeaderboardRequestGate, type LeaderboardLoadResult, type LeaderboardRequestGate } from "@/lib/leaderboardRequestGate";
import { assertPageActive, isPageActive, onPageActivityChange } from "@/lib/pageActivity";

export const AVATAR_FRESH_MS = 300_000;
export const AVATAR_MAX_ENTRIES = 256;
export const AVATAR_MAX_BYTES = 32 * 1024 * 1024;
export const AVATAR_BATCH_SIZE = 20;
export type AvatarRow = { id: string; avatar_url: string | null };
export type AvatarLoader = (orgId: string, ids: string[], signal: AbortSignal) => PromiseLike<LeaderboardLoadResult<AvatarRow[]>>;
type Entry = { url: string | null; freshUntil: number };
type Demand = { ids: string[]; roster: Set<string>; knownRoster: boolean; enabled: boolean; notify: () => void };

const loadAvatars: AvatarLoader = (orgId, ids, signal) => {
  assertPageActive();
  return supabase.from("profiles").select("id,avatar_url")
    .eq("organization_id", orgId).in("id", ids).abortSignal(signal);
};

/** Private image strings live outside the request gate and outside numeric snapshots. */
export class LeaderboardAvatarCache {
  private readonly entries = new Map<string, Entry>();
  private readonly consumers = new Map<object, Demand>();
  private readonly owner = {};
  private running = false;
  private queued = false;
  private disposed = false;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private controller: AbortController | null = null;
  private readonly stopActivity: () => void;

  constructor(
    readonly identity: string,
    private readonly orgId: string,
    private readonly gate: LeaderboardRequestGate,
    private readonly loader: AvatarLoader = loadAvatars,
    private readonly now: () => number = Date.now,
  ) {
    this.stopActivity = onPageActivityChange(() => {
      this.clearTimer();
      if (isPageActive()) this.kick();
      else this.gate.release(this.owner);
    });
  }

  subscribe(owner: object, notify: () => void): () => void {
    this.consumers.set(owner, { ids: [], roster: new Set(), knownRoster: false, enabled: false, notify });
    return () => {
      this.consumers.delete(owner);
      if (!this.consumers.size) {
        this.generation++;
        this.clearTimer();
        this.gate.release(this.owner);
        this.controller?.abort();
      }
    };
  }

  demand(owner: object, ids: string[], roster: string[], enabled: boolean, knownRoster = enabled): void {
    const consumer = this.consumers.get(owner);
    if (!consumer || this.disposed) return;
    consumer.ids = [...new Set(ids)].sort();
    consumer.roster = new Set(roster);
    consumer.enabled = enabled;
    consumer.knownRoster = knownRoster;
    const known = [...this.consumers.values()].filter(c => c.knownRoster);
    if (known.length) {
      const currentRoster = new Set(known.flatMap(c => [...c.roster]));
      for (const id of this.entries.keys()) if (!currentRoster.has(id)) this.entries.delete(id);
    }
    this.notify();
    // Drop a queued obsolete batch; its completion will recompute current demand.
    this.gate.release(this.owner);
    this.kick();
  }

  read(ids: readonly string[]): ReadonlyMap<string, string | null> {
    const out = new Map<string, string | null>();
    if (this.disposed) return out;
    for (const id of ids) {
      const entry = this.entries.get(id);
      if (entry) {
        out.set(id, entry.url);
        this.entries.delete(id);
        this.entries.set(id, entry);
      }
    }
    return out;
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.clearTimer();
    this.gate.release(this.owner);
    this.controller?.abort();
    this.stopActivity();
    this.entries.clear();
    this.notify();
    this.consumers.clear();
  }

  private notify() {
    for (const consumer of this.consumers.values()) consumer.notify();
  }

  private clearTimer() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private wakeAt(at: number) {
    this.clearTimer();
    if (!this.disposed && this.consumers.size && isPageActive()) {
      this.timer = setTimeout(() => { this.timer = undefined; this.kick(); }, Math.max(1, at - this.now()));
    }
  }

  /** Coalesce consumers mounting in the same turn, without a periodic poll. */
  private kick() {
    if (this.queued || this.running || this.disposed || !this.consumers.size || !isPageActive()) return;
    this.queued = true;
    void Promise.resolve().then(() => { this.queued = false; return this.pump(); });
  }

  private eligible(): string[] {
    return [...new Set([...this.consumers.values()]
      .filter(c => c.enabled).flatMap(c => c.ids.filter(id => c.roster.has(id))))]
      .sort().slice(0, AVATAR_MAX_ENTRIES);
  }

  private async pump() {
    if (this.running || this.disposed || !isPageActive()) return;
    const ids = this.eligible().filter(id => (this.entries.get(id)?.freshUntil ?? 0) <= this.now())
      .slice(0, AVATAR_BATCH_SIZE);
    if (!ids.length) return;
    this.clearTimer();
    const generation = this.generation;
    let sentIds: string[] = [];
    this.running = true;
    const result = await this.gate.run<AvatarRow[]>({
      endpoint: "avatars", channel: "avatars", mode: "auto", owner: this.owner,
      key: `avatars|${this.identity}|${ids.join(",")}`,
      load: async (signal) => {
        assertPageActive();
        // A view/roster can change while waiting behind standings or wins.
        const wanted = new Set(this.eligible());
        const currentIds = ids.filter(id => wanted.has(id));
        if (this.disposed || generation !== this.generation || !currentIds.length) return { data: [], error: null };
        sentIds = currentIds;
        const controller = new AbortController();
        this.controller = controller;
        const abort = () => controller.abort();
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
        try {
          const response = await this.loader(this.orgId, currentIds, controller.signal);
          if (controller.signal.aborted) return { data: null, error: { message: "Avatar read cancelled" } };
          // Never accept an unsolicited ID from a response or a mock transport.
          if (response.data?.some(row => !currentIds.includes(row.id))) {
            return { data: null, error: { message: "Unexpected avatar scope" } };
          }
          return response;
        } finally {
          signal.removeEventListener("abort", abort);
          if (this.controller === controller) this.controller = null;
        }
      },
    });
    this.running = false;
    if (this.disposed) return;
    if (generation !== this.generation) { this.kick(); return; }
    if (result.status === "ok") {
      const wanted = new Set(this.eligible());
      const values = new Map(result.data.map(row => [row.id, row.avatar_url]));
      for (const id of sentIds) {
        if (!wanted.has(id)) continue;
        const url = values.get(id) ?? null;
        this.entries.delete(id);
        this.entries.set(id, {
          url: url && url.length * 2 <= AVATAR_MAX_BYTES ? url : null,
          freshUntil: this.now() + AVATAR_FRESH_MS,
        });
      }
      this.bound();
      this.notify();
      this.kick(); // Only unfinished demand; fresh entries never arm a TTL poll.
    } else if (result.status === "blocked" && result.reason === "throttled") {
      this.wakeAt(result.availableAt);
    } else if (result.status === "superseded") {
      this.kick();
    }
    // Failures/cooldowns wait for the next successful standings or activity trigger.
    // A photo must not sustain its own retry loop while the board is unavailable.
  }

  private bound() {
    while (this.entries.size > AVATAR_MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value!);
    let bytes = [...this.entries.values()].reduce((n, e) => n + 2 * (e.url?.length ?? 0), 0);
    for (const entry of this.entries.values()) {
      if (bytes <= AVATAR_MAX_BYTES) break;
      bytes -= 2 * (entry.url?.length ?? 0);
      // Keep bounded freshness metadata so an eviction cannot become a refetch loop.
      entry.url = null;
    }
  }
}

let current: LeaderboardAvatarCache | null = null;
let stopAuth: (() => void) | null = null;
let authUser: string | null = null;

export function getLeaderboardAvatarCache(userId: string, orgId: string): LeaderboardAvatarCache {
  if (!stopAuth) {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const nextUser = session?.user.id ?? null;
      if (event === "SIGNED_OUT" || (nextUser !== null && authUser !== null && nextUser !== authUser)) {
        current?.dispose();
        current = null;
      }
      authUser = nextUser;
    });
    stopAuth = () => data.subscription.unsubscribe();
  }
  authUser = userId;
  const identity = `${userId}:${orgId}`;
  if (current?.identity !== identity) {
    current?.dispose();
    current = new LeaderboardAvatarCache(identity, orgId, getLeaderboardRequestGate(identity));
  }
  return current;
}

/** Test isolation; also unsubscribes the module's one auth listener. */
export function resetLeaderboardAvatarCache(): void {
  current?.dispose(); current = null;
  stopAuth?.(); stopAuth = null; authUser = null;
}
