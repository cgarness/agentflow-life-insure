// Inbound Calling v2 stage machine — fail-first tests (implementation_plan.md rev 3 §8.1/§8.3/§9,
// §12 `inboundStages.test.ts`; safeguards 1 and 5). The database is faked through the injected RPC so
// every branch is exercised with the EXACT result shapes the M6 functions return.
import { describe, expect, it } from "vitest";
import {
  decideMobileReturn,
  decideOwnerBrowserReturn,
  decideWhisperResponse,
  mailboxForAttempt,
  nextForPersistedStage,
  parseMailbox,
  resolveOwnerCandidate,
  voicemailCallbackQuery,
} from "../../../supabase/functions/twilio-voice-inbound/planner";
import {
  StageDeps,
  handleGroupBrowserReturn,
  handleInitialV2,
  handleMobileLegStatus,
  handleMobileWhisper,
  handleOwnerBrowserReturn,
  handleOwnerMobileReturn,
  handleVoicemailDone,
} from "../../../supabase/functions/twilio-voice-inbound/stages";
import { parseDialBridged } from "../../../supabase/functions/twilio-voice-inbound/twiml";

const A1 = "aaaaaaaa-0000-0000-0000-0000000000a1";
const A2 = "aaaaaaaa-0000-0000-0000-0000000000a2";
const A3 = "aaaaaaaa-0000-0000-0000-0000000000a3";
const ORG = "aaaaaaaa-0000-0000-0000-00000000000a";
const CALL = "cccccccc-0000-0000-0000-000000000001";
const ATT = "eeeeeeee-0000-0000-0000-000000000001";
const MOBILE = "+15559990001";

type RpcScript = Record<string, (args: Record<string, unknown>) => { data?: unknown; error?: { message: string } } | Promise<{ data?: unknown; error?: { message: string } }>>;

function attempt(over: Record<string, unknown> = {}) {
  return {
    id: ATT, stage: "owner_browser", mode: "owner", owner_agent_id: A1, reserved_agent_ids: [A1],
    browser_ring_timeout_sent: 20, mobile_number_dialed: null, voicemail_kind: null, voicemail_agent_id: null,
    voicemail_group_ids: [], mobile_accept_result: null, mobile_bridge_evidence: null, terminal: false, ...over,
  };
}

function makeDeps(script: RpcScript, opts: { persist?: boolean; identities?: string[]; attemptRow?: ReturnType<typeof attempt> | null } = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const logs: string[] = [];
  const deps: StageDeps = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      const fn = script[name];
      if (!fn) return { data: { updated: true }, error: null };
      const r = await fn(args);
      return { data: r.data ?? null, error: r.error ?? null };
    },
    loadAttempt: async () => opts.attemptRow === undefined ? attempt() : opts.attemptRow,
    resolveIdentities: async (ids) => ids.filter((id) => (opts.identities ?? [A1, A2, A3]).includes(id)).map((id) => ({ agentId: id, identity: `agent_${id.slice(-2)}` })),
    persistRoutedAgents: async () => opts.persist ?? true,
    loadAgentGreeting: async () => ({ text: null, url: null }),
    urls: {
      stage: (q) => `https://x.supabase.co/functions/v1/twilio-voice-inbound?${new URLSearchParams(q).toString()}`,
      recordingStatus: (q) => `https://x.supabase.co/functions/v1/twilio-recording-status${Object.keys(q).length ? `?${new URLSearchParams(q).toString()}` : ""}`,
      claimCallbackBase: "https://x.supabase.co/functions/v1/inbound-call-claim",
    },
    settings: { browserRingSeconds: 20, mobileRingSeconds: 20, recordingEnabled: true, greetingText: "Org greeting", greetingUrl: "" },
    log: (m) => { logs.push(m); },
    sleep: async () => {},
  };
  return { deps, calls, logs };
}

const PARENT_SID = "CA" + "a".repeat(32);
const ctx = { callRowId: CALL, orgId: ORG, attemptId: ATT, agentId: A1, fromNumber: "+19995551234", parentCallSid: PARENT_SID };
const isMobileDial = (xml: string) => xml.includes("<Number ") && xml.includes(MOBILE);
const isVoicemail = (xml: string) => xml.includes("<Record ") && xml.includes("source=voicemail");
const isClientDial = (xml: string) => xml.includes("<Client ");

/** The signed recording-callback query of a voicemail TwiML: XML-unescaped, fragment (#rc=…) stripped. */
function recordingCallbackQuery(xml: string): string {
  const m = /<Record [^>]*recordingStatusCallback="([^"]*)"/.exec(xml);
  if (!m) throw new Error("no <Record recordingStatusCallback> in TwiML");
  const url = m[1].replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const noFragment = url.split("#")[0];
  const q = noFragment.indexOf("?");
  return q === -1 ? "" : noFragment.slice(q + 1);
}

/**
 * Agent-voicemail callback repair (2026-09-30): every signed callback key and value is [A-Za-z0-9._-], so no
 * serializer percent-encodes it and no canonicalization can change the signed bytes. Returns the violations.
 */
function callbackQueryViolations(query: string): string[] {
  const bad: string[] = [];
  if (query.includes("%")) bad.push("percent-encoded byte");
  for (const part of query.split("&")) {
    const eq = part.indexOf("=");
    const [k, v] = eq === -1 ? [part, ""] : [part.slice(0, eq), part.slice(eq + 1)];
    if (!/^[A-Za-z0-9._-]+$/.test(k)) bad.push(`key ${k}`);
    if (!/^[A-Za-z0-9._-]+$/.test(v)) bad.push(`value of ${k}`);
  }
  return bad;
}

const agentQuery = (attemptId: string | null = ATT) =>
  `source=voicemail&mailbox=agent&mailbox_agent_id=${A1}&call_row_id=${CALL}&org_id=${ORG}${attemptId ? `&attempt_id=${attemptId}` : ""}`;
const groupQuery = (attemptId: string | null = ATT) =>
  `source=voicemail&mailbox=group&call_row_id=${CALL}&org_id=${ORG}${attemptId ? `&attempt_id=${attemptId}` : ""}`;

describe("S0 — owner resolution (P1 direct line > D2 contact owner > D5 group)", () => {
  it("direct line wins, contact owner second, nobody ⇒ group", () => {
    expect(resolveOwnerCandidate({ isDirectLine: true, numberAssignedTo: A2, contactAssignedAgentId: A1 })).toEqual({ ownerAgentId: A2, ownerSource: "direct_line" });
    expect(resolveOwnerCandidate({ isDirectLine: false, numberAssignedTo: A2, contactAssignedAgentId: A1 })).toEqual({ ownerAgentId: A1, ownerSource: "contact" });
    expect(resolveOwnerCandidate({ isDirectLine: false, numberAssignedTo: A2, contactAssignedAgentId: null })).toEqual({ ownerAgentId: null, ownerSource: null });
  });
  it("mailbox identifiers round-trip and reject anything else", () => {
    expect(mailboxForAttempt(attempt())).toBe(`agent:${A1}`);
    expect(mailboxForAttempt(attempt({ mode: "group", owner_agent_id: null, voicemail_kind: "group" }))).toBe("group");
    expect(parseMailbox(`agent:${A1}`)).toEqual({ kind: "agent", agentId: A1 });
    expect(parseMailbox("group")).toEqual({ kind: "group" });
    expect(parseMailbox("agent:+15559990001")).toBeNull();
    expect(parseMailbox("")).toBeNull();
  });
});

describe("S1 — initial inbound: the planner's persisted stage decides the TwiML", () => {
  it("owner_browser ⇒ routed persistence FIRST, then a <Client> wave with the 20 s window and the stage action", async () => {
    const { deps, calls } = makeDeps({ plan_inbound_route: () => ({ data: { created: true, stage: "owner_browser", attempt: attempt(), targets: [A1] } }) });
    const order: string[] = [];
    deps.persistRoutedAgents = async () => { order.push("persist"); return true; };
    const origResolve = deps.resolveIdentities;
    deps.resolveIdentities = async (ids) => { order.push("identities"); return origResolve(ids); };
    const r = await handleInitialV2(deps, { callRowId: CALL, orgId: ORG, parentCallSid: PARENT_SID, ownerAgentId: A1, ownerSource: "contact", groupIds: [A2, A3], fromNumber: "+19995551234" });
    expect(r.status).toBe(200);
    expect(isClientDial(r.twiml)).toBe(true);
    expect(r.twiml).toContain('<Dial timeout="20"');
    expect(r.twiml).toContain("stage=owner_browser");
    expect(order).toEqual(["persist", "identities"]);
    expect(calls[0]).toMatchObject({ name: "plan_inbound_route", args: { p_owner_agent_id: A1, p_owner_source: "contact", p_candidate_group_ids: [A2, A3], p_browser_ring_seconds: 20 } });
    expect(calls.map((c) => c.name)).not.toContain("converge_inbound_notifications");
  });

  it("immediate offline forwarding: attempt born in owner_mobile with the D13 snapshot ⇒ converge notifications, then the mobile <Dial> from the SNAPSHOT", async () => {
    const { deps, calls } = makeDeps({
      plan_inbound_route: () => ({ data: { created: true, stage: "owner_mobile", mobile: MOBILE, attempt: attempt({ stage: "owner_mobile", reserved_agent_ids: [A1], mobile_number_dialed: MOBILE }) } }),
    });
    const r = await handleInitialV2(deps, { callRowId: CALL, orgId: ORG, parentCallSid: PARENT_SID, ownerAgentId: A1, ownerSource: "contact", groupIds: [], fromNumber: "+19995551234" });
    expect(isMobileDial(r.twiml)).toBe(true);
    expect(/record/i.test(r.twiml)).toBe(false);
    expect(calls.map((c) => c.name)).toEqual(["plan_inbound_route", "converge_inbound_notifications"]);
    expect(r.twiml).toContain(`stage=owner_mobile&amp;call_row_id=${CALL}&amp;org_id=${ORG}&amp;attempt_id=${ATT}&amp;agent_id=${A1}`);
  });

  it("owner_voicemail (DND/busy) ⇒ converge, then voicemail TwiML whose signed recording URL names the OWNER mailbox", async () => {
    const { deps, calls } = makeDeps({
      plan_inbound_route: () => ({ data: { created: true, stage: "owner_voicemail", attempt: attempt({ stage: "owner_voicemail", reserved_agent_ids: [], voicemail_kind: "agent", voicemail_agent_id: A1 }) } }),
    });
    const r = await handleInitialV2(deps, { callRowId: CALL, orgId: ORG, parentCallSid: PARENT_SID, ownerAgentId: A1, ownerSource: "contact", groupIds: [], fromNumber: "" });
    expect(isVoicemail(r.twiml)).toBe(true);
    expect(recordingCallbackQuery(r.twiml)).toBe(agentQuery());
    expect(r.twiml).not.toContain("agent%3A");
    expect(r.twiml).toContain(`stage=voicemail_done`);
    expect(calls.map((c) => c.name)).toEqual(["plan_inbound_route", "converge_inbound_notifications"]);
  });

  it("group_browser ⇒ one simultaneous wave for exactly the reserved members (D10)", async () => {
    const { deps } = makeDeps({
      plan_inbound_route: () => ({ data: { created: true, stage: "group_browser", attempt: attempt({ stage: "group_browser", mode: "group", owner_agent_id: null, reserved_agent_ids: [A2, A3] }) } }),
    });
    const r = await handleInitialV2(deps, { callRowId: CALL, orgId: ORG, parentCallSid: PARENT_SID, ownerAgentId: null, ownerSource: null, groupIds: [A2, A3], fromNumber: "" });
    expect((r.twiml.match(/<Client /g) || []).length).toBe(2);
    expect(r.twiml).toContain("stage=group_browser");
    expect(r.twiml).not.toContain(`agent_id=${A1}`);
  });

  it("group_voicemail (nobody eligible) ⇒ group mailbox voicemail", async () => {
    const { deps } = makeDeps({
      plan_inbound_route: () => ({ data: { created: true, stage: "group_voicemail", attempt: attempt({ stage: "group_voicemail", mode: "group", owner_agent_id: null, reserved_agent_ids: [], voicemail_kind: "group", voicemail_group_ids: [A2, A3] }) } }),
    });
    const r = await handleInitialV2(deps, { callRowId: CALL, orgId: ORG, parentCallSid: PARENT_SID, ownerAgentId: null, ownerSource: null, groupIds: [A2, A3], fromNumber: "" });
    expect(isVoicemail(r.twiml)).toBe(true);
    // byte-identical to the group query issued before the 2026-09-30 repair
    expect(recordingCallbackQuery(r.twiml)).toBe(groupQuery());
  });

  it("duplicate initial webhook (created=false) re-emits the PERSISTED stage and writes nothing new", async () => {
    const { deps, calls } = makeDeps({
      plan_inbound_route: () => ({ data: { created: false, stage: "owner_mobile", attempt: attempt({ stage: "owner_mobile", mobile_number_dialed: MOBILE }) } }),
    });
    const r = await handleInitialV2(deps, { callRowId: CALL, orgId: ORG, parentCallSid: PARENT_SID, ownerAgentId: A1, ownerSource: "contact", groupIds: [], fromNumber: "" });
    expect(isMobileDial(r.twiml)).toBe(true);
    expect(calls.filter((c) => c.name !== "plan_inbound_route" && c.name !== "converge_inbound_notifications")).toEqual([]);
  });

  it("planner failure after 3 retries ⇒ missed for the intended recipients + voicemail; NEVER a mobile <Dial>, no attempt id in the URL", async () => {
    let n = 0;
    const { deps, calls } = makeDeps({ plan_inbound_route: () => { n++; return { error: { message: "db down" } }; } });
    const r = await handleInitialV2(deps, { callRowId: CALL, orgId: ORG, parentCallSid: PARENT_SID, ownerAgentId: A1, ownerSource: "contact", groupIds: [], fromNumber: "" });
    expect(n).toBe(3);
    expect(isVoicemail(r.twiml)).toBe(true);
    expect(isMobileDial(r.twiml)).toBe(false);
    expect(r.twiml).not.toContain("attempt_id=");
    expect(recordingCallbackQuery(r.twiml)).toBe(agentQuery(null));
    expect(calls.find((c) => c.name === "mark_inbound_missed")?.args).toMatchObject({ p_reason: "no_answer", p_recipient_ids: [A1], p_for_agent_id: A1 });
  });

  it("R14: routed persistence failure suppresses the wave — voicemail, stage moved, missed marked for the reserved agents", async () => {
    const { deps, calls } = makeDeps({ plan_inbound_route: () => ({ data: { created: true, stage: "owner_browser", attempt: attempt() } }) }, { persist: false });
    const r = await handleInitialV2(deps, { callRowId: CALL, orgId: ORG, parentCallSid: PARENT_SID, ownerAgentId: A1, ownerSource: "contact", groupIds: [], fromNumber: "" });
    expect(isClientDial(r.twiml)).toBe(false);
    expect(isVoicemail(r.twiml)).toBe(true);
    expect(calls.find((c) => c.name === "advance_inbound_route_stage")?.args).toMatchObject({ p_from_stage: "owner_browser", p_to_stage: "owner_voicemail" });
    expect(calls.find((c) => c.name === "mark_inbound_missed")?.args).toMatchObject({ p_recipient_ids: [A1] });
  });
});

describe("S2 — owner_browser return: forwarding ONLY on the database's atomic commit (safeguard 1)", () => {
  it("no answer + {updated:true, forward:true, mobile} ⇒ converge D13 rows, then the mobile <Dial> from the returned snapshot", async () => {
    const { deps, calls } = makeDeps({ advance_to_owner_mobile: () => ({ data: { updated: true, forward: true, stage: "owner_mobile", mobile: MOBILE, owner: A1 } }) });
    const r = await handleOwnerBrowserReturn(deps, ctx, { DialCallStatus: "no-answer" });
    expect(isMobileDial(r.twiml)).toBe(true);
    expect(calls.map((c) => c.name)).toContain("converge_inbound_notifications");
  });

  it("refusal {updated:true, forward:false, stage:owner_voicemail} (DND set during the ring / busy / no mobile) ⇒ owner voicemail", async () => {
    for (const reason of ["dnd", "busy", "no_mobile"]) {
      const { deps } = makeDeps({ advance_to_owner_mobile: () => ({ data: { updated: true, forward: false, reason, stage: "owner_voicemail", owner: A1 } }) });
      const r = await handleOwnerBrowserReturn(deps, ctx, { DialCallStatus: "no-answer" });
      expect(isVoicemail(r.twiml)).toBe(true);
      expect(recordingCallbackQuery(r.twiml)).toBe(agentQuery());
      expect(isMobileDial(r.twiml)).toBe(false);
    }
  });

  it("zero-row {updated:false, reason:stage_mismatch, stage:owner_mobile, mobile} (duplicate Dial action) ⇒ re-emits the persisted mobile stage", async () => {
    const { deps } = makeDeps({ advance_to_owner_mobile: () => ({ data: { updated: false, reason: "stage_mismatch", stage: "owner_mobile", terminal: false, mobile: MOBILE } }) });
    const r = await handleOwnerBrowserReturn(deps, ctx, { DialCallStatus: "no-answer" });
    expect(isMobileDial(r.twiml)).toBe(true);
  });

  it("zero-row with stage owner_voicemail / done follows the persisted stage; call_not_forwardable (browser claim landed) ends the parent", async () => {
    const vm = makeDeps({ advance_to_owner_mobile: () => ({ data: { updated: false, reason: "stage_mismatch", stage: "owner_voicemail", terminal: false } }) });
    expect(isVoicemail((await handleOwnerBrowserReturn(vm.deps, ctx, { DialCallStatus: "no-answer" })).twiml)).toBe(true);
    const done = makeDeps({ advance_to_owner_mobile: () => ({ data: { updated: false, reason: "stage_mismatch", stage: "done", terminal: true } }) });
    expect((await handleOwnerBrowserReturn(done.deps, ctx, { DialCallStatus: "no-answer" })).twiml).toContain("<Response></Response>");
    const claimed = makeDeps({ advance_to_owner_mobile: () => ({ data: { updated: false, forward: false, reason: "call_not_forwardable", stage: "owner_browser", terminal: false } }) });
    const r = await handleOwnerBrowserReturn(claimed.deps, ctx, { DialCallStatus: "no-answer" });
    expect(r.twiml).toContain("<Response></Response>");
    expect(isMobileDial(r.twiml)).toBe(false);
  });

  it("D13 commit failure (RPC error after retries) ⇒ voicemail TwiML, never the mobile <Dial>", async () => {
    const { deps, calls } = makeDeps({ advance_to_owner_mobile: () => ({ error: { message: "deadlock" } }) });
    const r = await handleOwnerBrowserReturn(deps, ctx, { DialCallStatus: "no-answer" });
    expect(calls.filter((c) => c.name === "advance_to_owner_mobile")).toHaveLength(3);
    expect(isVoicemail(r.twiml)).toBe(true);
    expect(isMobileDial(r.twiml)).toBe(false);
  });

  it("an ANSWERED browser return never forwards: attempt → done, parent finalized completed, empty TwiML", async () => {
    const { deps, calls } = makeDeps({});
    const r = await handleOwnerBrowserReturn(deps, ctx, { DialCallStatus: "completed", DialCallSid: "CA" + "1".repeat(32) });
    expect(r.twiml).toContain("<Response></Response>");
    expect(calls.map((c) => c.name)).toEqual(["advance_inbound_route_stage", "finalize_inbound_call_terminal"]);
    expect(calls[0].args).toMatchObject({ p_from_stage: "owner_browser", p_to_stage: "done" });
    expect(calls[1].args).toMatchObject({ p_status: "completed", p_mark_missed: false, p_external_answer: false });
  });

  it("pure decision table: the mobile dial needs BOTH updated:true and forward:true and a snapshot", () => {
    expect(decideOwnerBrowserReturn({ updated: true, forward: true, mobile: MOBILE }, A1, 20)).toEqual({ kind: "mobile_dial", mobile: MOBILE });
    expect(decideOwnerBrowserReturn({ updated: true, forward: true, mobile: "" }, A1, 20)).toEqual({ kind: "voicemail", mailbox: `agent:${A1}` });
    expect(decideOwnerBrowserReturn({ updated: false, forward: true, mobile: MOBILE, reason: "stage_conflict", stage: "owner_browser" }, A1, 20)).toEqual({ kind: "voicemail", mailbox: `agent:${A1}` });
    expect(decideOwnerBrowserReturn(null, A1, 20)).toEqual({ kind: "voicemail", mailbox: `agent:${A1}` });
  });
});

describe("S3 — owner_mobile return: DialBridged evidence (safeguard 5)", () => {
  const mobileAttempt = (accept: string | null) => attempt({ stage: "owner_mobile", mobile_number_dialed: MOBILE, mobile_accept_result: accept });

  it("DialBridged=true for an accepted leg ⇒ dial_bridged: attempt done, parent finalized, empty TwiML (no voicemail after a conversation)", async () => {
    const { deps, calls } = makeDeps({ record_inbound_mobile_bridge: () => ({ data: { bridged: true, evidence: "dial_bridged", attributed: true } }) }, { attemptRow: mobileAttempt("accepted") });
    const r = await handleOwnerMobileReturn(deps, ctx, { DialCallStatus: "completed", DialCallSid: "CA" + "c".repeat(32), DialCallDuration: "42", DialBridged: "true" }, parseDialBridged);
    expect(r.twiml).toContain("<Response></Response>");
    expect(calls.find((c) => c.name === "record_inbound_mobile_bridge")?.args).toMatchObject({ p_dial_bridged: true, p_dial_call_status: "completed", p_dial_call_duration: 42, p_agent_id: A1 });
    expect(calls.find((c) => c.name === "advance_inbound_route_stage")?.args).toMatchObject({ p_from_stage: "owner_mobile", p_to_stage: "done", p_patch: { final_outcome: "mobile_bridged" } });
    expect(calls.map((c) => c.name)).toContain("finalize_inbound_call_terminal");
  });

  it("DialBridged=false (machine pickup, no Press 1) ⇒ not_bridged: owner voicemail, NO new missed mark (D13 already holds)", async () => {
    const { deps, calls } = makeDeps({ record_inbound_mobile_bridge: () => ({ data: { bridged: false, evidence: "not_bridged", attributed: false } }) }, { attemptRow: mobileAttempt("no_digit") });
    const r = await handleOwnerMobileReturn(deps, ctx, { DialCallStatus: "completed", DialBridged: "false" }, parseDialBridged);
    expect(isVoicemail(r.twiml)).toBe(true);
    expect(calls.map((c) => c.name)).not.toContain("mark_inbound_missed");
    expect(calls.find((c) => c.name === "advance_inbound_route_stage")?.args).toMatchObject({ p_to_stage: "owner_voicemail" });
  });

  it("DialBridged ABSENT ⇒ the field is passed as null (unconfirmed) — never guessed true", async () => {
    const { deps, calls } = makeDeps({ record_inbound_mobile_bridge: () => ({ data: { bridged: false, evidence: "unconfirmed", attributed: false } }) }, { attemptRow: mobileAttempt("no_digit") });
    const r = await handleOwnerMobileReturn(deps, ctx, { DialCallStatus: "no-answer" }, parseDialBridged);
    expect(calls.find((c) => c.name === "record_inbound_mobile_bridge")?.args).toMatchObject({ p_dial_bridged: null });
    expect(isVoicemail(r.twiml)).toBe(true);
  });

  it("unconfirmed + accepted + documented 'completed' ⇒ the parent ends WITHOUT attribution; unconfirmed otherwise ⇒ voicemail", () => {
    expect(decideMobileReturn({ evidence: "unconfirmed", acceptResult: "accepted", dialCallStatus: "completed" })).toEqual({ next: "hangup", toStage: "done", finalOutcome: "mobile_unconfirmed_ended" });
    expect(decideMobileReturn({ evidence: "unconfirmed", acceptResult: "accepted", dialCallStatus: "no-answer" })).toMatchObject({ next: "voicemail", toStage: "owner_voicemail" });
    expect(decideMobileReturn({ evidence: "unconfirmed", acceptResult: "no_digit", dialCallStatus: "completed" })).toMatchObject({ next: "voicemail", finalOutcome: "mobile_unconfirmed" });
    expect(decideMobileReturn({ evidence: "not_bridged", acceptResult: "accepted", dialCallStatus: "completed" })).toMatchObject({ next: "voicemail", finalOutcome: "mobile_not_bridged" });
    expect(decideMobileReturn({ evidence: "dial_bridged", acceptResult: "accepted", dialCallStatus: "completed" })).toMatchObject({ next: "hangup" });
  });

  it("bridge RPC failure is treated as unconfirmed evidence (no attribution) and still serves safe TwiML", async () => {
    const { deps } = makeDeps({ record_inbound_mobile_bridge: () => ({ error: { message: "timeout" } }) }, { attemptRow: mobileAttempt("no_digit") });
    const r = await handleOwnerMobileReturn(deps, ctx, { DialCallStatus: "completed", DialBridged: "true" }, parseDialBridged);
    expect(isVoicemail(r.twiml)).toBe(true);
  });
});

describe("S4 — whisper (P6) and child-leg lifecycle", () => {
  it("first request serves the Gather; the action request records the digits and bridges ONLY on a recorded `accepted`", async () => {
    const { deps } = makeDeps({ record_inbound_mobile_accept: () => ({ data: { accept: true, result: "accepted" } }) },
      { attemptRow: attempt({ stage: "owner_mobile", mobile_number_dialed: MOBILE }) });
    const g = await handleMobileWhisper(deps, ctx, { CallSid: "CA" + "c".repeat(32), ParentCallSid: PARENT_SID, To: MOBILE }, false);
    expect(g.twiml).toContain("<Gather ");
    expect(g.twiml).toContain("gather=1");
    const a = await handleMobileWhisper(deps, ctx, { CallSid: "CA" + "c".repeat(32), Digits: "1" }, true);
    expect(a.twiml).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  });

  it("no digit / wrong digit / Press 1 after the caller hung up / unrecorded ⇒ hang up, never bridge", async () => {
    for (const result of ["no_digit", "wrong_digit", "accepted_after_hangup"]) {
      const { deps } = makeDeps({ record_inbound_mobile_accept: () => ({ data: { accept: false, result } }) });
      const r = await handleMobileWhisper(deps, ctx, { CallSid: "CA" + "c".repeat(32), Digits: "" }, true);
      expect(r.twiml).toContain("<Hangup/>");
    }
    const failing = makeDeps({ record_inbound_mobile_accept: () => ({ error: { message: "db" } }) });
    const r = await handleMobileWhisper(failing.deps, ctx, { CallSid: "CA" + "c".repeat(32), Digits: "1" }, true);
    expect(r.twiml).toContain("<Hangup/>");
    expect(decideWhisperResponse({ accept: true, result: "accepted" })).toBe("bridge");
    expect(decideWhisperResponse({ accept: true, result: "accepted_after_hangup" })).toBe("hangup");
    expect(decideWhisperResponse(null)).toBe("hangup");
  });

  it("child leg statusCallback: terminal statuses release the reservation; write failure ⇒ 503 for redelivery", async () => {
    const { deps, calls } = makeDeps({});
    expect((await handleMobileLegStatus(deps, ctx, { CallSid: "CA" + "c".repeat(32), CallStatus: "ringing" })).status).toBe(200);
    expect(calls[0].name).toBe("append_inbound_provider_outcome");
    expect((await handleMobileLegStatus(deps, ctx, { CallSid: "CA" + "c".repeat(32), CallStatus: "completed", CallDuration: "61" })).status).toBe(200);
    expect(calls[1]).toMatchObject({ name: "record_inbound_mobile_leg_end", args: { p_call_status: "completed", p_call_duration: 61 } });
    const failing = makeDeps({ record_inbound_mobile_leg_end: () => ({ error: { message: "db" } }) });
    expect((await handleMobileLegStatus(failing.deps, ctx, { CallSid: "CA" + "c".repeat(32), CallStatus: "completed" })).status).toBe(503);
  });
});

describe("S5 — group wave return and voicemail completion", () => {
  it("unanswered group wave ⇒ group_voicemail, missed marked for the RUNG members, group mailbox voicemail", async () => {
    const groupAttempt = attempt({ stage: "group_browser", mode: "group", owner_agent_id: null, reserved_agent_ids: [A2, A3] });
    const { deps, calls } = makeDeps({}, { attemptRow: groupAttempt });
    const r = await handleGroupBrowserReturn(deps, { ...ctx, agentId: "" }, { DialCallStatus: "no-answer" });
    expect(isVoicemail(r.twiml)).toBe(true);
    expect(recordingCallbackQuery(r.twiml)).toBe(groupQuery());
    expect(calls.find((c) => c.name === "mark_inbound_missed")?.args).toMatchObject({ p_reason: "no_answer", p_recipient_ids: [A2, A3], p_for_agent_id: null });
    expect(calls.map((c) => c.name)).toContain("converge_inbound_notifications");
  });

  it("answered group wave ⇒ done + finalize; duplicate return on a done attempt ⇒ empty TwiML", async () => {
    const { deps, calls } = makeDeps({});
    const r = await handleGroupBrowserReturn(deps, ctx, { DialCallStatus: "completed" });
    expect(r.twiml).toContain("<Response></Response>");
    expect(calls.map((c) => c.name)).toEqual(["advance_inbound_route_stage", "finalize_inbound_call_terminal"]);
    const dup = makeDeps({ advance_inbound_route_stage: () => ({ data: { updated: false, stage: "done", terminal: true, reason: "stage_mismatch" } }) },
      { attemptRow: attempt({ stage: "done", mode: "group", terminal: true }) });
    expect((await handleGroupBrowserReturn(dup.deps, ctx, { DialCallStatus: "no-answer" })).twiml).toContain("<Response></Response>");
  });

  it("voicemail_done: attempt → done, parent finalized completed, notifications converged", async () => {
    const { deps, calls } = makeDeps({}, { attemptRow: attempt({ stage: "owner_voicemail" }) });
    const r = await handleVoicemailDone(deps, ctx, { RecordingSid: "RE" + "1".repeat(32), RecordingDuration: "12" });
    expect(r.status).toBe(200);
    expect(calls.map((c) => c.name)).toEqual(["advance_inbound_route_stage", "finalize_inbound_call_terminal", "converge_inbound_notifications"]);
    expect(calls[0].args).toMatchObject({ p_from_stage: "owner_voicemail", p_to_stage: "done" });
  });

  it("nextForPersistedStage never emits an unsnapshotted mobile dial", () => {
    expect(nextForPersistedStage(attempt({ stage: "owner_mobile", mobile_number_dialed: null }), 20)).toEqual({ kind: "voicemail", mailbox: `agent:${A1}` });
    expect(nextForPersistedStage(attempt({ stage: "owner_mobile", mobile_number_dialed: MOBILE }), 20)).toEqual({ kind: "mobile_dial", mobile: MOBILE });
    expect(nextForPersistedStage(attempt({ stage: "group_browser", reserved_agent_ids: [A2], browser_ring_timeout_sent: 25 }), 20)).toEqual({ kind: "client_dial", agentIds: [A2], timeoutSec: 25, stage: "group_browser" });
    expect(nextForPersistedStage(attempt({ stage: "done", terminal: true }), 20)).toEqual({ kind: "empty" });
  });
});

describe("S7 — agent-voicemail callback repair (2026-09-30): the signed recording callback carries only [A-Za-z0-9._-]", () => {
  const mobile = (accept: string | null) => attempt({ stage: "owner_mobile", mobile_number_dialed: MOBILE, mobile_accept_result: accept });
  const init = { callRowId: CALL, orgId: ORG, parentCallSid: PARENT_SID, ownerSource: "contact" as const, fromNumber: "" };

  // Every voicemail-TwiML call site in stages.ts (each voicemailTwiml() caller and the emitNext voicemail re-emit),
  // with the EXACT signed query it must emit (key order, attempt_id present or omitted).
  const paths: Array<[string, string, () => Promise<string>]> = [
    ["initial owner_voicemail", agentQuery(), async () => (await handleInitialV2(makeDeps({
      plan_inbound_route: () => ({ data: { created: true, stage: "owner_voicemail", attempt: attempt({ stage: "owner_voicemail", reserved_agent_ids: [], voicemail_kind: "agent", voicemail_agent_id: A1 }) } }),
    }).deps, { ...init, ownerAgentId: A1, groupIds: [] })).twiml],
    ["initial group_voicemail", groupQuery(), async () => (await handleInitialV2(makeDeps({
      plan_inbound_route: () => ({ data: { created: true, stage: "group_voicemail", attempt: attempt({ stage: "group_voicemail", mode: "group", owner_agent_id: null, reserved_agent_ids: [], voicemail_kind: "group" }) } }),
    }).deps, { ...init, ownerAgentId: null, ownerSource: null, groupIds: [A2] } as never)).twiml],
    ["planner failure, owner", agentQuery(null), async () => (await handleInitialV2(makeDeps({ plan_inbound_route: () => ({ error: { message: "db down" } }) }).deps,
      { ...init, ownerAgentId: A1, groupIds: [] })).twiml],
    ["planner failure, no owner", groupQuery(null), async () => (await handleInitialV2(makeDeps({ plan_inbound_route: () => ({ error: { message: "db down" } }) }).deps,
      { ...init, ownerAgentId: null, ownerSource: null, groupIds: [A2] } as never)).twiml],
    ["planner returned no attempt, owner", agentQuery(null), async () => (await handleInitialV2(makeDeps({ plan_inbound_route: () => ({ data: { created: false, reason: "call_terminal" } }) }).deps,
      { ...init, ownerAgentId: A1, groupIds: [] })).twiml],
    ["R14 owner wave suppressed", agentQuery(), async () => (await handleInitialV2(makeDeps({ plan_inbound_route: () => ({ data: { created: true, stage: "owner_browser", attempt: attempt() } }) }, { persist: false }).deps,
      { ...init, ownerAgentId: A1, groupIds: [] })).twiml],
    ["owner_browser refusal", agentQuery(), async () => (await handleOwnerBrowserReturn(makeDeps({ advance_to_owner_mobile: () => ({ data: { updated: true, forward: false, reason: "dnd", stage: "owner_voicemail", owner: A1 } }) }).deps,
      ctx, { DialCallStatus: "no-answer" })).twiml],
    ["owner_browser zero-row owner_voicemail (emitNext)", agentQuery(), async () => (await handleOwnerBrowserReturn(makeDeps({ advance_to_owner_mobile: () => ({ data: { updated: false, reason: "stage_mismatch", stage: "owner_voicemail", terminal: false } }) }).deps,
      ctx, { DialCallStatus: "no-answer" })).twiml],
    ["D13 commit failure", agentQuery(), async () => (await handleOwnerBrowserReturn(makeDeps({ advance_to_owner_mobile: () => ({ error: { message: "deadlock" } }) }).deps,
      ctx, { DialCallStatus: "no-answer" })).twiml],
    ["mobile not bridged", agentQuery(), async () => (await handleOwnerMobileReturn(makeDeps({ record_inbound_mobile_bridge: () => ({ data: { bridged: false, evidence: "not_bridged", attributed: false } }) }, { attemptRow: mobile("no_digit") }).deps,
      ctx, { DialCallStatus: "completed", DialBridged: "false" }, parseDialBridged)).twiml],
    ["mobile unconfirmed", agentQuery(), async () => (await handleOwnerMobileReturn(makeDeps({ record_inbound_mobile_bridge: () => ({ data: { bridged: false, evidence: "unconfirmed", attributed: false } }) }, { attemptRow: mobile("no_digit") }).deps,
      ctx, { DialCallStatus: "no-answer" }, parseDialBridged)).twiml],
    ["group wave unanswered", groupQuery(), async () => (await handleGroupBrowserReturn(makeDeps({}, { attemptRow: attempt({ stage: "group_browser", mode: "group", owner_agent_id: null, reserved_agent_ids: [A2] }) }).deps,
      { ...ctx, agentId: "" }, { DialCallStatus: "no-answer" })).twiml],
    ["planner returned no attempt, no owner", groupQuery(null), async () => (await handleInitialV2(makeDeps({ plan_inbound_route: () => ({ data: { created: false, reason: "call_terminal" } }) }).deps,
      { ...init, ownerAgentId: null, ownerSource: null, groupIds: [A2] } as never)).twiml],
    ["R14 group wave suppressed", groupQuery(), async () => (await handleInitialV2(makeDeps({
      plan_inbound_route: () => ({ data: { created: true, stage: "group_browser", attempt: attempt({ stage: "group_browser", mode: "group", owner_agent_id: null, reserved_agent_ids: [A2] }) } }),
    }, { persist: false }).deps, { ...init, ownerAgentId: null, ownerSource: null, groupIds: [A2] } as never)).twiml],
    ["mobile not bridged, no agent_id in the stage URL (mailboxForAttempt)", agentQuery(), async () => (await handleOwnerMobileReturn(makeDeps({ record_inbound_mobile_bridge: () => ({ data: { bridged: false, evidence: "not_bridged", attributed: false } }) }, { attemptRow: mobile("no_digit") }).deps,
      { ...ctx, agentId: "" }, { DialCallStatus: "completed", DialBridged: "false" }, parseDialBridged)).twiml],
    ["group wave stage_mismatch while still ringing", groupQuery(), async () => (await handleGroupBrowserReturn(makeDeps({ advance_inbound_route_stage: () => ({ data: { updated: false, reason: "stage_mismatch", stage: "group_browser", terminal: false } }) },
      { attemptRow: attempt({ stage: "group_browser", mode: "group", owner_agent_id: null, reserved_agent_ids: [A2] }) }).deps, { ...ctx, agentId: "" }, { DialCallStatus: "no-answer" })).twiml],
  ];

  it.each(paths)("%s ⇒ exactly %s", async (_label, expected, run) => {
    const xml = await run();
    expect(isVoicemail(xml)).toBe(true);
    const q = recordingCallbackQuery(xml);
    expect(q).toBe(expected);
    const kind = new URLSearchParams(expected).get("mailbox");
    expect(callbackQueryViolations(q)).toEqual([]);
    expect(q).not.toContain("agent%3A");
    expect(q).not.toContain("agent:");
    const p = new URLSearchParams(q);
    expect(p.get("source")).toBe("voicemail");
    expect(p.get("mailbox")).toBe(kind);
    if (kind === "agent") expect(p.get("mailbox_agent_id")).toBe(A1);
    else expect(p.has("mailbox_agent_id")).toBe(false);
    // the retry fragment still rides the TwiML attribute
    expect(xml).toContain("#rc=3&amp;rp=5xx,ct,rt");
  });

  it("NEGATIVE CONTROL: the pre-repair agent query violates the invariant (the check can tell them apart)", () => {
    const legacy = `source=voicemail&mailbox=agent%3A${A1}&call_row_id=${CALL}&org_id=${ORG}&attempt_id=${ATT}`;
    expect(callbackQueryViolations(legacy)).not.toEqual([]);
    expect(callbackQueryViolations(agentQuery())).toEqual([]);
    expect(callbackQueryViolations(groupQuery())).toEqual([]);
  });

  it("voicemailCallbackQuery: agent → mailbox=agent + mailbox_agent_id (lower-cased); group unchanged", () => {
    expect(voicemailCallbackQuery(`agent:${A1}`)).toEqual({ query: { source: "voicemail", mailbox: "agent", mailbox_agent_id: A1 }, valid: true });
    expect(voicemailCallbackQuery(`agent:${A1.toUpperCase()}`)).toEqual({ query: { source: "voicemail", mailbox: "agent", mailbox_agent_id: A1 }, valid: true });
    expect(voicemailCallbackQuery("group")).toEqual({ query: { source: "voicemail", mailbox: "group" }, valid: true });
  });

  it("voicemailCallbackQuery: an unparseable mailbox fails closed as an agent mailbox WITHOUT an id — never the group mailbox", () => {
    for (const bad of ["agent:+15559990001", "", "everyone", "agent:"]) {
      const r = voicemailCallbackQuery(bad);
      expect(r).toEqual({ query: { source: "voicemail", mailbox: "agent" }, valid: false });
      expect(r.query.mailbox).not.toBe("group");
      expect(callbackQueryViolations(new URLSearchParams(r.query).toString())).toEqual([]);
    }
  });
});
