// Inbound Calling v2 stage machine for twilio-voice-inbound (implementation_plan.md rev 3 §8–§10 +
// safeguards 1, 2, 3, 5). Deno-free: every database call goes through injected deps so the machine is
// unit-tested under vitest (src/lib/__tests__/inboundStages.test.ts) with a fake RPC.
//
// Contract (invariant #30 + safeguard 1): the mobile <Dial> is emitted ONLY after the database reports
// the atomic commitment (`forward:true`). Any failure or ambiguity serves voicemail TwiML with the
// mailbox in the SIGNED recording URL — never a mobile <Dial>, never a browser re-ring from a return.
// Notifications: the D13 mark is written inside the reservation transaction; the notification rows are
// converged in-request (bounded) and durably by the SQL sweep (safeguard 2) — TwiML never waits on them.

import {
  AdvanceToMobileResult,
  AttemptView,
  NextTwiml,
  decideMobileReturn,
  decideOwnerBrowserReturn,
  decideWhisperResponse,
  isAnsweredDial,
  isTerminalLegStatus,
  mailboxForAttempt,
  nextForPersistedStage,
  parseDurationInt,
  phoneDigitsE164ish,
} from "./planner.ts";
import {
  buildClientDialTwiml,
  buildEmptyTwiml,
  buildMobileForwardTwiml,
  buildMobileWhisperTwiml,
  buildVoicemailTwiml,
  buildWhisperAcceptTwiml,
  buildWhisperRejectTwiml,
  clampV2RingSeconds,
  spokenCallerLabel,
} from "./twiml.ts";

import { FAILURE_PATH_RESERVE_MS, StageReadError, type RequestDeadline } from "./settings.ts";

export type RpcResult = { data: unknown; error: { message: string; code?: string | null } | null };

export interface StageDeps {
  /** service-role RPC (supabase.rpc) — the ONLY writer the stage machine uses. */
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
  /** service-role read of one attempt row (null when absent). */
  loadAttempt(attemptId: string): Promise<AttemptView | null>;
  /** same-org Active profiles with a non-blank identity, in the order requested (T17/T18). */
  resolveIdentities(agentIds: string[]): Promise<Array<{ agentId: string; identity: string }>>;
  /** R14: append_call_routed_agents must land before any <Client> wave rings. */
  persistRoutedAgents(agentIds: string[]): Promise<boolean>;
  /** agent_inbound_settings greeting (D6); null fields fall back to the organization greeting. */
  loadAgentGreeting(agentId: string): Promise<{ text: string | null; url: string | null }>;
  urls: {
    /** SIGNED self URL for a stage callback: stage + call_row_id + org_id + attempt_id + agent_id. */
    stage(query: Record<string, string>): string;
    /** twilio-recording-status with the voicemail source + mailbox query (SIGNED). */
    recordingStatus(query: Record<string, string>): string;
    claimCallbackBase: string;
  };
  settings: {
    browserRingSeconds: number;
    mobileRingSeconds: number;
    recordingEnabled: boolean;
    greetingText: string;
    greetingUrl: string;
  };
  log(message: string, meta?: Record<string, unknown>): void;
  /** bounded in-request retry pacing (tests inject a no-op). */
  sleep?: (ms: number) => Promise<void>;
  /**
   * The request's shared deadline (webhook ceiling). An RPC abandoned at the deadline returns an error
   * carrying `code: "DEADLINE"`; retries stop, and nothing derived from its absent result is routed.
   */
  deadline?: RequestDeadline;
}

export interface StageContext {
  callRowId: string;
  orgId: string;
  attemptId: string;
  /** owner agent id from the signed query (cross-checked in SQL); "" for group attempts. */
  agentId: string;
  fromNumber: string;
  /** The STORED parent CallSid (calls.twilio_call_sid) the dispatcher verified this request against (defect 5). */
  parentCallSid: string;
}

export interface StageResponse {
  status: number;
  twiml: string;
}

const RPC_ATTEMPTS = 3;

async function rpcWithRetry(
  deps: StageDeps,
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  let lastError = "unknown";
  for (let attempt = 1; attempt <= RPC_ATTEMPTS; attempt++) {
    if (deps.deadline && deps.deadline.remaining() <= FAILURE_PATH_RESERVE_MS) {
      // No attempt can fit: the outcome stays unknown, which is an explicit failure (never a decision).
      deps.log(`[v2] ${name} not attempted — request deadline reached`, { attempt, ...args });
      throw new StageReadError(`rpc:${name}`, `request deadline reached before attempt ${attempt}`);
    }
    try {
      const { data, error } = await deps.rpc(name, args);
      if (!error) return { ok: true, data };
      lastError = error.message;
      deps.log(`[v2] ${name} attempt ${attempt} errored`, { message: error.message, ...args });
      // Abandoned at the deadline: the call may still commit later, so NO routing is derived from its
      // absence — the dispatcher answers on the explicit failure path (finalize + sorry), and the SQL
      // transitions refuse a late commit on a finalized call.
      if (error.code === "DEADLINE") throw new StageReadError(`rpc:${name}`, error.message);
    } catch (err) {
      if (err instanceof StageReadError) throw err;
      lastError = err instanceof Error ? err.message : String(err);
      deps.log(`[v2] ${name} attempt ${attempt} threw`, { message: lastError, ...args });
    }
    if (attempt < RPC_ATTEMPTS && deps.sleep) {
      const pause = 150 * attempt;
      if (deps.deadline && deps.deadline.remaining() <= pause + FAILURE_PATH_RESERVE_MS) {
        throw new StageReadError(`rpc:${name}`, `request deadline reached after attempt ${attempt}`);
      }
      await deps.sleep(pause);
    }
  }
  return { ok: false, error: lastError };
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function sanitizeQuery(q: Record<string, string | null | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) if (v) out[k] = v;
  return out;
}

function ctxQuery(ctx: StageContext): Record<string, string> {
  return sanitizeQuery({ call_row_id: ctx.callRowId, org_id: ctx.orgId, attempt_id: ctx.attemptId, agent_id: ctx.agentId });
}

// ── Notification convergence (safeguard 2): bounded in-request, sweep-owned afterwards ────────────────
export async function convergeNotifications(deps: StageDeps, callRowId: string): Promise<void> {
  if (!callRowId) return;
  const r = await rpcWithRetry(deps, "converge_inbound_notifications", { p_call_row_id: callRowId });
  if (r.ok === false) {
    deps.log("[v2] converge_inbound_notifications failed — sweep owns the retry", { callRowId, error: r.error });
    return;
  }
  const d = asObject(r.data);
  if (d.missed_notified === false) {
    deps.log("[v2] missed-call notification incomplete — sweep owns the retry", { callRowId });
  }
}

// ── Finalization (parent row; twilio-voice-status remains the second terminal writer) ─────────────────
async function finalizeCompleted(deps: StageDeps, ctx: StageContext): Promise<void> {
  const r = await rpcWithRetry(deps, "finalize_inbound_call_terminal", {
    p_call_row_id: ctx.callRowId, p_org_id: ctx.orgId, p_status: "completed", p_mark_missed: false, p_external_answer: false,
  });
  if (r.ok === false) deps.log("[v2] TERMINAL-FINALIZE FAILED", { callRowId: ctx.callRowId, error: r.error });
}

// ── TwiML emitters ───────────────────────────────────────────────────────────────────────────────────
async function voicemailTwiml(deps: StageDeps, ctx: StageContext, mailbox: string): Promise<string> {
  let greetingText = deps.settings.greetingText;
  let greetingUrl = deps.settings.greetingUrl;
  const agentId = mailbox.startsWith("agent:") ? mailbox.slice(6) : "";
  if (agentId) {
    try {
      const g = await deps.loadAgentGreeting(agentId);
      if (g.url && g.url.trim()) { greetingUrl = g.url.trim(); greetingText = ""; }
      else if (g.text && g.text.trim()) { greetingText = g.text.trim(); greetingUrl = ""; }
    } catch (err) {
      deps.log("[v2] agent greeting lookup failed — organization greeting used", { agentId, err: String(err) });
    }
  }
  const recordingUrl = deps.urls.recordingStatus(sanitizeQuery({
    source: "voicemail", mailbox, call_row_id: ctx.callRowId, org_id: ctx.orgId, attempt_id: ctx.attemptId,
  }));
  const doneUrl = deps.urls.stage({ stage: "voicemail_done", ...ctxQuery(ctx) });
  return buildVoicemailTwiml(recordingUrl, doneUrl, greetingText, greetingUrl);
}

function mobileTwiml(deps: StageDeps, ctx: StageContext, mobile: string): string {
  const q = ctxQuery(ctx);
  return buildMobileForwardTwiml({
    mobileNumber: mobile,
    timeoutSec: deps.settings.mobileRingSeconds,
    actionUrl: deps.urls.stage({ stage: "owner_mobile", ...q }),
    whisperUrl: deps.urls.stage({ stage: "mobile_whisper", ...q }),
    legStatusUrl: deps.urls.stage({ stage: "mobile_leg_status", ...q }),
  });
}

/**
 * R14 + D10: the exact reserved wave is persisted (append_call_routed_agents) BEFORE the <Client>
 * nouns are emitted. Persistence failure or an empty identity set ⇒ the attempt moves to its voicemail
 * stage (missed marked for the reserved agents) — never a ring whose claim is guaranteed to fail.
 */
async function clientDialOrVoicemail(
  deps: StageDeps,
  ctx: StageContext,
  next: Extract<NextTwiml, { kind: "client_dial" }>,
  attempt: AttemptView | null,
): Promise<string> {
  const persisted = next.agentIds.length > 0 ? await deps.persistRoutedAgents(next.agentIds) : false;
  const identities = persisted ? await deps.resolveIdentities(next.agentIds) : [];
  if (persisted && identities.length > 0) {
    return buildClientDialTwiml({
      targets: identities,
      callRowId: ctx.callRowId,
      timeoutSec: clampV2RingSeconds(next.timeoutSec),
      actionUrl: deps.urls.stage({ stage: next.stage, ...ctxQuery(ctx) }),
      recordingEnabled: deps.settings.recordingEnabled,
      recordingStatusUrl: deps.urls.recordingStatus({}),
      claimCallbackBaseUrl: deps.urls.claimCallbackBase,
    });
  }
  deps.log("[v2] browser wave suppressed (routed persistence or identity resolution failed) — voicemail safe path", {
    callRowId: ctx.callRowId, stage: next.stage, persisted, identities: identities.length,
  });
  const toStage = next.stage === "owner_browser" ? "owner_voicemail" : "group_voicemail";
  const mailbox = next.stage === "owner_browser" && attempt?.owner_agent_id ? `agent:${attempt.owner_agent_id}` : "group";
  await rpcWithRetry(deps, "advance_inbound_route_stage", {
    p_attempt_id: ctx.attemptId, p_org_id: ctx.orgId, p_from_stage: next.stage, p_to_stage: toStage,
    p_patch: { voicemail_kind: mailbox === "group" ? "group" : "agent", voicemail_agent_id: attempt?.owner_agent_id ?? null,
               outcome: { event: "wave_suppressed", persisted, identities: identities.length } },
  });
  await rpcWithRetry(deps, "mark_inbound_missed", {
    p_call_row_id: ctx.callRowId, p_org_id: ctx.orgId, p_reason: "no_answer",
    p_recipient_ids: next.agentIds, p_for_agent_id: attempt?.owner_agent_id ?? null,
  });
  await convergeNotifications(deps, ctx.callRowId);
  return await voicemailTwiml(deps, ctx, mailbox);
}

async function emitNext(deps: StageDeps, ctx: StageContext, next: NextTwiml, attempt: AttemptView | null): Promise<string> {
  switch (next.kind) {
    case "client_dial":
      return await clientDialOrVoicemail(deps, ctx, next, attempt);
    case "mobile_dial":
      return mobileTwiml(deps, ctx, next.mobile);
    case "voicemail":
      return await voicemailTwiml(deps, ctx, next.mailbox);
    case "empty":
      return buildEmptyTwiml();
  }
}

// ── Initial inbound (v2) ─────────────────────────────────────────────────────────────────────────────
export interface InitialV2Args {
  callRowId: string;
  orgId: string;
  ownerAgentId: string | null;
  ownerSource: "direct_line" | "contact" | null;
  groupIds: string[];
  fromNumber: string;
  /** Parent CallSid of the signature-verified initial request (stored as calls.twilio_call_sid). */
  parentCallSid: string;
}

/**
 * §8.1: ONE transaction (plan_inbound_route) decides owner/group, eligibility, reservation and — for an
 * offline owner with a mobile — the D13 commit + destination snapshot. The handler only emits the TwiML
 * for the returned stage. Planner failure after retries ⇒ safe path: missed for the intended recipients,
 * voicemail TwiML with the mailbox in the signed URL, no attempt id, never a mobile <Dial>.
 */
export async function handleInitialV2(deps: StageDeps, args: InitialV2Args): Promise<StageResponse> {
  const plan = await rpcWithRetry(deps, "plan_inbound_route", {
    p_call_row_id: args.callRowId, p_org_id: args.orgId,
    p_owner_agent_id: args.ownerAgentId, p_owner_source: args.ownerSource,
    p_candidate_group_ids: args.groupIds, p_browser_ring_seconds: deps.settings.browserRingSeconds,
  });
  const baseCtx: StageContext = {
    callRowId: args.callRowId, orgId: args.orgId, attemptId: "", agentId: args.ownerAgentId ?? "", fromNumber: args.fromNumber,
    parentCallSid: args.parentCallSid,
  };
  if (plan.ok === false) {
    deps.log("[v2] plan_inbound_route FAILED — voicemail safe path (no attempt)", { callRowId: args.callRowId, error: plan.error });
    const recipients = args.ownerAgentId ? [args.ownerAgentId] : args.groupIds;
    await rpcWithRetry(deps, "mark_inbound_missed", {
      p_call_row_id: args.callRowId, p_org_id: args.orgId, p_reason: "no_answer",
      p_recipient_ids: recipients, p_for_agent_id: args.ownerAgentId,
    });
    await convergeNotifications(deps, args.callRowId);
    const mailbox = args.ownerAgentId ? `agent:${args.ownerAgentId}` : "group";
    return { status: 200, twiml: await voicemailTwiml(deps, baseCtx, mailbox) };
  }
  const d = asObject(plan.data);
  const attempt = asObject(d.attempt) as unknown as AttemptView;
  if (!attempt || !attempt.id) {
    deps.log("[v2] plan_inbound_route returned no attempt — voicemail safe path", { callRowId: args.callRowId, reason: d.reason });
    const mailbox = args.ownerAgentId ? `agent:${args.ownerAgentId}` : "group";
    return { status: 200, twiml: await voicemailTwiml(deps, baseCtx, mailbox) };
  }
  const ctx: StageContext = { ...baseCtx, attemptId: attempt.id, agentId: attempt.owner_agent_id ?? "" };
  deps.log("[v2] planned", {
    callRowId: args.callRowId, created: d.created, stage: attempt.stage, mode: attempt.mode,
    owner: attempt.owner_agent_id, targets: attempt.reserved_agent_ids, mobile: attempt.mobile_number_dialed ? "(snapshot)" : null,
  });
  const next = nextForPersistedStage(attempt, deps.settings.browserRingSeconds);
  if (attempt.stage === "owner_mobile" || attempt.stage === "owner_voicemail" || attempt.stage === "group_voicemail") {
    // D13 / missed marks were committed inside the RPC; converge the notification rows now (bounded).
    await convergeNotifications(deps, ctx.callRowId);
  }
  return { status: 200, twiml: await emitNext(deps, ctx, next, attempt) };
}

// ── stage=owner_browser: the owner's 20-second browser ring returned ─────────────────────────────────
export async function handleOwnerBrowserReturn(
  deps: StageDeps,
  ctx: StageContext,
  params: Record<string, string>,
): Promise<StageResponse> {
  const dialStatus = params["DialCallStatus"] || "";
  if (isAnsweredDial(dialStatus)) {
    // The browser leg answered (ownership was written by the claim callback) and has now ended.
    await rpcWithRetry(deps, "advance_inbound_route_stage", {
      p_attempt_id: ctx.attemptId, p_org_id: ctx.orgId, p_from_stage: "owner_browser", p_to_stage: "done",
      p_patch: { final_outcome: "browser_answered", outcome: { event: "dial_action", dial_call_status: dialStatus, dial_call_sid: params["DialCallSid"] || null } },
    });
    await finalizeCompleted(deps, ctx);
    return { status: 200, twiml: buildEmptyTwiml() };
  }
  const adv = await rpcWithRetry(deps, "advance_to_owner_mobile", {
    p_attempt_id: ctx.attemptId, p_org_id: ctx.orgId, p_call_row_id: ctx.callRowId,
  });
  if (adv.ok === false) {
    // Safeguard 1: an unknown commit state never forwards. Voicemail for the owner's mailbox.
    deps.log("[v2] advance_to_owner_mobile FAILED — voicemail safe path (never mobile)", { callRowId: ctx.callRowId, error: adv.error });
    await rpcWithRetry(deps, "mark_inbound_missed", {
      p_call_row_id: ctx.callRowId, p_org_id: ctx.orgId, p_reason: "no_answer",
      p_recipient_ids: ctx.agentId ? [ctx.agentId] : [], p_for_agent_id: ctx.agentId || null,
    });
    await convergeNotifications(deps, ctx.callRowId);
    return { status: 200, twiml: await voicemailTwiml(deps, ctx, ctx.agentId ? `agent:${ctx.agentId}` : "group") };
  }
  const r = asObject(adv.data) as AdvanceToMobileResult;
  await rpcWithRetry(deps, "append_inbound_provider_outcome", {
    p_attempt_id: ctx.attemptId, p_org_id: ctx.orgId,
    p_entry: { event: "dial_action", stage: "owner_browser", dial_call_status: dialStatus, dial_call_sid: params["DialCallSid"] || null, advance: r.reason ?? (r.forward ? "forward" : "refused") },
  });
  const owner = (r.owner as string | null) || ctx.agentId || null;
  const next = decideOwnerBrowserReturn(r, owner, deps.settings.browserRingSeconds);
  deps.log("[v2] owner_browser return", { callRowId: ctx.callRowId, dialStatus, forward: r.forward, updated: r.updated, reason: r.reason, stage: r.stage, next: next.kind });
  if (next.kind === "mobile_dial" || next.kind === "voicemail") {
    // D13 (mobile) or the refusal's missed mark landed inside the RPC — converge now, sweep later.
    await convergeNotifications(deps, ctx.callRowId);
  }
  if (next.kind === "empty") await finalizeCompleted(deps, ctx);
  return { status: 200, twiml: await emitNext(deps, ctx, next, null) };
}

// ── stage=owner_mobile: the mobile <Dial> returned (parent action) ───────────────────────────────────
export async function handleOwnerMobileReturn(
  deps: StageDeps,
  ctx: StageContext,
  params: Record<string, string>,
  parseBridged: (raw: string | null | undefined) => boolean | null,
): Promise<StageResponse> {
  const dialStatus = params["DialCallStatus"] || "";
  const dialSid = params["DialCallSid"] || "";
  const dialDuration = parseDurationInt(params["DialCallDuration"]);
  const bridged = parseBridged(params["DialBridged"]);
  const rec = await rpcWithRetry(deps, "record_inbound_mobile_bridge", {
    p_attempt_id: ctx.attemptId, p_org_id: ctx.orgId, p_call_row_id: ctx.callRowId, p_agent_id: ctx.agentId || null,
    p_dial_bridged: bridged, p_dial_call_status: dialStatus, p_dial_call_sid: dialSid || null, p_dial_call_duration: dialDuration,
    p_parent_call_sid: ctx.parentCallSid || null,
  });
  let evidence = "unconfirmed";
  let identityRefused: string | null = null;
  if (rec.ok === true) {
    const d = asObject(rec.data);
    evidence = String(d.evidence ?? "unconfirmed");
    if (d.reason === "parent_sid_mismatch" || d.reason === "child_sid_mismatch" || d.reason === "agent_mismatch" || d.reason === "attempt_not_found") {
      identityRefused = String(d.reason);
    }
  } else if (rec.ok === false) deps.log("[v2] record_inbound_mobile_bridge FAILED — evidence treated as unconfirmed", { callRowId: ctx.callRowId, error: rec.error });
  const attempt = await deps.loadAttempt(ctx.attemptId);
  // A Dial action whose DialCallSid is not the accepted child (or whose parent does not match) attributes
  // NOTHING (defect 5): the caller is routed to voicemail and the attempt records why.
  const decision = identityRefused
    ? { next: "voicemail" as const, toStage: "owner_voicemail" as const, finalOutcome: `mobile_${identityRefused}` }
    : decideMobileReturn({ evidence, acceptResult: attempt?.mobile_accept_result ?? null, dialCallStatus: dialStatus });
  deps.log("[v2] owner_mobile return", { callRowId: ctx.callRowId, dialStatus, dialBridged: bridged, evidence, identityRefused, accept: attempt?.mobile_accept_result ?? null, next: decision.next });
  const adv = await rpcWithRetry(deps, "advance_inbound_route_stage", {
    p_attempt_id: ctx.attemptId, p_org_id: ctx.orgId, p_from_stage: "owner_mobile", p_to_stage: decision.toStage,
    p_patch: {
      final_outcome: decision.toStage === "done" ? decision.finalOutcome : null,
      voicemail_kind: decision.toStage === "owner_voicemail" ? "agent" : null,
      voicemail_agent_id: decision.toStage === "owner_voicemail" ? (ctx.agentId || null) : null,
      outcome: { event: "dial_action", stage: "owner_mobile", dial_call_status: dialStatus, dial_bridged: bridged, evidence, dial_call_sid: dialSid || null, dial_call_duration: dialDuration },
    },
  });
  if (adv.ok) {
    const a = asObject(adv.data);
    if (a.updated === false && a.stage !== decision.toStage) {
      // duplicate delivery: follow the persisted stage
      const persisted = attempt ? { ...attempt, stage: String(a.stage) } : null;
      if (persisted) {
        const next = nextForPersistedStage(persisted, deps.settings.browserRingSeconds);
        return { status: 200, twiml: await emitNext(deps, ctx, next, persisted) };
      }
    }
  }
  if (decision.next === "hangup") {
    await finalizeCompleted(deps, ctx);
    await convergeNotifications(deps, ctx.callRowId);
    return { status: 200, twiml: buildEmptyTwiml() };
  }
  await convergeNotifications(deps, ctx.callRowId);
  return { status: 200, twiml: await voicemailTwiml(deps, ctx, ctx.agentId ? `agent:${ctx.agentId}` : mailboxForAttempt(attempt ?? { mode: "owner", owner_agent_id: null, voicemail_kind: "agent", voicemail_agent_id: null })) };
}

// ── stage=mobile_whisper: executed on the CALLED leg (Press 1) ───────────────────────────────────────
export async function handleMobileWhisper(
  deps: StageDeps,
  ctx: StageContext,
  params: Record<string, string>,
  isGatherAction: boolean,
): Promise<StageResponse> {
  const q = ctxQuery(ctx);
  if (!isGatherAction) {
    // Identity binding (defect 5) BEFORE any TwiML: this child leg must belong to this attempt's parent and
    // must have been dialed to the destination snapshot; an already-bound child SID must match. An empty
    // response here would BRIDGE, so every refusal is an explicit <Hangup/>.
    const attempt = await deps.loadAttempt(ctx.attemptId);
    const dialed = phoneDigitsE164ish(attempt?.mobile_number_dialed);
    const to = phoneDigitsE164ish(params["To"]);
    const bound = (attempt?.mobile_child_call_sid || "").trim();
    const child = (params["CallSid"] || "").trim();
    if (!attempt || attempt.stage !== "owner_mobile" || attempt.terminal || !dialed || dialed !== to || (bound && child && bound !== child)) {
      deps.log("[v2] whisper identity refused — hanging up the child leg", { callRowId: ctx.callRowId, stage: attempt?.stage ?? null, to: !!to, dialedMatches: !!dialed && dialed === to, boundMatches: !bound || !child || bound === child });
      return { status: 200, twiml: buildWhisperRejectTwiml("Sorry, this call could not be connected. Goodbye.") };
    }
    return {
      status: 200,
      twiml: buildMobileWhisperTwiml({
        gatherActionUrl: deps.urls.stage({ stage: "mobile_whisper", gather: "1", ...q }),
        callerLabel: spokenCallerLabel(ctx.fromNumber),
      }),
    };
  }
  const rec = await rpcWithRetry(deps, "record_inbound_mobile_accept", {
    p_attempt_id: ctx.attemptId, p_org_id: ctx.orgId, p_call_row_id: ctx.callRowId, p_agent_id: ctx.agentId || null,
    p_child_call_sid: params["CallSid"] || "", p_digits: params["Digits"] ?? "",
    p_parent_call_sid: ctx.parentCallSid || null, p_to_number: params["To"] || null,
  });
  if (rec.ok === false) {
    // An acceptance the database could not record is never bridged (busy/attribution would be wrong).
    deps.log("[v2] record_inbound_mobile_accept FAILED — refusing bridge", { callRowId: ctx.callRowId, error: rec.error });
    return { status: 200, twiml: buildWhisperRejectTwiml("Sorry, this call could not be connected. Goodbye.") };
  }
  const r = asObject(rec.data) as { accept?: boolean; result?: string; reason?: string; caller_present?: boolean; idempotent?: boolean };
  // `accept` is the database's bridge PERMISSION: a replayed Gather after the caller hung up returns
  // accept:false with the original acceptance fact preserved in `result` (defect 5).
  const decision = decideWhisperResponse(r);
  deps.log("[v2] whisper", { callRowId: ctx.callRowId, digits: (params["Digits"] ?? "").slice(0, 4), result: r.result ?? r.reason, callerPresent: r.caller_present ?? null, idempotent: r.idempotent ?? false, decision });
  return { status: 200, twiml: decision === "bridge" ? buildWhisperAcceptTwiml() : buildWhisperRejectTwiml() };
}

// ── stage=mobile_leg_status: child-leg lifecycle (statusCallback, not TwiML) ─────────────────────────
export async function handleMobileLegStatus(
  deps: StageDeps,
  ctx: StageContext,
  params: Record<string, string>,
): Promise<StageResponse> {
  const callStatus = params["CallStatus"] || "";
  const childSid = params["CallSid"] || "";
  const duration = parseDurationInt(params["CallDuration"]);
  const r = isTerminalLegStatus(callStatus)
    ? await rpcWithRetry(deps, "record_inbound_mobile_leg_end", {
        p_attempt_id: ctx.attemptId, p_org_id: ctx.orgId, p_child_call_sid: childSid, p_call_status: callStatus, p_call_duration: duration,
        p_parent_call_sid: ctx.parentCallSid || null,
      })
    : await rpcWithRetry(deps, "append_inbound_provider_outcome", {
        p_attempt_id: ctx.attemptId, p_org_id: ctx.orgId,
        p_entry: { event: "mobile_leg_status", call_status: callStatus, child_sid: childSid },
      });
  if (r.ok === false) {
    deps.log("[v2] mobile leg status write FAILED — 503 for redelivery", { callRowId: ctx.callRowId, callStatus, error: r.error });
    return { status: 503, twiml: buildEmptyTwiml() };
  }
  return { status: 200, twiml: buildEmptyTwiml() };
}

// ── stage=group_browser: the simultaneous group wave returned ────────────────────────────────────────
export async function handleGroupBrowserReturn(
  deps: StageDeps,
  ctx: StageContext,
  params: Record<string, string>,
): Promise<StageResponse> {
  const dialStatus = params["DialCallStatus"] || "";
  if (isAnsweredDial(dialStatus)) {
    await rpcWithRetry(deps, "advance_inbound_route_stage", {
      p_attempt_id: ctx.attemptId, p_org_id: ctx.orgId, p_from_stage: "group_browser", p_to_stage: "done",
      p_patch: { final_outcome: "browser_answered", outcome: { event: "dial_action", dial_call_status: dialStatus, dial_call_sid: params["DialCallSid"] || null } },
    });
    await finalizeCompleted(deps, ctx);
    return { status: 200, twiml: buildEmptyTwiml() };
  }
  const attempt = await deps.loadAttempt(ctx.attemptId);
  const rung = (attempt?.reserved_agent_ids || []).filter((x) => typeof x === "string" && x.length > 0);
  const adv = await rpcWithRetry(deps, "advance_inbound_route_stage", {
    p_attempt_id: ctx.attemptId, p_org_id: ctx.orgId, p_from_stage: "group_browser", p_to_stage: "group_voicemail",
    p_patch: { voicemail_kind: "group", voicemail_group_ids: rung, outcome: { event: "dial_action", dial_call_status: dialStatus, dial_call_sid: params["DialCallSid"] || null } },
  });
  if (adv.ok) {
    const a = asObject(adv.data);
    if (a.updated === false && a.stage !== "group_voicemail" && attempt) {
      const persisted = { ...attempt, stage: String(a.stage) };
      if (persisted.stage === "group_browser") {
        // stage_mismatch while still ringing per the database: never re-ring from a return
        return { status: 200, twiml: await voicemailTwiml(deps, ctx, "group") };
      }
      const next = nextForPersistedStage(persisted, deps.settings.browserRingSeconds);
      if (next.kind === "empty") await finalizeCompleted(deps, ctx);
      return { status: 200, twiml: await emitNext(deps, ctx, next, persisted) };
    }
  }
  await rpcWithRetry(deps, "mark_inbound_missed", {
    p_call_row_id: ctx.callRowId, p_org_id: ctx.orgId, p_reason: "no_answer", p_recipient_ids: rung, p_for_agent_id: null,
  });
  await convergeNotifications(deps, ctx.callRowId);
  return { status: 200, twiml: await voicemailTwiml(deps, ctx, "group") };
}

// ── stage=voicemail_done: <Record action> — the message is in; the recording callback stores it ──────
export async function handleVoicemailDone(deps: StageDeps, ctx: StageContext, params: Record<string, string>): Promise<StageResponse> {
  const attempt = ctx.attemptId ? await deps.loadAttempt(ctx.attemptId) : null;
  if (attempt && !attempt.terminal && (attempt.stage === "owner_voicemail" || attempt.stage === "group_voicemail")) {
    await rpcWithRetry(deps, "advance_inbound_route_stage", {
      p_attempt_id: ctx.attemptId, p_org_id: ctx.orgId, p_from_stage: attempt.stage, p_to_stage: "done",
      p_patch: { final_outcome: "voicemail_left", outcome: { event: "record_action", recording_sid: params["RecordingSid"] || null, duration: params["RecordingDuration"] || null } },
    });
  }
  await finalizeCompleted(deps, ctx);
  await convergeNotifications(deps, ctx.callRowId);
  return { status: 200, twiml: buildEmptyTwiml() };
}
