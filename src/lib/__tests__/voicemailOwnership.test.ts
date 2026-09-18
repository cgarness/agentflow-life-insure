// Corrective pass (2026-09-16), item 1 (producer) — ownership of the provider-side recording in
// twilio-recording-status' voicemail branch.
//
// Deployed v35 contains:
//     const callAccountSid = params["AccountSid"] ?? creds.accountSid;
// and uses that value both for the DELETE URL and for `p_account_sid`. When the callback carries no
// AccountSid the platform account is substituted, the DELETE is aimed at the wrong account, a 404
// reads as "already gone", and the guess is persisted as authoritative — so a later cleanup retry
// trusts it too. This suite pins the corrected contract: ownership is ESTABLISHED, never assumed.
//
// NOTE ON PROVENANCE: the deployed recording-retention-purge (v29) contains no Twilio-source cleanup
// at all. The substituting fallback lived in the unreleased 411faf4 purge source and in this
// voicemail callback — not in anything deployed as v29.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  decideVoicemailResponseStatus,
  resolveVoicemailOwner,
} from "../../../supabase/functions/twilio-recording-status/idempotency";

const REPO = path.resolve(__dirname, "../../..");
const PARENT = "AC" + "a".repeat(32);
const SUB_B = "AC" + "b".repeat(32);
const SUB_C = "AC" + "c".repeat(32);

function gitRefReadable(ref: string): boolean {
  try {
    execFileSync("git", ["cat-file", "-e", ref], { cwd: REPO, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("the deployed v35 substitution, pinned", () => {
  it.skipIf(!gitRefReadable("0707038"))("is present in the source this pass corrects", () => {
    const deployed = execFileSync(
      "git",
      ["show", "0707038:supabase/functions/twilio-recording-status/index.ts"],
      { cwd: REPO, encoding: "utf8" },
    );
    // the exact line the reviewer quoted
    expect(deployed).toContain('const callAccountSid = params["AccountSid"] ?? creds.accountSid;');
    expect(deployed).toContain("p_account_sid: callAccountSid,");
    // and it is gone from the corrected source
    const corrected = execFileSync(
      "git",
      ["show", "HEAD:supabase/functions/twilio-recording-status/index.ts"],
      { cwd: REPO, encoding: "utf8" },
    );
    void corrected; // HEAD may predate the fix; the working tree is what the next assertions cover
  });

  it("the working tree no longer substitutes the platform account", () => {
    const wt = execFileSync("cat", ["supabase/functions/twilio-recording-status/index.ts"], {
      cwd: REPO,
      encoding: "utf8",
    });
    expect(wt).not.toContain('params["AccountSid"] ?? creds.accountSid');
    expect(wt).not.toContain("p_account_sid: callAccountSid");
    expect(wt).toContain("resolveVoicemailOwner");
    expect(wt).toContain("p_account_sid: ownerAccountSid,");
  });
});

describe("resolveVoicemailOwner", () => {
  it("the signature-validated callback establishes ownership", () => {
    expect(resolveVoicemailOwner({ callbackAccountSid: SUB_B, storedAccountSid: null })).toEqual({
      kind: "established",
      accountSid: SUB_B,
      source: "callback",
    });
  });

  it("an already-stored owner establishes ownership for a retry with no callback account", () => {
    expect(resolveVoicemailOwner({ callbackAccountSid: "", storedAccountSid: SUB_B })).toEqual({
      kind: "established",
      accountSid: SUB_B,
      source: "stored",
    });
  });

  it("a matching stored owner and callback agree", () => {
    const r = resolveVoicemailOwner({ callbackAccountSid: SUB_B, storedAccountSid: SUB_B });
    expect(r).toEqual({ kind: "established", accountSid: SUB_B, source: "callback" });
  });

  it("CONFLICT: a stored owner that disagrees with the callback is never silently overwritten", () => {
    expect(resolveVoicemailOwner({ callbackAccountSid: SUB_C, storedAccountSid: SUB_B })).toEqual({
      kind: "conflict",
      callbackAccountSid: SUB_C,
      storedAccountSid: SUB_B,
    });
  });

  it("REPRODUCTION: an absent callback account no longer resolves to the platform account", () => {
    const r = resolveVoicemailOwner({ callbackAccountSid: null, storedAccountSid: null });
    expect(r).toEqual({ kind: "unresolved", reason: "absent" });
    // the deployed behaviour would have produced the platform account here
    expect(JSON.stringify(r)).not.toContain(PARENT);
  });

  it("a malformed account SID is unresolved, never a fallback and never part of a URL", () => {
    for (const bad of ["ACshort", "../../Accounts/ACevil", "AC" + "z".repeat(32), "  ", "AC"]) {
      const r = resolveVoicemailOwner({ callbackAccountSid: bad, storedAccountSid: null });
      expect(r.kind).toBe("unresolved");
    }
    expect(resolveVoicemailOwner({ callbackAccountSid: "ACshort", storedAccountSid: null })).toEqual({
      kind: "unresolved",
      reason: "malformed",
    });
  });

  it("whitespace around a valid SID is tolerated", () => {
    expect(resolveVoicemailOwner({ callbackAccountSid: `  ${SUB_B} `, storedAccountSid: null })).toEqual({
      kind: "established",
      accountSid: SUB_B,
      source: "callback",
    });
  });

  it("is case-insensitive about the hexadecimal body, as Twilio SIDs are", () => {
    const upper = "AC" + "B".repeat(32);
    expect(resolveVoicemailOwner({ callbackAccountSid: upper, storedAccountSid: null }).kind).toBe("established");
  });
});

describe("ownership outcomes are recoverable, not acknowledgements", () => {
  it("a conflict and an unresolved owner both answer 503 so the source is redelivered", () => {
    expect(decideVoicemailResponseStatus("ownership_conflict")).toBe(503);
    expect(decideVoicemailResponseStatus("ownership_unresolved")).toBe(503);
  });

  it("the existing outcomes are unchanged", () => {
    expect(decideVoicemailResponseStatus("stored")).toBe(200);
    expect(decideVoicemailResponseStatus("stored_notify_pending")).toBe(200);
    expect(decideVoicemailResponseStatus("skip_already_stored")).toBe(200);
    expect(decideVoicemailResponseStatus("cleanup_done")).toBe(200);
    expect(decideVoicemailResponseStatus("unmatched")).toBe(200);
    expect(decideVoicemailResponseStatus("invalid_request")).toBe(200);
    expect(decideVoicemailResponseStatus("ignored")).toBe(200);
    expect(decideVoicemailResponseStatus("retryable_failure")).toBe(503);
    expect(decideVoicemailResponseStatus("stored_cleanup_failed")).toBe(503);
    expect(decideVoicemailResponseStatus("cleanup_retryable_failure")).toBe(503);
  });
});

describe("what the callback persists", () => {
  /** Mirrors the branch's decision: only an established owner is ever written. */
  function persistedAccountSid(callbackAccountSid: string | null, storedAccountSid: string | null) {
    const owner = resolveVoicemailOwner({ callbackAccountSid, storedAccountSid });
    return owner.kind === "established" ? owner.accountSid : null;
  }

  it("persists the established owner from the authenticated callback", () => {
    expect(persistedAccountSid(SUB_B, null)).toBe(SUB_B);
  });

  it("persists NOTHING when ownership cannot be established — never a guess", () => {
    expect(persistedAccountSid(null, null)).toBeNull();
    expect(persistedAccountSid("ACshort", null)).toBeNull();
  });

  it("a conflict persists nothing, leaving the stored owner authoritative", () => {
    expect(persistedAccountSid(SUB_C, SUB_B)).toBeNull();
  });

  it("the SQL coalesces an existing owner over an incoming null, so a null can never erase one", () => {
    const m7 = execFileSync("cat", ["supabase/migrations/20260915053646_inbound_voicemails.sql"], {
      cwd: REPO,
      encoding: "utf8",
    });
    expect(m7).toContain("provider_account_sid = coalesce(v.provider_account_sid, EXCLUDED.provider_account_sid)");
  });
});
