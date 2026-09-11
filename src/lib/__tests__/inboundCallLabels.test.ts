// D13 readers (implementation_plan.md rev 3 §3.2): one label helper, the "my missed calls" scope, the
// availability derivation and the settings validators.
import { describe, expect, it } from "vitest";
import { describeInboundCallOutcome, D13_LABEL_FORWARDED } from "@/lib/inbound-call-labels";
import { buildMyMissedCallsOrFilter, isUuidLike } from "@/lib/missedCallScope";
import { deriveEffectiveAvailability } from "@/lib/agentAvailability";
import { clampInt, normalizeMobileForwardNumber, validateInboundGroupSelection } from "@/lib/inboundSettingsValidation";

const ME = "aaaaaaaa-0000-0000-0000-0000000000a1";

describe("describeInboundCallOutcome — D13 is never presented as an AgentFlow answer", () => {
  it("forwarded to mobile and answered there stays MISSED in AgentFlow, with the mobile outcome alongside", () => {
    const r = describeInboundCallOutcome({ direction: "inbound", is_missed: true, missed_reason: "forwarded_to_mobile", outcome: "forwarded_answered", agent_id: null, answered_by_agent_id: ME });
    expect(r.label).toBe(`${D13_LABEL_FORWARDED} · answered on mobile`);
    expect(r.tone).toBe("missed");
    expect(r.missedInAgentFlow).toBe(true);
    expect(r.answeredOnMobile).toBe(true);
  });
  it("forwarded but not answered ⇒ the D13 label alone (or with voicemail)", () => {
    expect(describeInboundCallOutcome({ direction: "inbound", is_missed: true, missed_reason: "forwarded_to_mobile" }).label).toBe(D13_LABEL_FORWARDED);
    expect(describeInboundCallOutcome({ direction: "inbound", is_missed: true, missed_reason: "forwarded_to_mobile", voicemail_id: "v" }).label).toBe(`${D13_LABEL_FORWARDED} · voicemail`);
  });
  it("other reasons and legacy rows", () => {
    expect(describeInboundCallOutcome({ direction: "inbound", is_missed: true, missed_reason: "dnd" }).label).toContain("On Break / Do Not Disturb");
    expect(describeInboundCallOutcome({ direction: "inbound", is_missed: true, missed_reason: "busy" }).label).toContain("on another call");
    expect(describeInboundCallOutcome({ direction: "inbound", is_missed: true, missed_reason: "group_empty" }).label).toContain("no group member");
    expect(describeInboundCallOutcome({ direction: "inbound", is_missed: true }).label).toBe("Missed call");
    expect(describeInboundCallOutcome({ direction: "inbound", agent_id: ME })).toMatchObject({ label: "Answered in AgentFlow", tone: "answered" });
    expect(describeInboundCallOutcome({ direction: "inbound", outcome: "forwarded_answered" })).toMatchObject({ label: "Answered on forwarded number", tone: "answered" });
    expect(describeInboundCallOutcome({ direction: "inbound" })).toMatchObject({ label: "Inbound call", tone: "neutral" });
    expect(describeInboundCallOutcome({ direction: "outbound", is_missed: true })).toMatchObject({ label: "Outbound call", tone: "neutral" });
  });
});

describe("buildMyMissedCallsOrFilter — the intended recipient sees the row; injection is impossible", () => {
  it("matches answered-by-me, missed-for-me, the snapshot and legacy routed waves", () => {
    expect(buildMyMissedCallsOrFilter(ME)).toBe(`agent_id.eq.${ME},missed_for_agent_id.eq.${ME},missed_recipient_ids.cs.{${ME}},routed_agent_ids.cs.{${ME}}`);
  });
  it("refuses anything that is not a UUID (the caller returns no rows)", () => {
    expect(buildMyMissedCallsOrFilter("me,or.agent_id.not.is.null")).toBeNull();
    expect(buildMyMissedCallsOrFilter("")).toBeNull();
    expect(buildMyMissedCallsOrFilter(null)).toBeNull();
    expect(isUuidLike(ME.toUpperCase())).toBe(true);
  });
});

describe("deriveEffectiveAvailability — On a Call / Offline are derived, never stored", () => {
  it("call state outranks everything; a disconnected phone shows Offline; otherwise the manual value", () => {
    expect(deriveEffectiveAvailability({ manual: "On Break", phoneConnected: true, onCall: true })).toBe("On a Call");
    expect(deriveEffectiveAvailability({ manual: "Available", phoneConnected: false, onCall: false })).toBe("Offline (phone disconnected)");
    expect(deriveEffectiveAvailability({ manual: "Do Not Disturb", phoneConnected: true, onCall: false })).toBe("Do Not Disturb");
  });
});

describe("settings validators", () => {
  it("normalises US and E.164 mobile numbers and refuses junk", () => {
    expect(normalizeMobileForwardNumber("(555) 999-0001")).toBe("+15559990001");
    expect(normalizeMobileForwardNumber("1 555 999 0001")).toBe("+15559990001");
    expect(normalizeMobileForwardNumber("+447700900123")).toBe("+447700900123");
    expect(normalizeMobileForwardNumber("agent_a1")).toBeNull();
    expect(normalizeMobileForwardNumber("")).toBeNull();
  });
  it("group selection: 1..10 distinct ids", () => {
    expect(validateInboundGroupSelection([ME, ME])).toEqual({ ok: true, ids: [ME] });
    expect(validateInboundGroupSelection([]).ok).toBe(false);
    expect(validateInboundGroupSelection(Array.from({ length: 11 }, (_, i) => `id-${i}`)).ok).toBe(false);
  });
  it("ring seconds and retention clamp to the database CHECK ranges", () => {
    expect(clampInt("abc", 5, 120, 20)).toBe(20);
    expect(clampInt(999, 5, 120, 20)).toBe(120);
    expect(clampInt(0, 1, 365, 30)).toBe(1);
  });
});
