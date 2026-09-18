// Corrective pass, defect 5 — every v2 stage callback is bound to the stored call: organization, the
// provider's parent-call fields, the destination and the accepted child SID. Mismatches mutate nothing
// and attribute nothing; a replayed Gather after the caller hung up never bridges.
import { describe, expect, it } from "vitest";
import { phoneDigitsE164ish, verifyCallbackIdentity } from "../../../supabase/functions/twilio-voice-inbound/planner";
import {
  StageDeps,
  handleMobileLegStatus,
  handleMobileWhisper,
  handleOwnerMobileReturn,
} from "../../../supabase/functions/twilio-voice-inbound/stages";
import { parseDialBridged } from "../../../supabase/functions/twilio-voice-inbound/twiml";

const ORG = "aaaaaaaa-0000-0000-0000-00000000000a";
const A1 = "aaaaaaaa-0000-0000-0000-0000000000a1";
const CALL = "cccccccc-0000-0000-0000-000000000001";
const ATT = "eeeeeeee-0000-0000-0000-000000000001";
const PARENT = "CA" + "a".repeat(32);
const CHILD = "CA" + "c".repeat(32);
const OTHER = "CA" + "9".repeat(32);
const MOBILE = "+15559990001";
const stored = { organization_id: ORG, twilio_call_sid: PARENT };

describe("phoneDigitsE164ish — national vs E.164 input", () => {
  it("adds the NANP country code to a bare 10-digit number only; an E.164 input is taken as dialed", () => {
    expect(phoneDigitsE164ish("(555) 999-0001")).toBe("15559990001");
    expect(phoneDigitsE164ish("+15559990001")).toBe("15559990001");
    expect(phoneDigitsE164ish("+4412345678")).toBe("4412345678");
    expect(phoneDigitsE164ish("+4412345678")).not.toBe(phoneDigitsE164ish("+14412345678"));
  });
  it("a whisper To that is a 10-digit non-NANP E.164 number does not pass for a +1 snapshot", () => {
    const attempt = { mobile_number_dialed: "+15559990001", mobile_child_call_sid: null };
    expect(verifyCallbackIdentity({ stage: "mobile_whisper", params: { CallSid: CHILD, ParentCallSid: PARENT, To: "+5559990001" }, orgId: ORG, stored, attempt })).toEqual({ ok: false, reason: "destination_mismatch" });
    expect(verifyCallbackIdentity({ stage: "mobile_whisper", params: { CallSid: CHILD, ParentCallSid: PARENT, To: "(555) 999-0001" }, orgId: ORG, stored, attempt })).toEqual({ ok: true, parentCallSid: PARENT });
  });
});

describe("verifyCallbackIdentity — documented fields per callback type", () => {
  it("parent-facing stages bind CallSid to the stored parent and the organization", () => {
    for (const stage of ["owner_browser", "owner_mobile", "group_browser", "voicemail_done"]) {
      expect(verifyCallbackIdentity({ stage, params: { CallSid: PARENT }, orgId: ORG, stored })).toEqual({ ok: true, parentCallSid: PARENT });
      expect(verifyCallbackIdentity({ stage, params: { CallSid: OTHER }, orgId: ORG, stored })).toEqual({ ok: false, reason: "parent_sid_mismatch" });
      expect(verifyCallbackIdentity({ stage, params: { CallSid: PARENT }, orgId: "bbbbbbbb-0000-0000-0000-00000000000b", stored })).toEqual({ ok: false, reason: "org_mismatch" });
    }
  });
  it("child-leg stages require ParentCallSid = stored parent; the whisper also binds To to the dialed destination and any bound child SID", () => {
    const attempt = { mobile_number_dialed: MOBILE, mobile_child_call_sid: null };
    expect(verifyCallbackIdentity({ stage: "mobile_whisper", params: { CallSid: CHILD, ParentCallSid: PARENT, To: "(555) 999-0001" }, orgId: ORG, stored, attempt })).toEqual({ ok: true, parentCallSid: PARENT });
    expect(verifyCallbackIdentity({ stage: "mobile_whisper", params: { CallSid: CHILD, ParentCallSid: OTHER, To: MOBILE }, orgId: ORG, stored, attempt })).toEqual({ ok: false, reason: "parent_sid_mismatch" });
    expect(verifyCallbackIdentity({ stage: "mobile_whisper", params: { CallSid: CHILD, To: MOBILE }, orgId: ORG, stored, attempt })).toEqual({ ok: false, reason: "missing_parent_sid" });
    expect(verifyCallbackIdentity({ stage: "mobile_whisper", params: { CallSid: CHILD, ParentCallSid: PARENT, To: "+15550009999" }, orgId: ORG, stored, attempt })).toEqual({ ok: false, reason: "destination_mismatch" });
    expect(verifyCallbackIdentity({ stage: "mobile_whisper", params: { CallSid: OTHER, ParentCallSid: PARENT, To: MOBILE }, orgId: ORG, stored, attempt: { ...attempt, mobile_child_call_sid: CHILD } })).toEqual({ ok: false, reason: "child_sid_mismatch" });
    expect(verifyCallbackIdentity({ stage: "mobile_leg_status", params: { CallSid: CHILD, ParentCallSid: PARENT }, orgId: ORG, stored, attempt })).toEqual({ ok: true, parentCallSid: PARENT });
    expect(verifyCallbackIdentity({ stage: "mobile_leg_status", params: { CallSid: OTHER, ParentCallSid: PARENT }, orgId: ORG, stored, attempt: { ...attempt, mobile_child_call_sid: CHILD } })).toEqual({ ok: false, reason: "child_sid_mismatch" });
  });
  it("a stored row without a parent SID or an unknown stage is refused", () => {
    expect(verifyCallbackIdentity({ stage: "owner_browser", params: { CallSid: PARENT }, orgId: ORG, stored: { organization_id: ORG, twilio_call_sid: null } })).toEqual({ ok: false, reason: "stored_parent_missing" });
    expect(verifyCallbackIdentity({ stage: "bogus", params: {}, orgId: ORG, stored })).toEqual({ ok: false, reason: "unknown_stage" });
  });
});

function makeDeps(script: Record<string, (args: Record<string, unknown>) => { data?: unknown; error?: { message: string } }>, attemptRow: Record<string, unknown> | null) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const deps: StageDeps = {
    rpc: async (name, args) => { calls.push({ name, args }); const fn = script[name]; const r = fn ? fn(args) : { data: { updated: true } }; return { data: r.data ?? null, error: r.error ?? null }; },
    loadAttempt: async () => attemptRow as never,
    resolveIdentities: async () => [],
    persistRoutedAgents: async () => true,
    loadAgentGreeting: async () => ({ text: null, url: null }),
    urls: { stage: (q) => `https://x/f?${new URLSearchParams(q)}`, recordingStatus: (q) => `https://x/r?${new URLSearchParams(q)}`, claimCallbackBase: "https://x/c" },
    settings: { browserRingSeconds: 20, mobileRingSeconds: 20, recordingEnabled: true, greetingText: "g", greetingUrl: "" },
    log: () => {},
    sleep: async () => {},
  };
  return { deps, calls };
}
const ctx = { callRowId: CALL, orgId: ORG, attemptId: ATT, agentId: A1, fromNumber: "+19995551234", parentCallSid: PARENT };
const mobileAttempt = (over: Record<string, unknown> = {}) => ({ id: ATT, stage: "owner_mobile", mode: "owner", owner_agent_id: A1, reserved_agent_ids: [A1], browser_ring_timeout_sent: 20, mobile_number_dialed: MOBILE, voicemail_kind: null, voicemail_agent_id: null, voicemail_group_ids: [], mobile_accept_result: null, mobile_child_call_sid: null, mobile_bridge_evidence: null, terminal: false, ...over });

describe("stage handlers — the stored parent rides every RPC and mismatches never mutate", () => {
  it("whisper initial request: a destination or bound-child mismatch hangs up with ZERO RPC calls (an empty response would bridge)", async () => {
    const bad = makeDeps({}, mobileAttempt());
    const r1 = await handleMobileWhisper(bad.deps, ctx, { CallSid: CHILD, ParentCallSid: PARENT, To: "+15550009999" }, false);
    expect(r1.twiml).toContain("<Hangup/>");
    expect(r1.twiml).not.toContain("<Gather");
    expect(bad.calls).toEqual([]);
    const bound = makeDeps({}, mobileAttempt({ mobile_child_call_sid: CHILD }));
    const r2 = await handleMobileWhisper(bound.deps, ctx, { CallSid: OTHER, ParentCallSid: PARENT, To: MOBILE }, false);
    expect(r2.twiml).toContain("<Hangup/>");
    const good = makeDeps({}, mobileAttempt());
    const r3 = await handleMobileWhisper(good.deps, ctx, { CallSid: CHILD, ParentCallSid: PARENT, To: "555-999-0001" }, false);
    expect(r3.twiml).toContain("<Gather");
  });

  it("the Gather action passes the stored parent and the dialed To to the accept RPC; a refused identity never bridges", async () => {
    const refused = makeDeps({ record_inbound_mobile_accept: () => ({ data: { accept: false, reason: "parent_sid_mismatch" } }) }, mobileAttempt());
    const r = await handleMobileWhisper(refused.deps, ctx, { CallSid: CHILD, ParentCallSid: PARENT, To: MOBILE, Digits: "1" }, true);
    expect(r.twiml).toContain("<Hangup/>");
    expect(refused.calls[0]).toMatchObject({ name: "record_inbound_mobile_accept", args: { p_parent_call_sid: PARENT, p_to_number: MOBILE, p_child_call_sid: CHILD } });
  });

  it("a replayed Gather after the caller hung up (accept:false, result:'accepted', caller_present:false) never bridges", async () => {
    const replay = makeDeps({ record_inbound_mobile_accept: () => ({ data: { accept: false, idempotent: true, result: "accepted", caller_present: false } }) }, mobileAttempt({ mobile_accept_result: "accepted", mobile_child_call_sid: CHILD }));
    const r = await handleMobileWhisper(replay.deps, ctx, { CallSid: CHILD, ParentCallSid: PARENT, To: MOBILE, Digits: "1" }, true);
    expect(r.twiml).toContain("<Hangup/>");
    const present = makeDeps({ record_inbound_mobile_accept: () => ({ data: { accept: true, idempotent: true, result: "accepted", caller_present: true } }) }, mobileAttempt({ mobile_accept_result: "accepted", mobile_child_call_sid: CHILD }));
    const r2 = await handleMobileWhisper(present.deps, ctx, { CallSid: CHILD, ParentCallSid: PARENT, To: MOBILE, Digits: "1" }, true);
    expect(r2.twiml).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  });

  it("owner_mobile return: the stored parent rides the bridge RPC; a child-SID mismatch attributes nothing and does not finalize as answered", async () => {
    const h = makeDeps({ record_inbound_mobile_bridge: () => ({ data: { bridged: false, evidence: "unconfirmed", reason: "child_sid_mismatch" } }) }, mobileAttempt({ mobile_accept_result: "accepted", mobile_child_call_sid: CHILD }));
    const r = await handleOwnerMobileReturn(h.deps, ctx, { CallSid: PARENT, DialCallSid: OTHER, DialCallStatus: "completed", DialBridged: "true" }, parseDialBridged);
    expect(h.calls[0]).toMatchObject({ name: "record_inbound_mobile_bridge", args: { p_parent_call_sid: PARENT, p_dial_call_sid: OTHER } });
    expect(r.twiml).toContain("<Record ");                                   // voicemail, never a hangup that pretends a conversation happened
    expect(h.calls.map((c) => c.name)).not.toContain("finalize_inbound_call_terminal");
    expect(h.calls.find((c) => c.name === "advance_inbound_route_stage")?.args).toMatchObject({ p_to_stage: "owner_voicemail", p_patch: { final_outcome: null } });
  });

  it("child leg status passes the stored parent; a refused parent is reported and not retried as a write failure", async () => {
    const h = makeDeps({ record_inbound_mobile_leg_end: () => ({ data: { updated: false, reason: "parent_sid_mismatch" } }) }, mobileAttempt());
    const r = await handleMobileLegStatus(h.deps, ctx, { CallSid: CHILD, ParentCallSid: PARENT, CallStatus: "completed", CallDuration: "10" });
    expect(h.calls[0]).toMatchObject({ name: "record_inbound_mobile_leg_end", args: { p_parent_call_sid: PARENT } });
    expect(r.status).toBe(200);
  });
});
