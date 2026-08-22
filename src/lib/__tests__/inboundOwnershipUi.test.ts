// Inbound browser = UI only (plan rev5 §4.4, R13) — pure decision helpers for TwilioContext.
// T9 (contact_phone over caller_id_used), T10 (identity keyed by row id — no shared/newest-ringing
// key), T11 (ownership flips only on agent_id = uid; lost race classified with zero writes),
// T26 (browser recording gated off for inbound only).
import { describe, expect, it } from "vitest";
import {
  AF_CALL_ROW_ID_PARAM,
  classifyInboundOwnership,
  extractAfCallRowId,
  normalizeInboundContactType,
  pickInboundDisplayPhone,
  shouldStartBrowserRecording,
  shouldSyncIdsToRow,
} from "@/lib/inboundCallOwnership";

const ROW_A = "11111111-2222-4333-8444-555555555555";
const ROW_B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("T9 — inbound display prefers contact_phone over caller_id_used", () => {
  it("uses contact_phone (customer ANI) when both are present", () => {
    expect(
      pickInboundDisplayPhone({ contact_phone: "+15550001111", caller_id_used: "+15559990000" }),
    ).toBe("+15550001111");
  });

  it("falls back to caller_id_used only when contact_phone is empty", () => {
    expect(pickInboundDisplayPhone({ contact_phone: "", caller_id_used: "+15559990000" })).toBe(
      "+15559990000",
    );
    expect(pickInboundDisplayPhone({ contact_phone: null, caller_id_used: "+15559990000" })).toBe(
      "+15559990000",
    );
  });

  it("trims and returns empty when both are blank", () => {
    expect(pickInboundDisplayPhone({ contact_phone: "  ", caller_id_used: null })).toBe("");
    expect(pickInboundDisplayPhone({ contact_phone: " +15550001111 ", caller_id_used: "" })).toBe(
      "+15550001111",
    );
  });
});

describe("T10 — identity is keyed by the per-call af_call_row_id (no bleed between rings)", () => {
  const mapOf = (id: string) => new Map<string, string>([[AF_CALL_ROW_ID_PARAM, id]]);

  it("two simultaneous rings yield two distinct row-id keys", () => {
    const a = extractAfCallRowId(mapOf(ROW_A));
    const b = extractAfCallRowId(mapOf(ROW_B));
    expect(a).toBe(ROW_A);
    expect(b).toBe(ROW_B);
    expect(a).not.toBe(b);
  });

  it("reads the Voice SDK Map<string,string> customParameters shape", () => {
    expect(extractAfCallRowId(mapOf(ROW_A))).toBe(ROW_A);
  });

  it("also accepts a plain-object shape defensively", () => {
    expect(extractAfCallRowId({ [AF_CALL_ROW_ID_PARAM]: ROW_B })).toBe(ROW_B);
  });

  it("returns null (NOT some fallback key) for missing/malformed ids — no newest-ringing guessing", () => {
    expect(extractAfCallRowId(undefined)).toBeNull();
    expect(extractAfCallRowId(null)).toBeNull();
    expect(extractAfCallRowId(new Map())).toBeNull();
    expect(extractAfCallRowId(mapOf("not-a-uuid"))).toBeNull();
    expect(extractAfCallRowId(mapOf("CA00000000000000000000000000000000"))).toBeNull();
    expect(extractAfCallRowId(mapOf(""))).toBeNull();
  });
});

describe("T11 — ownership state flips only when the row shows agent_id = uid (R13)", () => {
  const ME = "99999999-8888-4777-a666-555555555544";
  const OTHER = "00000000-1111-4222-a333-444444444455";

  it("agent_id NULL/empty ⇒ pending (accept alone confirms nothing)", () => {
    expect(classifyInboundOwnership(null, ME)).toBe("pending");
    expect(classifyInboundOwnership(undefined, ME)).toBe("pending");
    expect(classifyInboundOwnership("", ME)).toBe("pending");
  });

  it("agent_id = my uid ⇒ mine (the ONLY confirmation signal)", () => {
    expect(classifyInboundOwnership(ME, ME)).toBe("mine");
  });

  it("agent_id = another agent ⇒ lost (teardown, zero writes)", () => {
    expect(classifyInboundOwnership(OTHER, ME)).toBe("lost");
  });

  it("no uid available ⇒ never 'mine'", () => {
    expect(classifyInboundOwnership(ME, null)).toBe("lost");
    expect(classifyInboundOwnership(null, undefined)).toBe("pending");
  });
});

describe("T26 — browser recording gated off for inbound, unchanged for outbound", () => {
  it("inbound legs never start browser recording (Twilio dual-channel owns inbound recording)", () => {
    expect(shouldStartBrowserRecording(true)).toBe(false);
  });

  it("outbound legs keep the existing browser-recording path", () => {
    expect(shouldStartBrowserRecording(false)).toBe(true);
  });
});

describe("syncIdsToRow — inbound rows are never SID-re-homed by the browser (§1.3 dormant path)", () => {
  it("skips inbound entirely", () => {
    expect(shouldSyncIdsToRow(true)).toBe(false);
  });

  it("outbound behavior is preserved", () => {
    expect(shouldSyncIdsToRow(false)).toBe(true);
  });
});

describe("contact_type is preserved (recruits are not collapsed to lead/client)", () => {
  it("passes through the three real types", () => {
    expect(normalizeInboundContactType("lead")).toBe("lead");
    expect(normalizeInboundContactType("client")).toBe("client");
    expect(normalizeInboundContactType("recruit")).toBe("recruit");
    expect(normalizeInboundContactType("Recruit")).toBe("recruit");
  });

  it("unknown/absent types stay undefined — never invented", () => {
    expect(normalizeInboundContactType(null)).toBeUndefined();
    expect(normalizeInboundContactType("")).toBeUndefined();
    expect(normalizeInboundContactType("prospect")).toBeUndefined();
  });
});
