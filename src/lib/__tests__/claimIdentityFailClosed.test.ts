// Rev 6 C4 — the claim callback's answered-identity cross-check must FAIL CLOSED.
// The R13 contract requires the Active profile's twilio_client_identity to match the answered
// child leg's Called/To client identity EXACTLY; a signed callback with missing or empty
// Called/To must be a 2xx business rejection with zero RPC/write activity — never a bypass.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkAnsweredClientIdentity,
  extractClientIdentity,
} from "../../../supabase/functions/inbound-call-claim/claim-callback";

const IDENTITY = "agent_abc123";

describe("C4 — exact identity match is the only pass", () => {
  it("claims when Called carries the exact client:<identity>", () => {
    expect(
      checkAnsweredClientIdentity({
        calledParam: `client:${IDENTITY}`,
        toParam: `client:${IDENTITY}`,
        profileIdentity: IDENTITY,
      }),
    ).toBe("match");
  });

  it("claims when only To carries the identity (Called empty falls through to To)", () => {
    expect(
      checkAnsweredClientIdentity({
        calledParam: "",
        toParam: `client:${IDENTITY}`,
        profileIdentity: IDENTITY,
      }),
    ).toBe("match");
  });

  it("accepts a raw (unprefixed) identity value", () => {
    expect(
      checkAnsweredClientIdentity({
        calledParam: IDENTITY,
        toParam: undefined,
        profileIdentity: IDENTITY,
      }),
    ).toBe("match");
  });

  it("trims surrounding whitespace before comparing", () => {
    expect(
      checkAnsweredClientIdentity({
        calledParam: `  client:${IDENTITY}  `,
        toParam: undefined,
        profileIdentity: IDENTITY,
      }),
    ).toBe("match");
  });
});

describe("C4 — missing/empty answered identity REJECTS (the closed defect)", () => {
  it("missing Called and To rejects", () => {
    expect(
      checkAnsweredClientIdentity({
        calledParam: undefined,
        toParam: undefined,
        profileIdentity: IDENTITY,
      }),
    ).toBe("missing_answered_identity");
  });

  it("empty-string Called and To reject", () => {
    expect(
      checkAnsweredClientIdentity({
        calledParam: "",
        toParam: "",
        profileIdentity: IDENTITY,
      }),
    ).toBe("missing_answered_identity");
  });

  it("a bare 'client:' prefix (empty identity) rejects", () => {
    expect(
      checkAnsweredClientIdentity({
        calledParam: "client:",
        toParam: "client:",
        profileIdentity: IDENTITY,
      }),
    ).toBe("missing_answered_identity");
  });

  it("whitespace-only values reject", () => {
    expect(
      checkAnsweredClientIdentity({
        calledParam: "   ",
        toParam: "\t",
        profileIdentity: IDENTITY,
      }),
    ).toBe("missing_answered_identity");
  });
});

describe("C4 — mismatched or unusable profile identity rejects", () => {
  it("mismatched identity rejects", () => {
    expect(
      checkAnsweredClientIdentity({
        calledParam: "client:agent_OTHER",
        toParam: "client:agent_OTHER",
        profileIdentity: IDENTITY,
      }),
    ).toBe("identity_mismatch");
  });

  it("case differences are a mismatch (exact equality, no normalization)", () => {
    expect(
      checkAnsweredClientIdentity({
        calledParam: `client:${IDENTITY.toUpperCase()}`,
        toParam: undefined,
        profileIdentity: IDENTITY,
      }),
    ).toBe("identity_mismatch");
  });

  it("empty profile identity rejects even when the leg identity is present", () => {
    expect(
      checkAnsweredClientIdentity({
        calledParam: `client:${IDENTITY}`,
        toParam: undefined,
        profileIdentity: "",
      }),
    ).toBe("missing_profile_identity");
    expect(
      checkAnsweredClientIdentity({
        calledParam: `client:${IDENTITY}`,
        toParam: undefined,
        profileIdentity: null,
      }),
    ).toBe("missing_profile_identity");
  });
});

describe("C4 — client:<identity> normalization still works", () => {
  it("extractClientIdentity strips exactly one client: prefix", () => {
    expect(extractClientIdentity("client:alice")).toBe("alice");
    expect(extractClientIdentity("alice")).toBe("alice");
    expect(extractClientIdentity("client:client:alice")).toBe("client:alice");
  });
});

describe("C4 — every rejection happens BEFORE the claim RPC (zero RPC on reject)", () => {
  const src = readFileSync(
    resolve(__dirname, "../../../supabase/functions/inbound-call-claim/index.ts"),
    "utf8",
  );

  it("the vulnerable empty-identity bypass literal is gone", () => {
    expect(src.includes('answeredIdentity !== ""')).toBe(false);
  });

  it("the handler routes identity through the fail-closed decision", () => {
    expect(src.includes("checkAnsweredClientIdentity")).toBe(true);
  });

  it("there is exactly ONE claim-RPC call site and the identity check precedes it", () => {
    const rpcMatches = src.match(/rpc\("claim_inbound_call"/g) || [];
    expect(rpcMatches.length).toBe(1);
    const checkIdx = src.indexOf("checkAnsweredClientIdentity(");
    const secondCheckIdx = src.indexOf("checkAnsweredClientIdentity(", checkIdx + 1);
    const callSiteIdx = secondCheckIdx >= 0 ? secondCheckIdx : checkIdx;
    const rpcIdx = src.indexOf('rpc("claim_inbound_call"');
    expect(callSiteIdx).toBeGreaterThan(-1);
    expect(callSiteIdx).toBeLessThan(rpcIdx);
  });
});
