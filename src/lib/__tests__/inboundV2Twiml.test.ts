// Inbound Calling v2 — fail-first tests for the pure TwiML builders and Dial-action parsing added by
// implementation_plan.md rev 3 (§8.2 20-second ring, §9 mobile handoff, D6, D12, P5, P6, P7, safeguard 5).
import { describe, expect, it } from "vitest";
import {
  DIAL_ACTION_RETRY_FRAGMENT,
  buildMobileForwardTwiml,
  buildMobileWhisperTwiml,
  buildVoicemailTwiml,
  buildWhisperAcceptTwiml,
  buildWhisperRejectTwiml,
  clampV2RingSeconds,
  parseDialBridged,
  spokenCallerLabel,
} from "../../../supabase/functions/twilio-voice-inbound/twiml";

const base = {
  mobileNumber: "+15559990001",
  timeoutSec: 20,
  actionUrl: "https://x.supabase.co/functions/v1/twilio-voice-inbound?stage=owner_mobile&call_row_id=c&org_id=o&attempt_id=a&agent_id=g",
  whisperUrl: "https://x.supabase.co/functions/v1/twilio-voice-inbound?stage=mobile_whisper&call_row_id=c&org_id=o&attempt_id=a&agent_id=g",
  legStatusUrl: "https://x.supabase.co/functions/v1/twilio-voice-inbound?stage=mobile_leg_status&call_row_id=c&org_id=o&attempt_id=a&agent_id=g",
};

describe("buildMobileForwardTwiml — D12 never recorded, P5 ring window, P7 no callerId", () => {
  it("emits a <Dial> with a <Number> child carrying whisper url + leg statusCallback, and NO record attribute anywhere", () => {
    const xml = buildMobileForwardTwiml(base);
    expect(xml).toContain('<Dial timeout="20"');
    expect(xml).toContain("<Number url=");
    expect(xml).toContain('statusCallbackEvent="initiated ringing answered completed"');
    expect(xml).toContain("+15559990001</Number>");
    expect(/record/i.test(xml)).toBe(false);
    expect(xml).not.toContain("callerId");
  });

  it("§8.5: the parent action URL carries the bounded connection-override fragment", () => {
    const xml = buildMobileForwardTwiml(base);
    // attribute values are XML-escaped (the fragment's & becomes &amp;), exactly like the Client builder
    expect(xml).toContain(`stage=owner_mobile&amp;call_row_id=c&amp;org_id=o&amp;attempt_id=a&amp;agent_id=g${DIAL_ACTION_RETRY_FRAGMENT.replace("&", "&amp;")}" method="POST">`);
  });

  it("refuses anything that is not E.164 — a destination is never a Client identity or free text", () => {
    expect(() => buildMobileForwardTwiml({ ...base, mobileNumber: "agent_a1" })).toThrow();
    expect(() => buildMobileForwardTwiml({ ...base, mobileNumber: "5559990001" })).toThrow();
    expect(() => buildMobileForwardTwiml({ ...base, mobileNumber: "" })).toThrow();
  });

  it("clamps the mobile ring window to 5..120 with a 20-second default", () => {
    expect(buildMobileForwardTwiml({ ...base, timeoutSec: 999 })).toContain('<Dial timeout="120"');
    expect(buildMobileForwardTwiml({ ...base, timeoutSec: 1 })).toContain('<Dial timeout="5"');
    expect(clampV2RingSeconds(undefined)).toBe(20);
    expect(clampV2RingSeconds("abc")).toBe(20);
    expect(clampV2RingSeconds(20)).toBe(20);
  });
});

describe("buildMobileWhisperTwiml — P6 Press 1 only", () => {
  it("gathers exactly one digit, posts even on silence (no_digit is recorded), and hangs up if reached", () => {
    const xml = buildMobileWhisperTwiml({ gatherActionUrl: "https://x/g?stage=mobile_whisper&gather=1", callerLabel: "5 5 5" });
    expect(xml).toContain('<Gather input="dtmf" numDigits="1" timeout="5" actionOnEmptyResult="true"');
    expect(xml).toContain("Press 1 to accept.");
    expect(xml.endsWith("</Gather><Hangup/></Response>")).toBe(true);
    expect(/record/i.test(xml)).toBe(false);
  });

  it("accept = empty response (the call bridges); reject = Say + Hangup (never bridges)", () => {
    expect(buildWhisperAcceptTwiml()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    const rej = buildWhisperRejectTwiml();
    expect(rej).toContain("<Hangup/>");
    expect(rej).not.toContain("<Dial");
  });

  it("speaks the caller's digits, never raw input", () => {
    expect(spokenCallerLabel("+15551234567")).toBe("5 5 5 1 2 3 4 5 6 7");
    expect(spokenCallerLabel("<script>")).toBe("an unknown number");
    expect(buildMobileWhisperTwiml({ gatherActionUrl: "https://x", callerLabel: "<b>" })).toContain("&lt;b&gt;");
  });
});

describe("parseDialBridged — safeguard 5 (absent ≠ false)", () => {
  it("true/false parse strictly; anything else is null (unconfirmed)", () => {
    expect(parseDialBridged("true")).toBe(true);
    expect(parseDialBridged("True")).toBe(true);
    expect(parseDialBridged("false")).toBe(false);
    expect(parseDialBridged(undefined)).toBeNull();
    expect(parseDialBridged("")).toBeNull();
    expect(parseDialBridged("1")).toBeNull();
    expect(parseDialBridged("yes")).toBeNull();
  });
});

describe("v2 voicemail TwiML — the mailbox rides the SIGNED recording callback URL", () => {
  it("keeps the retry fragment and the source/mailbox query; D6 agent greeting URL wins over text", () => {
    const rec = "https://x.supabase.co/functions/v1/twilio-recording-status?source=voicemail&mailbox=agent%3Aaaaaaaaa-0000-0000-0000-0000000000a1&call_row_id=c&org_id=o&attempt_id=a";
    const xml = buildVoicemailTwiml(rec, "https://x/done?stage=voicemail_done", "text greeting", "https://cdn/greeting.mp3");
    expect(xml).toContain("source=voicemail&amp;mailbox=agent%3Aaaaaaaaa-0000-0000-0000-0000000000a1");
    expect(xml).toContain("#rc=3&amp;rp=5xx,ct,rt");
    expect(xml).toContain("<Play>https://cdn/greeting.mp3</Play>");
    expect(xml).not.toContain("text greeting");
    expect(xml).toContain('action="https://x/done?stage=voicemail_done"');
  });
});
