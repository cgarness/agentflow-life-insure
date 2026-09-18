// Inbound Calling v2 — settings and owner lookups at the DEPENDENCY BOUNDARY (corrective pass, defect 4).
// Deno-free (structurally typed client) so the retry/failure behaviour is unit-tested with a fake query
// builder in src/lib/__tests__/inboundSettingsBoundary.test.ts.
//
// Rule: a FAILED read is never turned into a different routing decision. "Not configured" (no settings
// row ⇒ legacy) and "unassigned" (contact has no assigned agent ⇒ group) are SUCCESSFUL results; a read
// that keeps failing after bounded retries is reported as such and the handler takes the documented
// infrastructure-failure path — it never silently downgrades an enabled organization to the legacy
// engine, and never sends a known contact's call to the group because the owner lookup was unavailable.

import { isUuid } from "./planner.ts";

export interface QueryDb {
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
}

export interface RpcDb {
  // deno-lint-ignore no-explicit-any
  rpc(name: string, args: Record<string, unknown>): any;
}

export interface LoadOptions {
  attempts?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Per-attempt wait ceiling (ms): an attempt still pending past it is abandoned and counted as failed. */
  attemptTimeoutMs?: number;
  /**
   * Total wall-clock budget (ms) for this read, ABSOLUTE: attempts and pauses are clipped to what is
   * left of it — three stalled attempts never exceed it (each attempt's ceiling is the smaller of
   * `attemptTimeoutMs` and the remaining budget; a pause that would cross it ends the read).
   */
  budgetMs?: number;
  /** The request's shared deadline: the budget is further clipped to what remains of it minus `reserveMs`. */
  deadline?: RequestDeadline;
  /** Time (ms) to keep for whatever must follow this read (the failure path, the response). */
  reserveMs?: number;
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

const DEFAULT_ATTEMPTS = 3;
/** Twilio abandons a webhook after ~15 s: every bounded read must finish, fail or time out well inside that. */
export const DEFAULT_ATTEMPT_TIMEOUT_MS = 2_500;
export const DEFAULT_BUDGET_MS = 6_000;
const noSleep = async () => {};

// ── The request deadline ───────────────────────────────────────────────────────────────────────────────
// Twilio enforces a hard 15-second ceiling on call-related HTTP requests (webhook connection overrides
// cannot raise it). ONE absolute deadline is created when the request arrives and carried through every
// read, RPC wait and side effect the handler performs, each clipped to what remains and each reserving
// time for what must still follow (the failure path, the TwiML response). Nothing here changes the
// approved ≈20 s agent ring: that is call time inside Twilio's <Dial>, not webhook time.
export const TWILIO_WEBHOOK_HARD_LIMIT_MS = 15_000;
/** The response must be on the wire by this point after arrival (margin for TLS/transfer under the 15 s). */
export const REQUEST_DEADLINE_MS = 12_000;
/** Kept free at the very end so the TwiML response itself is always written inside the deadline. */
export const RESPONSE_RESERVE_MS = 500;
/** Kept free ahead of a decision read so the infrastructure-failure side effects can still run. */
export const FAILURE_PATH_RESERVE_MS = 2_500;

export interface RequestDeadline {
  readonly startedAt: number;
  readonly deadlineAt: number;
  now(): number;
  /** Milliseconds left until the deadline (never negative). */
  remaining(): number;
  expired(): boolean;
  /** Operations abandoned at the deadline (their late results are ignored — never routed). */
  readonly abandoned: string[];
  markAbandoned(what: string): void;
}

export function createRequestDeadline(totalMs: number = REQUEST_DEADLINE_MS, now: () => number = () => Date.now()): RequestDeadline {
  const startedAt = now();
  const deadlineAt = startedAt + Math.max(0, totalMs);
  const abandoned: string[] = [];
  return {
    startedAt,
    deadlineAt,
    now,
    remaining: () => Math.max(0, deadlineAt - now()),
    expired: () => now() >= deadlineAt,
    abandoned,
    markAbandoned: (what) => { abandoned.push(what); },
  };
}

/** The budget an operation may spend now: the smaller of its own cap and what the deadline leaves after the reserve. */
export function budgetWithin(deadline: RequestDeadline | undefined, capMs: number, reserveMs: number): number {
  if (!deadline) return capMs;
  return Math.max(0, Math.min(capMs, deadline.remaining() - Math.max(0, reserveMs)));
}

export type DeadlineOutcome<T> = { kind: "value"; value: T } | { kind: "expired"; waitedMs: number };

/**
 * Awaits `work` only until the deadline (minus `reserveMs`). An expired wait is reported — and recorded
 * on the deadline — so the caller answers explicitly; the late result is dropped, never acted on.
 */
export async function withDeadline<T>(
  work: Promise<T>,
  deadline: RequestDeadline,
  what: string,
  reserveMs: number = RESPONSE_RESERVE_MS,
  timers?: { setTimeout?: (fn: () => void, ms: number) => unknown; clearTimeout?: (handle: unknown) => void },
): Promise<DeadlineOutcome<T>> {
  const setT = timers?.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearT = timers?.clearTimeout ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const allowance = budgetWithin(deadline, Number.POSITIVE_INFINITY, reserveMs);
  const started = deadline.now();
  if (allowance <= 0) {
    deadline.markAbandoned(what);
    work.catch(() => { /* the abandoned promise must not become an unhandled rejection */ });
    return { kind: "expired", waitedMs: 0 };
  }
  let handle: unknown = null;
  const timer = new Promise<{ kind: "expired" }>((resolve) => { handle = setT(() => resolve({ kind: "expired" }), allowance); });
  try {
    const r = await Promise.race([work.then((value) => ({ kind: "value" as const, value })), timer]);
    if (r.kind === "expired") {
      deadline.markAbandoned(what);
      work.catch(() => { /* ignored: abandoned */ });
      return { kind: "expired", waitedMs: deadline.now() - started };
    }
    return r;
  } finally {
    if (handle !== null) clearT(handle);
  }
}

export type DbError = { message: string; code?: string | null; details?: string | null };

/**
 * The DATABASE'S OWN answer that the object this statement touched does not exist: PostgreSQL
 * `42703` undefined_column, `42P01` undefined_table, `42883` undefined_function. The statement reached
 * PostgreSQL and PostgreSQL rejected it, so the absence is a fact about the database at that moment —
 * the documented rollback state (plan §14). It is deterministic: never retried, never an infrastructure
 * failure.
 *
 * Corrective pass 8: the classification is by ERROR CODE only, and only these three. A message pattern is
 * not evidence — any layer can produce one — and the PostgREST codes below are not evidence either.
 */
export function isDatabaseObjectAbsentError(err: DbError | null | undefined): boolean {
  if (!err) return false;
  const code = String(err.code ?? "").toUpperCase();
  return code === "42703" || code === "42P01" || code === "42883";
}

/**
 * PostgREST SCHEMA-CACHE metadata: `PGRST202` (function), `PGRST204` (column), `PGRST205` (table), and
 * the "… in the schema cache" messages. PostgREST documents that these are answers from ITS cache, not
 * from PostgreSQL: a stale or not-yet-reloaded cache reports a function or column missing while the
 * database object exists. They are therefore AMBIGUOUS — they establish nothing about the schema, they
 * may resolve on their own once the cache reloads, and they must never authorize a different routing
 * engine. They are treated as ordinary transient failures: retried inside the budget, and reported as a
 * failure if they persist.
 */
export function isSchemaCacheError(err: DbError | null | undefined): boolean {
  if (!err) return false;
  const code = String(err.code ?? "").toUpperCase();
  if (code === "PGRST202" || code === "PGRST204" || code === "PGRST205") return true;
  return /in the schema cache/i.test(String(err.message ?? ""));
}

export type RetryResult<T> =
  | { ok: true; data: T | null; attempts: number }
  | { ok: false; error: string; attempts: number; schemaAbsent: boolean; timedOut: boolean; schemaCache?: boolean };

export interface V2RoutingSettings {
  engine: "legacy" | "v2";
  groupIds: string[];
  browserRingSeconds: number;
  mobileRingSeconds: number;
}

export const DEFAULT_V2_SETTINGS: V2RoutingSettings = { engine: "legacy", groupIds: [], browserRingSeconds: 20, mobileRingSeconds: 20 };

export type V2SettingsResult =
  | { ok: true; settings: V2RoutingSettings; configured: boolean; attempts: number; schemaAbsent?: boolean }
  | { ok: false; error: string; attempts: number };

function clampRing(raw: unknown): number {
  const n = raw === null || raw === undefined ? 20 : Number(raw);
  if (!Number.isFinite(n)) return 20;
  return Math.max(5, Math.min(120, Math.round(n)));
}

export async function withRetries<T>(
  run: () => Promise<{ data: T | null; error: DbError | null }>,
  opts: LoadOptions | undefined,
): Promise<RetryResult<T>> {
  const attempts = Math.max(1, opts?.attempts ?? DEFAULT_ATTEMPTS);
  const sleep = opts?.sleep ?? noSleep;
  const now = opts?.now ?? (() => Date.now());
  const attemptTimeoutMs = opts?.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
  const budgetMs = opts?.budgetMs ?? DEFAULT_BUDGET_MS;
  const setT = opts?.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearT = opts?.clearTimeout ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const started = now();
  // ABSOLUTE end of this read: its own budget, further clipped to the request deadline minus the reserve.
  const budgetEnd = started + Math.max(0, opts?.deadline
    ? Math.min(budgetMs, opts.deadline.remaining() - Math.max(0, opts.reserveMs ?? 0))
    : budgetMs);
  let lastError = "unknown";
  let timedOut = false;
  let sawSchemaCache = false;
  for (let i = 1; i <= attempts; i++) {
    const left = budgetEnd - now();
    if (left <= 0) {
      return { ok: false, error: `${lastError} (retry budget exhausted before attempt ${i})`, attempts: i - 1, schemaAbsent: false, timedOut: true, schemaCache: sawSchemaCache };
    }
    const attemptLimit = Math.min(attemptTimeoutMs, left);   // an attempt never outlives the budget
    let handle: unknown = null;
    const deadline = new Promise<{ timedOut: true }>((resolve) => {
      handle = setT(() => resolve({ timedOut: true }), attemptLimit);
    });
    try {
      const outcome: { timedOut: true; r?: undefined } | { timedOut: false; r: { data: T | null; error: DbError | null } } =
        await Promise.race([
          Promise.resolve().then(run).then((r) => ({ timedOut: false as const, r })),
          deadline,
        ]);
      if (outcome.timedOut === true) {
        timedOut = true;
        lastError = `attempt ${i} exceeded ${attemptLimit} ms`;
      } else {
        const { data, error } = outcome.r;
        if (!error) return { ok: true, data, attempts: i };
        lastError = error.message;
        // The DATABASE said the object does not exist: deterministic, stop here.
        if (isDatabaseObjectAbsentError(error)) return { ok: false, error: lastError, attempts: i, schemaAbsent: true, timedOut: false };
        // A PostgREST schema-cache miss is NOT that answer (corrective pass 8): it is ambiguous metadata
        // that may resolve when the cache reloads, so it is retried like any other transient failure and,
        // if it persists, reported as a failure — never as an established schema state.
        if (isSchemaCacheError(error)) sawSchemaCache = true;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    } finally {
      if (handle !== null) clearT(handle);
    }
    if (i < attempts) {
      const pause = 100 * i;
      if (now() + pause >= budgetEnd) {
        return { ok: false, error: `${lastError} (retry budget of ${budgetEnd - started} ms exhausted after ${i} attempt(s))`, attempts: i, schemaAbsent: false, timedOut, schemaCache: sawSchemaCache };
      }
      await sleep(pause);
    }
  }
  return { ok: false, error: lastError, attempts, schemaAbsent: false, timedOut, schemaCache: sawSchemaCache };
}

/**
 * `inbound_routing_settings` v2 columns. No row ⇒ legacy (successfully "not configured"). The v2 columns
 * being ABSENT (M5 rolled back, plan §14) ⇒ legacy as well, decided on the first attempt: a schema error
 * is deterministic, so it is never retried and never an infrastructure failure. Any other persistent
 * failure is reported as such.
 */
export async function loadV2RoutingSettings(db: QueryDb, organizationId: string, opts?: LoadOptions): Promise<V2SettingsResult> {
  const r = await withRetries<{
    routing_engine?: string | null; inbound_group_agent_ids?: unknown;
    browser_ring_seconds?: number | null; mobile_ring_seconds?: number | null;
  }>(
    () => db.from("inbound_routing_settings")
      .select("routing_engine, inbound_group_agent_ids, browser_ring_seconds, mobile_ring_seconds")
      .eq("organization_id", organizationId)
      .maybeSingle(),
    opts,
  );
  if (r.ok === false) {
    if (r.schemaAbsent) return { ok: true, settings: { ...DEFAULT_V2_SETTINGS }, configured: false, schemaAbsent: true, attempts: r.attempts };
    return { ok: false, error: r.error, attempts: r.attempts };
  }
  if (!r.data) return { ok: true, settings: { ...DEFAULT_V2_SETTINGS }, configured: false, attempts: r.attempts };
  const row = r.data;
  const groupIds = Array.isArray(row.inbound_group_agent_ids)
    ? row.inbound_group_agent_ids.filter((v): v is string => typeof v === "string" && isUuid(v))
    : [];
  return {
    ok: true,
    configured: true,
    attempts: r.attempts,
    settings: {
      engine: row.routing_engine === "v2" ? "v2" : "legacy",
      groupIds,
      browserRingSeconds: clampRing(row.browser_ring_seconds),
      mobileRingSeconds: clampRing(row.mobile_ring_seconds),
    },
  };
}

export type OwnerLookupResult =
  | { ok: true; agentId: string | null; attempts: number }
  | { ok: false; error: string; attempts: number };

/** D2: the contact's assigned agent. Missing contact / no assignment ⇒ `null` (successfully unassigned). */
export async function resolveContactAssignedAgent(
  db: QueryDb,
  organizationId: string,
  contactId: string | null,
  contactType: string | null,
  opts?: LoadOptions,
): Promise<OwnerLookupResult> {
  if (!contactId) return { ok: true, agentId: null, attempts: 0 };
  const table = contactType === "client" ? "clients" : contactType === "recruit" ? "recruits" : "leads";
  const r = await withRetries<{ assigned_agent_id?: string | null }>(
    () => db.from(table).select("assigned_agent_id").eq("id", contactId).eq("organization_id", organizationId).maybeSingle(),
    opts,
  );
  if (r.ok === false) return { ok: false, error: r.error, attempts: r.attempts };
  const assigned = r.data?.assigned_agent_id ?? null;
  return { ok: true, agentId: assigned && isUuid(assigned) ? assigned : null, attempts: r.attempts };
}

export type RoutingEngine = "legacy" | "v2";

export type EngineDecisionResult =
  | { ok: true; engine: RoutingEngine; first: boolean; attempts: number }
  | { ok: false; error: string; attempts: number; schemaAbsent?: boolean; schemaCache?: boolean };

/**
 * Corrective pass 6, finding 1 — the DURABLE per-call engine decision. The handler records the engine it
 * is about to route THIS call with BEFORE any engine-specific work (owner lookup, planning), so recovery
 * owns exactly the calls v2 actually took, whatever happens next: a worker terminated mid-request, a
 * rollback of the organization's flag, a duplicate webhook. The FIRST decision wins and is returned to
 * every later caller, so two concurrent deliveries of the same call cannot route with different engines.
 *
 * A failure here is reported as a failure — never as "legacy", and never as an absent decision that some
 * later reader could interpret. The caller decides what an unavailable decision means for each engine.
 */
export async function recordInboundEngineDecision(
  db: RpcDb,
  callRowId: string,
  organizationId: string,
  engine: RoutingEngine,
  opts?: LoadOptions,
): Promise<EngineDecisionResult> {
  const r = await withRetries<{ recorded?: boolean; engine?: string | null; first?: boolean; reason?: string | null }>(
    () => db.rpc("record_inbound_engine_decision", { p_call_row_id: callRowId, p_org_id: organizationId, p_engine: engine }),
    opts,
  );
  if (r.ok === false) {
    return { ok: false, error: r.error, attempts: r.attempts, schemaAbsent: r.schemaAbsent, schemaCache: r.schemaCache };
  }
  const row = r.data;
  if (!row || row.recorded !== true) {
    return { ok: false, error: `engine decision not recorded${row?.reason ? `: ${row.reason}` : ""}`, attempts: r.attempts };
  }
  const persisted = row.engine === "v2" ? "v2" : row.engine === "legacy" ? "legacy" : null;
  if (!persisted) return { ok: false, error: `engine decision returned no engine`, attempts: r.attempts };
  return { ok: true, engine: persisted, first: row.first === true, attempts: r.attempts };
}

/**
 * What the DATABASE holds for this call, read from the row itself (corrective pass 8, finding 1).
 *
 * `record_inbound_engine_decision` is the normal way to learn the persisted decision, but its failure is
 * an answer from the API layer, not from the data: PostgREST documents that a stale schema cache reports
 * a function missing (`PGRST202`) while the function exists, and a single RPC being unreachable says
 * nothing about sibling tables, columns or the decisions already saved in them. So when the RPC cannot
 * answer, the decision is read DIRECTLY from `calls.routing_engine`:
 *
 *  - `decided`       — the row carries a decision. It is durable, so routing may follow it (a v2 decision
 *                      already satisfies the recovery-ownership contract `plan_inbound_route` enforces).
 *  - `undecided`     — the column exists and this call has no decision. Nothing is owed to recovery yet.
 *  - `column_absent` — POSTGRESQL itself rejected the column (42703/42P01): the per-call decision column
 *                      does not exist, so NO call can carry a v2 decision. This is the only positively
 *                      established compatibility state, and it is established against the exact object
 *                      whose absence is claimed — never inferred from another migration's objects.
 *  - `unavailable`   — anything else, including every schema-cache answer and an unreadable row.
 */
export type PersistedEngineRead =
  | { kind: "decided"; engine: RoutingEngine; attempts: number }
  | { kind: "undecided"; attempts: number }
  | { kind: "column_absent"; attempts: number }
  | { kind: "unavailable"; error: string; attempts: number };

export async function readPersistedEngineDecision(
  db: QueryDb,
  callRowId: string,
  organizationId: string,
  opts?: LoadOptions,
): Promise<PersistedEngineRead> {
  const r = await withRetries<{ routing_engine?: string | null }>(
    () => db.from("calls").select("routing_engine").eq("id", callRowId).eq("organization_id", organizationId).maybeSingle(),
    opts,
  );
  if (r.ok === false) {
    if (r.schemaAbsent) return { kind: "column_absent", attempts: r.attempts };
    return { kind: "unavailable", error: r.error, attempts: r.attempts };
  }
  if (!r.data) return { kind: "unavailable", error: "call row not readable", attempts: r.attempts };
  const engine = r.data.routing_engine;
  if (engine === "v2" || engine === "legacy") return { kind: "decided", engine, attempts: r.attempts };
  if (engine === null || engine === undefined) return { kind: "undecided", attempts: r.attempts };
  return { kind: "unavailable", error: `unrecognised routing_engine value`, attempts: r.attempts };
}

export type InboundStartDecision =
  | { kind: "legacy"; settings: V2RoutingSettings }
  | { kind: "v2"; settings: V2RoutingSettings; contactOwnerId: string | null }
  | {
      kind: "infrastructure_failure";
      reason: "settings_unavailable" | "owner_lookup_unavailable" | "engine_decision_unavailable";
      error: string;
    };

/**
 * The handler's routing-start decision from the boundary results. A failed settings read never yields
 * "legacy"; a failed owner lookup never yields "no owner"; the engine actually used is the one PERSISTED
 * for this call when there is one. A direct line (P1) decides the owner by itself,
 * so the contact-owner lookup is irrelevant there — its absence or failure cannot change the outcome.
 */
export function decideInboundStart(
  settings: V2SettingsResult,
  owner: OwnerLookupResult | null,
  directLineOwnerId: string | null = null,
  /**
   * The engine PERSISTED for this call (corrective pass 6). When present it decides the branch — the
   * organization's current flag never overrides a decision this call already routed with (a duplicate
   * webhook after a cutover in either direction keeps the first decision).
   */
  persistedEngine: RoutingEngine | null = null,
): InboundStartDecision {
  if (settings.ok === false) return { kind: "infrastructure_failure", reason: "settings_unavailable", error: settings.error };
  const engine: RoutingEngine = persistedEngine ?? (settings.settings.engine === "v2" ? "v2" : "legacy");
  if (engine !== "v2") return { kind: "legacy", settings: settings.settings };
  if (directLineOwnerId) return { kind: "v2", settings: settings.settings, contactOwnerId: owner?.ok === true ? owner.agentId : null };
  if (!owner) return { kind: "infrastructure_failure", reason: "owner_lookup_unavailable", error: "owner lookup not performed" };
  if (owner.ok === false) return { kind: "infrastructure_failure", reason: "owner_lookup_unavailable", error: owner.error };
  return { kind: "v2", settings: settings.settings, contactOwnerId: owner.agentId };
}

export type InboundStartOutcome =
  | { kind: "proceed"; decision: Extract<InboundStartDecision, { kind: "legacy" | "v2" }> }
  | { kind: "respond"; twiml: string; reason: string };

/**
 * The handler's glue for the start decision: a routable decision proceeds; an infrastructure failure is
 * ANSWERED by `onFailure` (the documented failure path: missed mark + terminal finalize + sorry greeting)
 * and the TwiML it returns is the response. Unit-tested so the failure branch cannot be dropped silently.
 */
export async function resolveInboundStart(
  decision: InboundStartDecision,
  onFailure: (reason: string, error: string) => Promise<string>,
): Promise<InboundStartOutcome> {
  if (decision.kind === "infrastructure_failure") {
    return { kind: "respond", twiml: await onFailure(decision.reason, decision.error), reason: decision.reason };
  }
  return { kind: "proceed", decision };
}

export const DEFAULT_FAILURE_DEADLINE_MS = 4_000;

export interface InfrastructureFailureDeps {
  /**
   * The ONE atomic failure decision (abandon_inbound_routing): finalize 'no-answer', D13 classification and the
   * closure of the open ring stage in a single transaction. Awaited within the budget; never preceded by
   * notification work.
   */
  abandon: () => Promise<unknown>;
  /** Legacy-tier notification work (network): runs AFTER the decision and only in the background. */
  notify?: () => Promise<unknown>;
  /**
   * Supabase Edge background handling (EdgeRuntime.waitUntil): keeps the worker alive for work handed over
   * after the response. Durable recovery (the notification sweep, the route-attempt sweep) covers a worker
   * that terminates anyway — nothing here relies on an untracked promise finishing.
   */
  background?: (work: Promise<unknown>) => void;
  log?: (message: string, meta?: Record<string, unknown>) => void;
}

export type InfrastructureFailureResult = "completed" | "errored" | "timed_out" | "handed_over";

/**
 * The infrastructure-failure path (corrective pass 4): the abandon decision is awaited for what the deadline
 * leaves (keeping the response reserve). If it cannot complete in time it is handed to the background
 * handler (`handed_over`) so a still-running worker finishes it; either way the caller responds now, and the
 * database sweeps recover any call the decision never reached. Notification work is chained AFTER the
 * decision and handed to the background as well — it never delays finalization. Never throws.
 */
export async function runInfrastructureFailure(
  deps: InfrastructureFailureDeps,
  opts?: { deadlineMs?: number; deadline?: RequestDeadline; reserveMs?: number; setTimeout?: (fn: () => void, ms: number) => unknown; clearTimeout?: (handle: unknown) => void },
): Promise<InfrastructureFailureResult> {
  const deadlineMs = budgetWithin(opts?.deadline, opts?.deadlineMs ?? DEFAULT_FAILURE_DEADLINE_MS, opts?.reserveMs ?? RESPONSE_RESERVE_MS);
  const setT = opts?.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearT = opts?.clearTimeout ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const hand = (work: Promise<unknown>) => {
    const guarded = work.catch((e) => deps.log?.("infrastructure failure: background work did not run", { error: e instanceof Error ? e.message : String(e) }));
    try { deps.background?.(guarded); } catch { /* no background handler: the sweeps recover */ }
  };
  let decisionErrored = false;
  const decision = (async () => {
    try { await deps.abandon(); } catch (e) { decisionErrored = true; deps.log?.("infrastructure failure: abandon decision failed", { error: e instanceof Error ? e.message : String(e) }); throw e; }
  })();
  const decisionSettled = decision.catch(() => {});
  // Notification work strictly follows a SUCCESSFUL decision (never an errored or unknown one — a failed
  // abandon must not become a separate classification) and never blocks the response.
  if (deps.notify) hand(decision.then(() => deps.notify!()));
  if (deadlineMs <= 0) {
    deps.log?.("infrastructure failure: no time left to await the abandon decision — handed to the background", { deadlineMs });
    opts?.deadline?.markAbandoned("infrastructure_failure_decision");
    hand(decisionSettled);
    return "handed_over";
  }
  let handle: unknown = null;
  const timer = new Promise<"timed_out">((resolve) => { handle = setT(() => resolve("timed_out"), deadlineMs); });
  const result = await Promise.race([decisionSettled.then(() => (decisionErrored ? "errored" as const : "completed" as const)), timer]);
  if (handle !== null) clearT(handle);
  if (result === "timed_out") {
    deps.log?.("infrastructure failure: the abandon decision exceeded the deadline — handed to the background, responding anyway", { deadlineMs });
    opts?.deadline?.markAbandoned("infrastructure_failure_decision");
    hand(decisionSettled);
    return "handed_over";
  }
  return result;
}

/** Thrown by a stage dependency whose read kept failing after bounded retries (never "no row"). */
export class StageReadError extends Error {
  constructor(public readonly what: string, public readonly detail: string) {
    super(`${what} unavailable: ${detail}`);
    this.name = "StageReadError";
  }
}

export const ATTEMPT_VIEW_COLUMNS =
  "id, stage, mode, owner_agent_id, reserved_agent_ids, browser_ring_timeout_sent, mobile_number_dialed, voicemail_kind, voicemail_agent_id, voicemail_group_ids, mobile_accept_result, mobile_bridge_evidence, mobile_child_call_sid, terminal";

export type AttemptLookupResult<T> =
  | { ok: true; attempt: T | null; attempts: number }
  | { ok: false; error: string; attempts: number };

/** The stored attempt a stage callback acts on: a failed read is reported, never returned as "no attempt". */
export async function loadAttemptRow<T>(db: QueryDb, organizationId: string, attemptId: string, opts?: LoadOptions): Promise<AttemptLookupResult<T>> {
  const r = await withRetries<T>(
    () => db.from("inbound_route_attempts").select(ATTEMPT_VIEW_COLUMNS).eq("id", attemptId).eq("organization_id", organizationId).maybeSingle(),
    opts,
  );
  if (r.ok === false) return { ok: false, error: r.error, attempts: r.attempts };
  return { ok: true, attempt: r.data ?? null, attempts: r.attempts };
}

export interface StoredCallIdentity {
  id: string;
  organization_id: string | null;
  twilio_call_sid: string | null;
}

export type CallLookupResult =
  | { ok: true; call: StoredCallIdentity | null; attempts: number }
  | { ok: false; error: string; attempts: number };

/** The stored parent identity every v2 stage callback is bound to (defect 5). */
export async function loadCallIdentity(db: QueryDb, callRowId: string, opts?: LoadOptions): Promise<CallLookupResult> {
  const r = await withRetries<StoredCallIdentity>(
    () => db.from("calls").select("id, organization_id, twilio_call_sid").eq("id", callRowId).maybeSingle(),
    opts,
  );
  if (r.ok === false) return { ok: false, error: r.error, attempts: r.attempts };
  return { ok: true, call: r.data ?? null, attempts: r.attempts };
}
