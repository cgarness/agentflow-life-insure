// Inbound Calling v2 — the REQUEST-LEVEL sequences of the webhook handler under ONE absolute deadline
// (corrective pass 3, finding 4). Deno-free so the timing behaviour is tested at the handler level in
// src/lib/__tests__/inboundRequestDeadline.test.ts with fake timers: slow reads, stalled stage
// dependencies and delayed failure side effects must all yield an explicit response inside the deadline,
// and work that outlives the deadline must never turn into a routing transition.
//
// Twilio's hard ceiling for call-related HTTP requests is 15 s (webhook connection overrides cannot raise
// it). The approved ≈20 s agent ring is call time inside <Dial>, unaffected by any of this.

import {
  DEFAULT_V2_SETTINGS,
  FAILURE_PATH_RESERVE_MS,
  RESPONSE_RESERVE_MS,
  StageReadError,
  decideInboundStart,
  resolveInboundStart,
  runInfrastructureFailure,
  withDeadline,
  type CallLookupResult,
  type EngineDecisionResult,
  type InboundStartDecision,
  type PersistedEngineRead,
  type InboundStartOutcome,
  type InfrastructureFailureDeps,
  type LoadOptions,
  type OwnerLookupResult,
  type RequestDeadline,
  type RoutingEngine,
  type StoredCallIdentity,
  type V2RoutingSettings,
  type V2SettingsResult,
} from "./settings.ts";
import { verifyCallbackIdentity, type AttemptView } from "./planner.ts";
import {
  handleGroupBrowserReturn,
  handleInitialV2,
  handleMobileLegStatus,
  handleMobileWhisper,
  handleOwnerBrowserReturn,
  handleOwnerMobileReturn,
  handleVoicemailDone,
  type InitialV2Args,
  type StageContext,
  type StageDeps,
  type StageResponse,
} from "./stages.ts";

export type Timers = { setTimeout?: (fn: () => void, ms: number) => unknown; clearTimeout?: (handle: unknown) => void };

/** The per-read options every boundary read receives: the shared deadline and the reserve for what follows. */
export function readOptions(deadline: RequestDeadline, reserveMs: number, base?: LoadOptions): LoadOptions {
  return { ...(base ?? {}), deadline, reserveMs };
}

// ── Initial request ────────────────────────────────────────────────────────────────────────────────────

export interface InboundStartDeps {
  /** v2 settings read (bounded by the options it receives). */
  loadSettings(opts: LoadOptions): Promise<V2SettingsResult>;
  /**
   * Records the engine THIS call is routed with, durably, before any engine-specific work (corrective
   * pass 6). Null only when there is no call row to record against (ingest produced none) — the handler
   * refuses v2 routing in that case anyway.
   */
  recordEngineDecision: ((engine: RoutingEngine, opts: LoadOptions) => Promise<EngineDecisionResult>) | null;
  /**
   * Reads `calls.routing_engine` for THIS call straight from the row (corrective pass 8). Consulted only
   * when the decision RPC could not answer — an API-layer failure says nothing about what the data holds.
   */
  readEngineDecision?: ((opts: LoadOptions) => Promise<PersistedEngineRead>) | null;
  /** contact-owner lookup (bounded); only consulted for a v2 organization without a direct line. */
  loadOwner(opts: LoadOptions): Promise<OwnerLookupResult>;
  directLineOwnerId: string | null;
  /** The infrastructure-failure decision (abandon RPC) + optional background notification; bounded by the deadline. */
  failure: InfrastructureFailureDeps | null;
  sorryTwiml: string;
  log(message: string, meta?: Record<string, unknown>): void;
  baseReadOptions?: LoadOptions;
  timers?: Timers;
}

/**
 * Settings → ENGINE DECISION → (owner) → decision → proceed or answer the failure path. Every step is
 * clipped to what the deadline leaves: a slow-but-successful settings read leaves the owner lookup only
 * the remainder (minus the failure reserve), and a failing owner lookup is answered with the side effects
 * bounded by what is left minus the response reserve. The response is therefore always ready inside the
 * deadline.
 *
 * Corrective pass 6, finding 1: the engine decision is recorded BEFORE any engine-specific work, and the
 * branch that follows uses the PERSISTED engine, not the organization's current flag — so a duplicate
 * webhook (in either cutover direction) routes the way this call was already routed, and a request that
 * dies after this point leaves ownership recorded for the sweep.
 *
 * Corrective pass 7, finding 1: the persisted decision is routing AUTHORITY. While it is UNKNOWN the
 * organization's current flag may not stand in for it, in either direction: the request takes the
 * infrastructure-failure path (`engine_decision_unavailable`) before either engine does any routing work.
 *
 * Corrective pass 8, finding 1: an error from the decision RPC does not make the decision unknowable, and
 * it certainly does not establish that the v2 schema is gone. PostgREST documents that a stale schema
 * cache reports a function missing (`PGRST202`) while the database function exists, and one unreachable
 * RPC says nothing about sibling tables, columns or the decisions already saved in them — so no RPC error,
 * cache code or message pattern may authorize the other engine. When the RPC cannot answer, the decision
 * is read DIRECTLY from `calls.routing_engine` (`readEngineDecision`) and only the DATABASE'S OWN answers
 * decide:
 *   • a decision on the row              ⇒ route with it (it is durable; a v2 decision already satisfies
 *                                          the recovery-ownership contract the planner enforces);
 *   • PostgreSQL rejects the column      ⇒ legacy: the per-call decision column does not exist, so no call
 *                                          can carry a v2 decision. The only positively established
 *                                          compatibility state, proven against the exact object claimed;
 *   • anything else                      ⇒ failure path.
 *
 * Corrective pass 9, finding 1: "anything else" includes a row that reads UNDECIDED, under either
 * organization flag. A successful read establishes only that the decision was NULL at that instant — it
 * reserves nothing. Only `record_inbound_engine_decision` decides, atomically and first-decision-wins,
 * under the call's row lock. Routing legacy on a NULL read would break that contract twice over: a later
 * delivery of the SAME call can record `v2` once the cache recovers (the call then routes both ways
 * across deliveries), and a delivery overlapping this one can already have committed `v2` between the
 * read and the routing. So an undecided row fails closed, and the only writer of a decision remains the
 * atomic RPC.
 *
 * Both boundary calls are ordinary bounded reads under the same absolute deadline and failure reserve.
 */
export async function runInboundStartRequest(deps: InboundStartDeps, deadline: RequestDeadline): Promise<InboundStartOutcome> {
  const settings = await deps.loadSettings(readOptions(deadline, FAILURE_PATH_RESERVE_MS, deps.baseReadOptions));
  if (settings.ok === true && settings.schemaAbsent) {
    deps.log("v2 settings columns absent (rolled back) — legacy engine");
  }
  const intended: RoutingEngine | null = settings.ok === true ? (settings.settings.engine === "v2" ? "v2" : "legacy") : null;
  let persistedEngine: RoutingEngine | null = null;
  let unresolvedError: string | null = null;
  let columnAbsent = false;
  if (intended && deps.recordEngineDecision) {
    // The decision is a PRECONDITION of routing in BOTH directions (it is also how a duplicate webhook
    // learns that this call is already v2 work), so it gets the full bounded retry budget, clipped as
    // every other boundary read is by the request deadline minus the failure reserve.
    const recorded = await deps.recordEngineDecision(
      intended,
      readOptions(deadline, FAILURE_PATH_RESERVE_MS, deps.baseReadOptions),
    );
    if (recorded.ok === true) {
      persistedEngine = recorded.engine;
      if (!recorded.first || recorded.engine !== intended) {
        deps.log("routing engine decided earlier for this call — routing with the PERSISTED decision", {
          persisted: recorded.engine, intended, first: recorded.first,
        });
      }
    } else if (!deps.readEngineDecision) {
      unresolvedError = recorded.error;
    } else {
      // The RPC's answer came from the API layer, so it proves nothing about the data. Ask the row.
      deps.log("engine-decision RPC did not answer — reading the persisted decision from the row", {
        intended, error: recorded.error, schemaCache: recorded.schemaCache === true, dbObjectAbsent: recorded.schemaAbsent === true,
      });
      const read = await deps.readEngineDecision(readOptions(deadline, FAILURE_PATH_RESERVE_MS, deps.baseReadOptions));
      if (read.kind === "decided") {
        persistedEngine = read.engine;
        deps.log("persisted decision read directly from the call row", { persisted: read.engine, intended });
      } else if (read.kind === "column_absent") {
        // PostgreSQL itself rejected `calls.routing_engine`: the per-call decision column does not exist,
        // so NO call can carry a v2 decision. The one positively established compatibility state.
        columnAbsent = true;
        deps.log("calls.routing_engine absent per PostgreSQL (M6 rolled back) — legacy is the only routable engine", { intended });
      } else if (read.kind === "undecided") {
        // The row carried no decision AT THAT INSTANT. That is not a reservation: only the atomic RPC
        // decides, and it could not run. Another delivery of this call may decide differently a moment
        // later, so neither engine may route here — under either organization flag.
        unresolvedError = `${recorded.error}; the row carries no decision and none could be recorded`;
        deps.log("no decision on the row and none could be recorded — routing is refused (first decision wins)", { intended });
      } else {
        unresolvedError = `${recorded.error}; row read: ${read.error}`;
      }
    }
  }
  // An unknown persisted decision performs NO engine-specific work — not even the owner lookup.
  const effective: RoutingEngine | null =
    unresolvedError !== null ? null : columnAbsent ? "legacy" : (persistedEngine ?? intended);
  const owner: OwnerLookupResult | null =
    settings.ok === true && effective === "v2" && !deps.directLineOwnerId
      ? await deps.loadOwner(readOptions(deadline, FAILURE_PATH_RESERVE_MS, deps.baseReadOptions))
      : null;
  const decision: InboundStartDecision =
    unresolvedError !== null
      ? { kind: "infrastructure_failure", reason: "engine_decision_unavailable", error: unresolvedError }
      : columnAbsent && settings.ok === true
      ? { kind: "legacy", settings: settings.settings }
      : decideInboundStart(settings, owner, deps.directLineOwnerId, persistedEngine);
  return await resolveInboundStart(decision, async (reason, error) => {
    deps.log("ROUTING DECISION UNAVAILABLE — infrastructure-failure path", { reason, error, remainingMs: deadline.remaining() });
    if (deps.failure) {
      const result = await runInfrastructureFailure(
        { log: deps.log, ...deps.failure },
        { deadline, reserveMs: RESPONSE_RESERVE_MS, ...(deps.timers ?? {}) },
      );
      deps.log("infrastructure-failure decision", { result, remainingMs: deadline.remaining() });
    }
    return deps.sorryTwiml;
  });
}

/**
 * The initial v2 planning (one transaction) with its RPC waits clipped to the deadline. A planning RPC
 * abandoned at the deadline has an UNKNOWN outcome: the caller is answered on the failure path (bounded
 * side effects — missed mark + terminal finalize — then the sorry greeting) and a plan that commits late
 * is refused by plan_inbound_route on the finalized call. Never a voicemail or a ring derived from silence.
 */
export async function runInitialV2Request(
  deps: StageDeps,
  args: InitialV2Args,
  deadline: RequestDeadline,
  failure: InfrastructureFailureDeps & { sorryTwiml: string; log(message: string, meta?: Record<string, unknown>): void; timers?: Timers },
): Promise<StageResponse> {
  const bound = deadlineBoundStageDeps(deps, deadline, failure.timers);
  try {
    return await handleInitialV2(bound, args);
  } catch (err) {
    if (!(err instanceof StageReadError)) throw err;
    failure.log("initial v2 planning outlived the request deadline — infrastructure-failure path", { what: err.what, error: err.detail, abandoned: deadline.abandoned });
    const result = await runInfrastructureFailure(
      { abandon: failure.abandon, notify: failure.notify, background: failure.background, log: failure.log },
      { deadline, reserveMs: RESPONSE_RESERVE_MS, ...(failure.timers ?? {}) },
    );
    failure.log("infrastructure-failure decision", { result, remainingMs: deadline.remaining() });
    return { status: 200, twiml: failure.sorryTwiml };
  }
}

// ── Stage callbacks ────────────────────────────────────────────────────────────────────────────────────

/**
 * Wraps the stage dependencies so that EVERY wait is clipped to the request deadline: an RPC abandoned at
 * the deadline returns a `DEADLINE` error (retries stop; the stage machine takes its explicit failure
 * branch); a read abandoned at the deadline surfaces as StageReadError (answered explicitly by the
 * dispatcher, never derived into a routing decision). Late results are dropped.
 */
export function deadlineBoundStageDeps(deps: StageDeps, deadline: RequestDeadline, timers?: Timers): StageDeps {
  // Routing waits keep the FAILURE budget free: an RPC abandoned here still leaves time for the awaited
  // abandon decision (finalize + D13 + closure) before the response reserve.
  const bound = <T>(what: string, work: () => Promise<T>) => withDeadline(work(), deadline, what, FAILURE_PATH_RESERVE_MS, timers);
  return {
    ...deps,
    deadline,
    rpc: async (name, args) => {
      const r = await bound(`rpc:${name}`, () => deps.rpc(name, args));
      if (r.kind === "expired") {
        deps.log(`[v2] ${name} abandoned at the request deadline — outcome unknown, not routed`, { waitedMs: r.waitedMs });
        return { data: null, error: { message: `request deadline reached waiting for ${name}`, code: "DEADLINE" } };
      }
      return r.value;
    },
    loadAttempt: async (attemptId) => {
      const r = await bound("read:inbound_route_attempts", () => deps.loadAttempt(attemptId));
      if (r.kind === "expired") throw new StageReadError("inbound_route_attempts", "request deadline reached");
      return r.value;
    },
    resolveIdentities: async (agentIds) => {
      const r = await bound("read:profiles", () => deps.resolveIdentities(agentIds));
      if (r.kind === "expired") throw new StageReadError("profiles", "request deadline reached");
      return r.value;
    },
    persistRoutedAgents: async (agentIds) => {
      // R14: an unconfirmed persist never rings — the wave is suppressed (safe path), never assumed.
      const r = await bound("rpc:append_call_routed_agents", () => deps.persistRoutedAgents(agentIds));
      return r.kind === "expired" ? false : r.value;
    },
    loadAgentGreeting: async (agentId) => {
      const r = await bound("read:agent_inbound_settings", () => deps.loadAgentGreeting(agentId));
      return r.kind === "expired" ? { text: null, url: null } : r.value;
    },
  };
}

export type StageName = "owner_browser" | "owner_mobile" | "mobile_whisper" | "mobile_leg_status" | "group_browser" | "voicemail_done";

export interface StageRequestDeps {
  /** phone settings (legacy helper) — bounded here, defaults on expiry. */
  loadPhoneSettings(): Promise<unknown>;
  loadV2Settings(opts: LoadOptions): Promise<V2SettingsResult>;
  loadCallIdentity(opts: LoadOptions): Promise<CallLookupResult>;
  /** Builds the (unbounded) stage dependencies once the settings are known; the sequence binds them to the deadline. */
  buildDeps(phoneSettings: unknown, v2: V2RoutingSettings): StageDeps;
  /** parses Twilio's DialBridged field for the owner-mobile return */
  parseDialBridged: (raw: string | undefined) => boolean | null;
  failure: (callRowId: string, orgId: string) => InfrastructureFailureDeps;
  twiml: { empty: string; sorry: string; whisperReject: (message?: string) => string };
  log(message: string, meta?: Record<string, unknown>): void;
  baseReadOptions?: LoadOptions;
  timers?: Timers;
}

export interface StageRequestInput {
  stage: StageName | string;
  callRowId: string;
  orgId: string;
  attemptId: string;
  agentId: string;
  params: Record<string, string>;
  gather: boolean;
}

export type StageRequestOutcome = { status: number; twiml: string; refused?: string };

/**
 * The stage-callback sequence under the deadline: bounded reads (phone settings, v2 settings, stored call
 * identity), the attempt read for child-leg stages, identity binding, then the stage handler with
 * deadline-bound dependencies. A read or RPC that outlives the deadline is answered EXPLICITLY:
 * status callbacks are redelivered (503), the agent's whisper leg is refused (hangup), parent-facing
 * stages take the infrastructure-failure path (bounded side effects + sorry greeting). Nothing that
 * arrives after the response is routed.
 */
export async function runStageRequest(deps: StageRequestDeps, deadline: RequestDeadline, input: StageRequestInput): Promise<StageRequestOutcome> {
  const { stage, callRowId, orgId, attemptId, agentId, params } = input;
  const bound = <T>(what: string, work: () => Promise<T>) => withDeadline(work(), deadline, what, RESPONSE_RESERVE_MS, deps.timers);
  const [phone, v2Result, callResult] = await Promise.all([
    bound("read:phone_settings", () => deps.loadPhoneSettings()),
    deps.loadV2Settings(readOptions(deadline, FAILURE_PATH_RESERVE_MS, deps.baseReadOptions)),
    deps.loadCallIdentity(readOptions(deadline, FAILURE_PATH_RESERVE_MS, deps.baseReadOptions)),
  ]);
  // Stage callbacks act on an EXISTING attempt: the engine flag is not a decision here, so an unavailable
  // settings read falls back to the ring/voicemail defaults (logged) rather than dropping the caller.
  if (v2Result.ok === false) deps.log("v2 settings unavailable for a stage callback — defaults used", { stage, callRowId, error: v2Result.error });
  const v2: V2RoutingSettings = v2Result.ok === true ? v2Result.settings : { ...DEFAULT_V2_SETTINGS };
  if (callResult.ok === false) {
    // The stored parent identity could not be read in time: nothing can be verified, so nothing is
    // written. Non-TwiML callbacks are redelivered (503); TwiML callbacks get the sorry greeting.
    deps.log("stage callback: stored call unavailable — refused without writes", { stage, callRowId, error: callResult.error });
    if (stage === "mobile_leg_status") return { status: 503, twiml: deps.twiml.empty, refused: "call_unavailable" };
    if (stage === "mobile_whisper") return { status: 200, twiml: deps.twiml.whisperReject("Sorry, this call could not be connected. Goodbye."), refused: "call_unavailable" };
    return { status: 200, twiml: deps.twiml.sorry, refused: "call_unavailable" };
  }
  const stored: StoredCallIdentity | null = callResult.call;
  if (!stored) {
    deps.log("stage callback for an unknown call row — refused", { stage, callRowId });
    return { status: 200, twiml: stage === "mobile_whisper" ? deps.twiml.whisperReject() : deps.twiml.empty, refused: "unknown_call" };
  }
  const phoneSettings = phone.kind === "value" ? phone.value : null;
  const stageDeps = deadlineBoundStageDeps(deps.buildDeps(phoneSettings, v2), deadline, deps.timers);
  try {
    const attemptForIdentity = (stage === "mobile_whisper" || stage === "mobile_leg_status") && attemptId
      ? await stageDeps.loadAttempt(attemptId)
      : null;
    const verdict = verifyCallbackIdentity({
      stage, params, orgId, stored,
      attempt: attemptForIdentity ? { mobile_number_dialed: attemptForIdentity.mobile_number_dialed, mobile_child_call_sid: attemptForIdentity.mobile_child_call_sid } : null,
    });
    if (verdict.ok === false) {
      deps.log("stage callback identity refused — no writes", {
        stage, callRowId, reason: verdict.reason, callSid: params["CallSid"] || "(none)", parentCallSid: params["ParentCallSid"] || "(none)",
      });
      return { status: 200, twiml: stage === "mobile_whisper" ? deps.twiml.whisperReject() : deps.twiml.empty, refused: `identity:${verdict.reason}` };
    }
    const ctx: StageContext = { callRowId, orgId, attemptId, agentId, fromNumber: params["From"] || "", parentCallSid: verdict.parentCallSid };
    let resp: StageResponse;
    switch (stage) {
      case "owner_browser": resp = await handleOwnerBrowserReturn(stageDeps, ctx, params); break;
      case "owner_mobile": resp = await handleOwnerMobileReturn(stageDeps, ctx, params, deps.parseDialBridged); break;
      case "mobile_whisper": resp = await handleMobileWhisper(stageDeps, ctx, params, input.gather); break;
      case "mobile_leg_status": resp = await handleMobileLegStatus(stageDeps, ctx, params); break;
      case "group_browser": resp = await handleGroupBrowserReturn(stageDeps, ctx, params); break;
      case "voicemail_done": resp = await handleVoicemailDone(stageDeps, ctx, params); break;
      default:
        deps.log("unknown v2 stage — empty TwiML", { stage });
        resp = { status: 200, twiml: deps.twiml.empty };
    }
    return { status: resp.status, twiml: resp.twiml };
  } catch (err) {
    if (!(err instanceof StageReadError)) throw err;
    // A stage dependency stayed unavailable (retries exhausted or the deadline reached): no routing
    // decision is derived from the absence. Status callbacks are redelivered (503); the agent's whisper
    // leg is refused (its parent <Dial> then returns and is answered on the parent); parent-facing stages
    // take the failure path — side effects bounded by what the deadline leaves, then the sorry greeting.
    deps.log("stage dependency unavailable — explicit failure, no derived routing", { stage, callRowId, what: err.what, error: err.detail, abandoned: deadline.abandoned });
    if (stage === "mobile_leg_status") return { status: 503, twiml: deps.twiml.empty, refused: `dependency:${err.what}` };
    if (stage === "mobile_whisper") return { status: 200, twiml: deps.twiml.whisperReject("Sorry, this call could not be connected. Goodbye."), refused: `dependency:${err.what}` };
    const result = await runInfrastructureFailure(
      { log: deps.log, ...deps.failure(callRowId, orgId) },
      { deadline, reserveMs: RESPONSE_RESERVE_MS, ...(deps.timers ?? {}) },
    );
    deps.log("infrastructure-failure decision", { result, remainingMs: deadline.remaining() });
    return { status: 200, twiml: deps.twiml.sorry, refused: `dependency:${err.what}` };
  }
}

/** Useful for tests and logs: what the deadline abandoned during a request. */
export function abandonedOperations(deadline: RequestDeadline): string[] {
  return [...deadline.abandoned];
}

// keep the imported AttemptView type referenced (structural use through StageDeps.loadAttempt)
export type { AttemptView };
