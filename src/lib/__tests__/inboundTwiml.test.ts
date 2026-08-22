// Fail-first tests — twilio-voice-inbound pure TwiML builders (plan rev5: T19, T20, D3, R13, R19, R3).
// Deno-free module under supabase/functions/twilio-voice-inbound/twiml.ts (duration.ts house pattern).
import { describe, it, expect } from "vitest";
import {
  buildClientDialTwiml,
  buildVoicemailTwiml,
  buildForwardTwiml,
  buildHangupTwiml,
  clampRingTimeout,
  resolveTerminalAction,
  CLAIM_CALLBACK_RETRY_FRAGMENT,
  RECORDING_CALLBACK_RETRY_FRAGMENT,
} from "../../../supabase/functions/twilio-voice-inbound/twiml";

const baseOpts = {
  targets: [
    { identity: "agent_a1", agentId: "aaaaaaaa-0000-0000-0000-0000000000a1" },
    { identity: "agent_a2", agentId: "aaaaaaaa-0000-0000-0000-0000000000a2" },
  ],
  callRowId: "cccccccc-0000-0000-0000-000000000001",
  timeoutSec: 25,
  actionUrl: "https://x.supabase.co/functions/v1/twilio-voice-inbound?fallback=chain&chain_step=1",
  recordingEnabled: true,
  recordingStatusUrl: "https://x.supabase.co/functions/v1/twilio-recording-status",
  claimCallbackBaseUrl: "https://x.supabase.co/functions/v1/inbound-call-claim",
};

describe("buildClientDialTwiml (R13/R19/R3/T19)", () => {
  it("T19: applies the configured ring timeout to the Dial verb", () => {
    const xml = buildClientDialTwiml({ ...baseOpts, timeoutSec: 42 });
    expect(xml).toContain('<Dial timeout="42"');
  });

  it("R13: every Client noun carries Identity + af_call_row_id Parameter + per-agent signed answered/completed statusCallback", () => {
    const xml = buildClientDialTwiml(baseOpts);
    expect(xml).toContain("<Identity>agent_a1</Identity>");
    expect(xml).toContain("<Identity>agent_a2</Identity>");
    const paramCount = (xml.match(/<Parameter name="af_call_row_id" value="cccccccc-0000-0000-0000-000000000001"\/>/g) || []).length;
    expect(paramCount).toBe(2);
    expect(xml).toContain('statusCallbackEvent="answered completed"');
    expect(xml).toContain('statusCallbackMethod="POST"');
    // per-agent server-issued ids on the callback URL
    expect(xml).toMatch(/inbound-call-claim\?call_row_id=cccccccc-0000-0000-0000-000000000001&amp;agent_id=aaaaaaaa-0000-0000-0000-0000000000a1/);
    expect(xml).toMatch(/inbound-call-claim\?call_row_id=cccccccc-0000-0000-0000-000000000001&amp;agent_id=aaaaaaaa-0000-0000-0000-0000000000a2/);
  });

  it("R3: never passes af_org_id (org identity comes from the database)", () => {
    const xml = buildClientDialTwiml(baseOpts);
    expect(xml).not.toContain("af_org_id");
  });

  it("R19: every claim callback URL carries the bounded retry connection-override fragment", () => {
    const xml = buildClientDialTwiml(baseOpts);
    const urls = xml.match(/statusCallback="[^"]+"/g) || [];
    expect(urls.length).toBe(2);
    for (const u of urls) {
      expect(u).toContain(CLAIM_CALLBACK_RETRY_FRAGMENT.replace(/&/g, "&amp;"));
    }
    // the override rides the URL FRAGMENT (never transmitted, never part of the signed URL)
    expect(CLAIM_CALLBACK_RETRY_FRAGMENT.startsWith("#")).toBe(true);
    expect(CLAIM_CALLBACK_RETRY_FRAGMENT).toMatch(/rp=[^#]*5xx/);
    expect(CLAIM_CALLBACK_RETRY_FRAGMENT).toMatch(/rp=[^#]*ct/);
    expect(CLAIM_CALLBACK_RETRY_FRAGMENT).toMatch(/rp=[^#]*rt/);
  });

  it("R17: the recordingStatusCallback URL carries the retry fragment too", () => {
    const xml = buildClientDialTwiml(baseOpts);
    expect(xml).toContain(
      `recordingStatusCallback="${baseOpts.recordingStatusUrl}${RECORDING_CALLBACK_RETRY_FRAGMENT}"`.replace(/&/g, "&amp;"),
    );
  });

  it("recording attrs present only when enabled (existing behavior preserved)", () => {
    const on = buildClientDialTwiml(baseOpts);
    const off = buildClientDialTwiml({ ...baseOpts, recordingEnabled: false });
    expect(on).toContain('record="record-from-answer-dual"');
    expect(off).not.toContain("record=");
  });
});

describe("clampRingTimeout (T19)", () => {
  it("defaults to 30 and clamps to [5, 120]", () => {
    expect(clampRingTimeout(null)).toBe(30);
    expect(clampRingTimeout(undefined)).toBe(30);
    expect(clampRingTimeout(0)).toBe(5);
    expect(clampRingTimeout(3)).toBe(5);
    expect(clampRingTimeout(45)).toBe(45);
    expect(clampRingTimeout(900)).toBe(120);
    expect(clampRingTimeout("nonsense")).toBe(30);
  });
});

describe("resolveTerminalAction (T20/D3)", () => {
  it("voicemail action with voicemail enabled records voicemail", () => {
    expect(resolveTerminalAction({ fallbackAction: "voicemail", voicemailEnabled: true, forwardingNumber: "", alreadyForwarded: false })).toBe("voicemail");
  });
  it("T20: voicemail disabled ⇒ hangup terminal — never a Record", () => {
    expect(resolveTerminalAction({ fallbackAction: "voicemail", voicemailEnabled: false, forwardingNumber: "", alreadyForwarded: false })).toBe("hangup");
    // default action (unset ⇒ voicemail) also honors the toggle
    expect(resolveTerminalAction({ fallbackAction: "", voicemailEnabled: false, forwardingNumber: "", alreadyForwarded: false })).toBe("hangup");
  });
  it("forward action with a number forwards once, then falls to voicemail/hangup", () => {
    expect(resolveTerminalAction({ fallbackAction: "forward", voicemailEnabled: true, forwardingNumber: "+15550003333", alreadyForwarded: false })).toBe("forward");
    expect(resolveTerminalAction({ fallbackAction: "forward", voicemailEnabled: true, forwardingNumber: "+15550003333", alreadyForwarded: true })).toBe("voicemail");
    expect(resolveTerminalAction({ fallbackAction: "forward", voicemailEnabled: false, forwardingNumber: "+15550003333", alreadyForwarded: true })).toBe("hangup");
    expect(resolveTerminalAction({ fallbackAction: "forward", voicemailEnabled: true, forwardingNumber: "", alreadyForwarded: false })).toBe("voicemail");
  });
  it("hangup action is honored as-is", () => {
    expect(resolveTerminalAction({ fallbackAction: "hangup", voicemailEnabled: true, forwardingNumber: "", alreadyForwarded: false })).toBe("hangup");
  });
});

describe("voicemail / forward / hangup TwiML (behavior preserved)", () => {
  it("voicemail records with the recording callback and greeting", () => {
    const xml = buildVoicemailTwiml("https://x/rec", "https://x/act", "Leave a message", "");
    expect(xml).toContain("<Record");
    expect(xml).toContain("Leave a message");
  });
  it("T20: hangup TwiML never contains a Record verb", () => {
    const xml = buildHangupTwiml("Goodbye.");
    expect(xml).not.toContain("<Record");
    expect(xml).toContain("<Hangup/>");
  });
  it("forwarded legs carry NO recording attributes (D7 — intentionally unrecorded)", () => {
    const xml = buildForwardTwiml("+15550003333", "https://x/act");
    expect(xml).not.toContain("record");
    expect(xml).not.toContain("recordingStatusCallback");
  });
});
