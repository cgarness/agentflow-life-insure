// T11 (reshaped per R13) — the browser performs ZERO inbound ownership writes, end to end.
// TwilioContext is a large React provider wired to the live Voice SDK; the enforceable contract is
// asserted against its source (house pattern for provider-level invariants): the legacy claim
// machinery must be GONE, the identity path must be exact-row (af_call_row_id →
// get_inbound_call_identity), and the inverted inbound display ordering (caller_id_used before
// contact_phone) must not reappear. Behavior-level decisions are covered by the pure helpers in
// inboundOwnershipUi.test.ts.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  resolve(__dirname, "../../contexts/TwilioContext.tsx"),
  "utf8",
);

describe("R13 — legacy browser claim contract is fully removed", () => {
  it("has no claimInboundCall helper or invocation", () => {
    expect(src.includes("claimInboundCall")).toBe(false);
  });

  it("never POSTs to the inbound-call-claim function (now a Twilio-signed webhook)", () => {
    expect(src.includes("inbound-call-claim")).toBe(false);
  });

  it("never calls the claim RPC from the browser", () => {
    expect(src.includes("claim_inbound_call")).toBe(false);
  });
});

describe("R13 — ownership is observed from the row, never written by the browser", () => {
  it("reads af_call_row_id from Voice SDK customParameters", () => {
    expect(src.includes("extractAfCallRowId")).toBe(true);
    expect(src.includes("customParameters")).toBe(true);
  });

  it("fetches identity by exact row id via get_inbound_call_identity (R4)", () => {
    expect(src.includes("get_inbound_call_identity")).toBe(true);
  });

  it("classifies ownership (mine/lost/pending) instead of claiming", () => {
    expect(src.includes("classifyInboundOwnership")).toBe(true);
  });
});

describe("T10 — the newest-ringing peek storm is gone from the runtime path", () => {
  it("no peek_inbound_call_identity invocation remains (comments may reference it)", () => {
    expect(src.includes('rpc("peek_inbound_call_identity"')).toBe(false);
  });
});

describe("R5 — the deprecated display-name RPC is out of the runtime path", () => {
  it("no resolve_inbound_caller_display_name invocation remains (comments may reference it)", () => {
    expect(src.includes('rpc("resolve_inbound_caller_display_name"')).toBe(false);
  });
});

describe("T9 — inbound display field ordering (contact_phone over caller_id_used)", () => {
  it("no inverted caller_id_used-first read remains anywhere in the provider", () => {
    expect(/caller_id_used\s*\|\|\s*(row\.)?contact_phone/.test(src)).toBe(false);
  });
});

describe("§1.3 — the dormant browser SID re-homing path is closed for inbound", () => {
  it("syncIdsToRow is gated by the pure inbound skip", () => {
    expect(src.includes("shouldSyncIdsToRow")).toBe(true);
  });
});

describe("T26 — browser recording start is gated by direction", () => {
  it("uses the pure shouldStartBrowserRecording gate", () => {
    expect(src.includes("shouldStartBrowserRecording")).toBe(true);
  });
});

describe("recruits survive the identified-contact reconcile (no client-else-lead collapse)", () => {
  it("no `ct === \"client\" ? \"client\" : \"lead\"` collapse remains", () => {
    expect(/["']client["']\s*\?\s*["']client["']\s*:\s*["']lead["']/.test(src)).toBe(false);
  });

  it("reconcile can fetch recruits by contact_id", () => {
    expect(src.includes('from("recruits")')).toBe(true);
  });
});
