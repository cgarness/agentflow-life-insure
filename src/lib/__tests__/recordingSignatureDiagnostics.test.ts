// B1 Phase 1 (2026-09-27) — the FAILURE-ONLY signature diagnostic in twilio-recording-status.
//
// Agent-mailbox voicemail callbacks are answered 403 while group-mailbox callbacks validate. The
// percent-encoded colon in `mailbox=agent%3A<uuid>` is a hypothesis, not a proven cause. The diagnostic
// reports which canonical form of the same request the received signature matches. These tests pin:
//   - every variant string exactly (so a report names a precise, reproducible form);
//   - that a request signed over form X is reported as X, and a wrong token / missing signature as none;
//   - that the log line carries names, counts and booleans only — never the signature, token, URL,
//     query values or any other parameter, and never a malformed SID verbatim;
//   - that it never throws or rejects.
// The handler-level guarantees (still 403, nothing read or written) are executed against the real
// handler in voicemailOwnershipRecovery.test.ts.
import { createHmac, webcrypto } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DIAGNOSTIC_LIMITS,
  QUERY_FORMS,
  SIGNATURE_DIAGNOSTIC_LOG_TAG,
  buildSignatureVariants,
  diagnoseSignatureFailure,
  logSignatureDiagnostic,
  queryForm,
  signingString,
  withPort443,
} from "../../../supabase/functions/twilio-recording-status/signature-diagnostics";

const BASE = "https://example.supabase.co/functions/v1/twilio-recording-status";
const TOKEN = "twilio-auth-token-for-tests";
const AGENT = "7c692e64-fbbc-4c7a-bcbf-149a6476c520";
const CALL_ROW = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const CALL_SID = "CA" + "e".repeat(32);
const REC_SID = "RE" + "d".repeat(32);
const PARAMS = {
  AccountSid: "AC" + "b".repeat(32),
  CallSid: CALL_SID,
  From: "+15551234567",
  RecordingDuration: "7",
  RecordingSid: REC_SID,
  RecordingStatus: "completed",
  RecordingUrl: "https://api.twilio.com/2010-04-01/Accounts/ACx/Recordings/REx",
};
// Chosen so all twelve variant URLs are distinct: an encoded colon, a raw colon, `+`, and `%20`.
const SEARCH = `?source=voicemail&mailbox=agent%3A${AGENT}&call_row_id=${CALL_ROW}&org_id=${ORG}&x=a+b%20c&y=q:1`;

function sign(url: string, params: Record<string, string>, token = TOKEN): string {
  return createHmac("sha1", token).update(signingString(url, params), "utf8").digest("base64");
}

beforeAll(() => {
  if (!(globalThis.crypto as Crypto | undefined)?.subtle) {
    Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true, writable: true });
  }
});

describe("variant strings are exact", () => {
  it("builds the six query forms", () => {
    const q = `?source=voicemail&mailbox=agent%3A${AGENT}&x=a+b%20c&y=q:1`;
    expect(queryForm(q, "raw")).toBe(q);
    expect(queryForm(q, "colon_decoded")).toBe(`?source=voicemail&mailbox=agent:${AGENT}&x=a+b%20c&y=q:1`);
    expect(queryForm(q, "colon_encoded")).toBe(`?source=voicemail&mailbox=agent%3A${AGENT}&x=a+b%20c&y=q%3A1`);
    expect(queryForm(q, "fully_decoded")).toBe(`?source=voicemail&mailbox=agent:${AGENT}&x=a+b c&y=q:1`);
    expect(queryForm(q, "form_reencoded")).toBe(`?source=voicemail&mailbox=agent%3A${AGENT}&x=a+b+c&y=q%3A1`);
    expect(queryForm(q, "legacy_reencoded")).toBe(`?source=voicemail&mailbox=agent%3A${AGENT}&x=a%20b%20c&y=q%3A1`);
  });

  it("treats a lower-case escape like an upper-case one when decoding the colon", () => {
    expect(queryForm("?mailbox=agent%3aX", "colon_decoded")).toBe("?mailbox=agent:X");
  });

  it("an empty query yields no query in any form", () => {
    for (const form of QUERY_FORMS) {
      expect(queryForm("", form)).toBe("");
      expect(queryForm("?", form)).toBe("");
    }
  });

  it("adds :443 only to an https URL without a port", () => {
    expect(withPort443(BASE)).toBe("https://example.supabase.co:443/functions/v1/twilio-recording-status");
    expect(withPort443("https://example.supabase.co:8443/x")).toBeNull();
    expect(withPort443("http://example.supabase.co/x")).toBeNull();
  });

  it("builds twelve named variants in a fixed order, all distinct for the reference query", () => {
    const v = buildSignatureVariants(BASE, SEARCH);
    expect(v.map((x) => x.name)).toEqual([
      ...QUERY_FORMS,
      ...QUERY_FORMS.map((f) => `${f}+port443`),
    ]);
    expect(new Set(v.map((x) => x.url)).size).toBe(12);
    expect(v[0].url).toBe(`${BASE}${SEARCH}`);
  });

  it("malformed escapes never throw and are kept as received when fully decoding", () => {
    const q = "?a=%E0%A4%A&b=%&c=ok%3A";
    expect(() => buildSignatureVariants(BASE, q)).not.toThrow();
    expect(queryForm(q, "fully_decoded")).toBe("?a=%E0%A4%A&b=%&c=ok:");
  });
});

describe("the matched variant is the form the signature was computed over", () => {
  it.each(buildSignatureVariants(BASE, SEARCH).map((v) => [v.name, v.url]))(
    "a request signed over %s reports it",
    async (name, url) => {
      const r = await diagnoseSignatureFailure({
        signature: sign(url, PARAMS),
        authToken: TOKEN,
        baseUrl: BASE,
        requestUrl: `${BASE}${SEARCH}`,
        params: PARAMS,
      });
      expect(r.matched_variant).toBe(name);
      expect(r.match_count).toBe(1);
      expect(r.variants_checked).toBe(12);
    },
  );

  it("the agent-mailbox hypothesis: signed with a decoded colon, delivered with %3A", async () => {
    const delivered = `?source=voicemail&mailbox=agent%3A${AGENT}&call_row_id=${CALL_ROW}&org_id=${ORG}`;
    const r = await diagnoseSignatureFailure({
      signature: sign(`${BASE}?source=voicemail&mailbox=agent:${AGENT}&call_row_id=${CALL_ROW}&org_id=${ORG}`, PARAMS),
      authToken: TOKEN,
      baseUrl: BASE,
      requestUrl: `${BASE}${delivered}`,
      params: PARAMS,
    });
    // `fully_decoded` produces the same URL for this query; the fixed order reports the narrower form first
    expect(r.matched_variant).toBe("colon_decoded");
    expect(r.match_count).toBe(2);
    expect(r.query_had_pct3a).toBe(true);
    expect(r.query_had_raw_colon).toBe(false);
  });

  it("the inverse: the platform delivered a raw colon that was signed encoded", async () => {
    const r = await diagnoseSignatureFailure({
      signature: sign(`${BASE}?mailbox=agent%3A${AGENT}`, PARAMS),
      authToken: TOKEN,
      baseUrl: BASE,
      requestUrl: `${BASE}?mailbox=agent:${AGENT}`,
      params: PARAMS,
    });
    expect(r.matched_variant).toBe("colon_encoded");
    expect(r.query_had_pct3a).toBe(false);
    expect(r.query_had_raw_colon).toBe(true);
  });

  it("a wrong token reports none after checking every variant", async () => {
    const r = await diagnoseSignatureFailure({
      signature: sign(`${BASE}${SEARCH}`, PARAMS, "some-other-token"),
      authToken: TOKEN,
      baseUrl: BASE,
      requestUrl: `${BASE}${SEARCH}`,
      params: PARAMS,
    });
    expect(r).toMatchObject({ matched_variant: "none", match_count: 0, variants_checked: 12, has_signature: true });
  });

  it("a tampered parameter reports none", async () => {
    const r = await diagnoseSignatureFailure({
      signature: sign(`${BASE}${SEARCH}`, PARAMS),
      authToken: TOKEN,
      baseUrl: BASE,
      requestUrl: `${BASE}${SEARCH}`,
      params: { ...PARAMS, RecordingDuration: "8" },
    });
    expect(r.matched_variant).toBe("none");
  });

  it("a missing signature reports none without computing anything", async () => {
    const r = await diagnoseSignatureFailure({
      signature: null,
      authToken: TOKEN,
      baseUrl: BASE,
      requestUrl: `${BASE}${SEARCH}`,
      params: PARAMS,
    });
    expect(r).toMatchObject({ matched_variant: "none", match_count: 0, variants_checked: 0, has_signature: false });
  });
});

describe("the work is bounded", () => {
  it("a Twilio-sized callback is fully checked", async () => {
    const r = await diagnoseSignatureFailure({
      signature: "x", authToken: TOKEN, baseUrl: BASE, requestUrl: `${BASE}${SEARCH}`, params: PARAMS,
    });
    expect(r.variants_checked).toBe(12);
  });

  it("too many parameters are skipped before any HMAC is computed", async () => {
    const params: Record<string, string> = {};
    for (let i = 0; i <= DIAGNOSTIC_LIMITS.maxParams; i++) params[`p${i}`] = "v";
    const sign = vi.spyOn(crypto.subtle, "sign");
    const r = await diagnoseSignatureFailure({ signature: "x", authToken: TOKEN, baseUrl: BASE, requestUrl: `${BASE}${SEARCH}`, params });
    expect(r).toMatchObject({ matched_variant: "skipped_oversize", match_count: 0, variants_checked: 0, has_signature: true });
    expect(sign).not.toHaveBeenCalled();
  });

  it("an oversized body is skipped before any HMAC is computed", async () => {
    const sign = vi.spyOn(crypto.subtle, "sign");
    const r = await diagnoseSignatureFailure({
      signature: "x", authToken: TOKEN, baseUrl: BASE, requestUrl: `${BASE}${SEARCH}`,
      params: { ...PARAMS, RecordingUrl: "x".repeat(DIAGNOSTIC_LIMITS.maxSigningChars) },
    });
    expect(r.matched_variant).toBe("skipped_oversize");
    expect(r.recording_sid).toBe(REC_SID);
    expect(sign).not.toHaveBeenCalled();
  });

  it("the key is imported once and each variant is signed once", async () => {
    const importKey = vi.spyOn(crypto.subtle, "importKey");
    const sign = vi.spyOn(crypto.subtle, "sign");
    await diagnoseSignatureFailure({ signature: "x", authToken: TOKEN, baseUrl: BASE, requestUrl: `${BASE}${SEARCH}`, params: PARAMS });
    expect(importKey).toHaveBeenCalledTimes(1);
    expect(sign).toHaveBeenCalledTimes(12);
  });
});

describe("the log line carries names, counts and booleans only", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes nothing to the console except through the given sink", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const sink: unknown[] = [];
    const input = { signature: sign(`${BASE}${SEARCH}`, PARAMS, "other"), authToken: TOKEN, baseUrl: BASE, requestUrl: `${BASE}${SEARCH}`, params: PARAMS };
    await diagnoseSignatureFailure(input);
    await logSignatureDiagnostic(input, (tag, fields) => sink.push({ tag, fields }));
    await logSignatureDiagnostic({ ...input, requestUrl: "not a url" }, (tag, fields) => sink.push({ tag, fields }));
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(sink).toHaveLength(2);
  });

  it("the default sink is one console.warn line with the documented fields only", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const others = (["log", "info", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const signature = sign(`${BASE}${SEARCH}`, PARAMS, "other");
    await logSignatureDiagnostic({ signature, authToken: TOKEN, baseUrl: BASE, requestUrl: `${BASE}${SEARCH}`, params: PARAMS });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe(SIGNATURE_DIAGNOSTIC_LOG_TAG);
    const text = JSON.stringify(warn.mock.calls);
    for (const secret of [signature, TOKEN, "example.supabase.co", AGENT, PARAMS.From, PARAMS.RecordingUrl]) expect(text).not.toContain(secret);
    for (const spy of others) expect(spy).not.toHaveBeenCalled();
  });

  async function capture(input: Parameters<typeof logSignatureDiagnostic>[0]) {
    const lines: Array<{ tag: string; fields: Record<string, unknown> }> = [];
    await logSignatureDiagnostic(input, (tag, fields) => lines.push({ tag, fields }));
    return lines;
  }

  it("never contains the signature, token, URL, query values or other parameters", async () => {
    const signature = sign(`${BASE}${queryForm(SEARCH, "colon_decoded")}`, PARAMS);
    const lines = await capture({ signature, authToken: TOKEN, baseUrl: BASE, requestUrl: `${BASE}${SEARCH}`, params: PARAMS });
    expect(lines).toHaveLength(1);
    expect(lines[0].tag).toBe(SIGNATURE_DIAGNOSTIC_LOG_TAG);
    expect(Object.keys(lines[0].fields).sort()).toEqual([
      "call_sid", "has_signature", "match_count", "matched_variant", "query_had_pct3a",
      "query_had_raw_colon", "recording_sid", "variants_checked",
    ]);
    const text = JSON.stringify(lines[0]);
    for (const secret of [signature, TOKEN, "example.supabase.co", AGENT, CALL_ROW, ORG, PARAMS.From, PARAMS.RecordingUrl, PARAMS.AccountSid]) {
      expect(text).not.toContain(secret);
    }
    expect(lines[0].fields.call_sid).toBe(CALL_SID);
    expect(lines[0].fields.recording_sid).toBe(REC_SID);
  });

  it("logs malformed SIDs as invalid and missing SIDs as absent", async () => {
    const injected = 'CA123", "admin": true';
    const lines = await capture({
      signature: "x",
      authToken: TOKEN,
      baseUrl: BASE,
      requestUrl: `${BASE}${SEARCH}`,
      params: { CallSid: injected },
    });
    expect(lines[0].fields.call_sid).toBe("invalid");
    expect(lines[0].fields.recording_sid).toBe("absent");
    expect(JSON.stringify(lines[0])).not.toContain("admin");
  });

  it("never rejects: an unparsable request URL logs only a diagnostic_error marker", async () => {
    const lines = await capture({ signature: "x", authToken: TOKEN, baseUrl: BASE, requestUrl: "not a url", params: PARAMS });
    expect(lines).toEqual([{ tag: SIGNATURE_DIAGNOSTIC_LOG_TAG, fields: { diagnostic_error: true } }]);
  });

  it("never rejects even when the logger itself throws", async () => {
    await expect(
      logSignatureDiagnostic(
        { signature: "x", authToken: TOKEN, baseUrl: BASE, requestUrl: `${BASE}${SEARCH}`, params: PARAMS },
        () => { throw new Error("log sink down"); },
      ),
    ).resolves.toBeUndefined();
  });
});
