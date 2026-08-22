// Fail-first tests — inbound-call-claim Twilio answer-callback pure helpers (plan rev5: R13, R16, R19).
import { describe, it, expect } from "vitest";
import {
  classifyCallbackEvent,
  isValidCallSid,
  parseClaimCallbackParams,
  extractClientIdentity,
  decideClaimResponseStatus,
} from "../../../supabase/functions/inbound-call-claim/claim-callback";

describe("classifyCallbackEvent (R19)", () => {
  it("in-progress is the primary answered proof", () => {
    expect(classifyCallbackEvent("in-progress")).toBe("claim");
  });
  it("completed is the lost-answered recovery proof", () => {
    expect(classifyCallbackEvent("completed")).toBe("claim");
  });
  it("canceled/busy/failed/no-answer legs NEVER claim", () => {
    for (const s of ["canceled", "busy", "failed", "no-answer"]) {
      expect(classifyCallbackEvent(s)).toBe("ignore_losing_leg");
    }
  });
  it("initiated/ringing/unknown are ignored", () => {
    for (const s of ["initiated", "ringing", "queued", "", "weird"]) {
      expect(classifyCallbackEvent(s)).toBe("ignore_other");
    }
  });
});

describe("isValidCallSid (R16)", () => {
  it("accepts exactly CA + 32 hex", () => {
    expect(isValidCallSid("CA" + "0".repeat(30) + "a1")).toBe(true);
    expect(isValidCallSid("CA" + "F".repeat(32))).toBe(true);
  });
  it("rejects blank, short, long, non-hex, wrong prefix", () => {
    for (const s of ["", "  ", "CA123", "CA" + "0".repeat(31), "CA" + "0".repeat(33), "CA" + "0".repeat(31) + "g", "XX" + "0".repeat(32)]) {
      expect(isValidCallSid(s)).toBe(false);
    }
  });
});

describe("parseClaimCallbackParams (R13 — server-issued ids only)", () => {
  it("extracts valid uuids from the signed query", () => {
    const u = new URL("https://x.supabase.co/functions/v1/inbound-call-claim?call_row_id=cccccccc-0000-0000-0000-000000000001&agent_id=aaaaaaaa-0000-0000-0000-0000000000a1");
    expect(parseClaimCallbackParams(u)).toEqual({
      callRowId: "cccccccc-0000-0000-0000-000000000001",
      agentId: "aaaaaaaa-0000-0000-0000-0000000000a1",
    });
  });
  it("rejects missing/malformed ids", () => {
    for (const q of ["", "?call_row_id=x&agent_id=y", "?call_row_id=cccccccc-0000-0000-0000-000000000001", "?agent_id=aaaaaaaa-0000-0000-0000-0000000000a1"]) {
      expect(parseClaimCallbackParams(new URL(`https://x.supabase.co/f${q}`))).toBeNull();
    }
  });
});

describe("extractClientIdentity", () => {
  it("strips the client: prefix from Called/To", () => {
    expect(extractClientIdentity("client:agent_a1")).toBe("agent_a1");
    expect(extractClientIdentity("agent_a1")).toBe("agent_a1");
    expect(extractClientIdentity("")).toBe("");
  });
});

describe("decideClaimResponseStatus (R19 — 5xx transient / 2xx business / 403 signature)", () => {
  it("transient failures are retryable 5xx", () => {
    expect(decideClaimResponseStatus({ kind: "transient" })).toBe(503);
  });
  it("business rejections and losing legs are 2xx (no pointless retries)", () => {
    expect(decideClaimResponseStatus({ kind: "rejected" })).toBe(200);
    expect(decideClaimResponseStatus({ kind: "ignored" })).toBe(200);
    expect(decideClaimResponseStatus({ kind: "claimed" })).toBe(200);
  });
  it("invalid signature stays 403", () => {
    expect(decideClaimResponseStatus({ kind: "bad_signature" })).toBe(403);
  });
});
