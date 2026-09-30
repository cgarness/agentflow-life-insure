// Inbound Calling v2 voicemail recording pipeline — fail-first tests (implementation_plan.md rev 3 §10,
// §8.6; safeguards 2 and 3). Pure helpers from twilio-recording-status/idempotency.ts.
import { describe, expect, it } from "vitest";
import {
  classifyVoicemailRow,
  decideVoicemailResponseStatus,
  parseVoicemailCallbackQuery,
  readVoicemailCallbackQuery,
  runVoicemailCleanupRetry,
  runVoicemailPipeline,
} from "../../../supabase/functions/twilio-recording-status/idempotency";

const A1 = "aaaaaaaa-0000-0000-0000-0000000000a1";
const ORG = "aaaaaaaa-0000-0000-0000-00000000000a";
const CALL = "cccccccc-0000-0000-0000-000000000001";

function deps(over: Partial<Parameters<typeof runVoicemailPipeline>[0]> = {}) {
  const calls: string[] = [];
  const d: Parameters<typeof runVoicemailPipeline>[0] = {
    download: async () => { calls.push("download"); return new Uint8Array([1]); },
    upload: async () => { calls.push("upload"); },
    persistStored: async () => { calls.push("persistStored"); },
    persistFailed: async (stage) => { calls.push(`persistFailed:${stage}`); },
    deleteSource: async () => { calls.push("deleteSource"); },
    markSourceDeleted: async () => { calls.push("markSourceDeleted"); },
    recordCleanupFailure: async () => { calls.push("recordCleanupFailure"); },
    notify: async () => { calls.push("notify"); return true; },
    ...over,
  };
  return { d, calls };
}

describe("VM1 — ordered pipeline: media + metadata before source deletion, notification last", () => {
  it("happy path", async () => {
    const { d, calls } = deps();
    const r = await runVoicemailPipeline(d);
    expect(r).toEqual({ outcome: "stored", notified: true });
    expect(calls).toEqual(["download", "upload", "persistStored", "deleteSource", "markSourceDeleted", "notify"]);
  });

  it("download / upload / persist failure ⇒ source preserved, failed row best-effort, 503", async () => {
    for (const stage of ["download", "upload", "persistStored"] as const) {
      const { d, calls } = deps({ [stage]: async () => { throw new Error(stage); } });
      const r = await runVoicemailPipeline(d);
      expect(r.outcome).toBe("retryable_failure");
      expect(calls).not.toContain("deleteSource");
      expect(calls.some((c) => c.startsWith("persistFailed:"))).toBe(true);
      expect(decideVoicemailResponseStatus(r.outcome)).toBe(503);
    }
  });
});

describe("VM2 — safeguard 3: a failed source deletion after storage is a DURABLE retryable state", () => {
  it("delete failure ⇒ recordCleanupFailure (attempts/backoff in SQL), 503, no re-download on redelivery", async () => {
    const { d, calls } = deps({ deleteSource: async () => { throw new Error("HTTP 503"); } });
    const r = await runVoicemailPipeline(d);
    expect(r).toEqual({ outcome: "stored_cleanup_failed", stage: "delete" });
    expect(calls).toEqual(["download", "upload", "persistStored", "recordCleanupFailure"]);
    expect(decideVoicemailResponseStatus(r.outcome)).toBe(503);
    // the redelivered callback classifies the stored-but-undeleted row as cleanup-only
    expect(classifyVoicemailRow({ status: "stored", storage_path: "o/p.mp3", source_cleanup_state: "failed" })).toBe("cleanup_retry");
    expect(classifyVoicemailRow({ status: "stored", storage_path: "o/p.mp3", source_cleanup_state: "pending" })).toBe("cleanup_retry");
    const retry = await runVoicemailCleanupRetry({
      deleteSource: async () => {}, markSourceDeleted: async () => {}, recordCleanupFailure: async () => {}, notify: async () => true,
    });
    expect(retry).toEqual({ outcome: "cleanup_done", notified: true });
    expect(decideVoicemailResponseStatus(retry.outcome)).toBe(200);
  });

  it("cleanup-only retry that fails again stays retryable and records the failure", async () => {
    const recorded: string[] = [];
    const r = await runVoicemailCleanupRetry({
      deleteSource: async () => { throw new Error("HTTP 500"); },
      markSourceDeleted: async () => {},
      recordCleanupFailure: async (m) => { recorded.push(m); },
      notify: async () => true,
    });
    expect(r).toEqual({ outcome: "cleanup_retryable_failure" });
    expect(recorded).toEqual(["HTTP 500"]);
    expect(decideVoicemailResponseStatus(r.outcome)).toBe(503);
  });

  it("fully done rows are acked 200 without any deletion; recoverable rows are processed", () => {
    expect(classifyVoicemailRow({ status: "stored", storage_path: "o/p.mp3", source_cleanup_state: "deleted" })).toBe("skip_already_stored");
    expect(classifyVoicemailRow({ status: "purged", storage_path: null, source_cleanup_state: "deleted" })).toBe("skip_already_stored");
    expect(classifyVoicemailRow({ status: "pending", storage_path: null, source_cleanup_state: "pending" })).toBe("process");
    expect(classifyVoicemailRow({ status: "failed", storage_path: null, source_cleanup_state: "pending" })).toBe("process");
    expect(classifyVoicemailRow(null)).toBe("process");
  });
});

describe("VM3 — §8.6 / safeguard 2: stored + deleted answers 200 even when the notification is still owed", () => {
  it("notification failure after storage ⇒ stored_notify_pending, 200 (the SQL sweep owns it)", async () => {
    const { d } = deps({ notify: async () => false });
    const r = await runVoicemailPipeline(d);
    expect(r).toEqual({ outcome: "stored_notify_pending", notified: false });
    expect(decideVoicemailResponseStatus(r.outcome)).toBe(200);
    const thrown = deps({ notify: async () => { throw new Error("rpc"); } });
    expect((await runVoicemailPipeline(thrown.d)).outcome).toBe("stored_notify_pending");
  });

  it("response policy table", () => {
    expect(decideVoicemailResponseStatus("stored")).toBe(200);
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

describe("VM4 — the mailbox comes ONLY from the signed query, validated", () => {
  it("accepts agent:<uuid> and group with well-formed ids; attempt_id optional (nullable, validated in SQL)", () => {
    expect(parseVoicemailCallbackQuery({ source: "voicemail", mailbox: `agent:${A1}`, call_row_id: CALL, org_id: ORG, attempt_id: null }))
      .toEqual({ ok: true, mailbox: `agent:${A1}`, callRowId: CALL, orgId: ORG, attemptId: null });
    expect(parseVoicemailCallbackQuery({ source: "voicemail", mailbox: "group", call_row_id: CALL, org_id: ORG, attempt_id: "eeeeeeee-0000-0000-0000-000000000001" }))
      .toMatchObject({ ok: true, mailbox: "group", attemptId: "eeeeeeee-0000-0000-0000-000000000001" });
  });

  it("refuses a missing source, a free-text mailbox, a phone number as mailbox, or malformed ids", () => {
    expect(parseVoicemailCallbackQuery({ source: null, mailbox: "group", call_row_id: CALL, org_id: ORG })).toMatchObject({ ok: false, reason: "not_voicemail" });
    expect(parseVoicemailCallbackQuery({ source: "voicemail", mailbox: "agent:+15559990001", call_row_id: CALL, org_id: ORG })).toMatchObject({ ok: false, reason: "invalid_mailbox" });
    expect(parseVoicemailCallbackQuery({ source: "voicemail", mailbox: "everyone", call_row_id: CALL, org_id: ORG })).toMatchObject({ ok: false, reason: "invalid_mailbox" });
    expect(parseVoicemailCallbackQuery({ source: "voicemail", mailbox: "group", call_row_id: "x", org_id: ORG })).toMatchObject({ ok: false, reason: "invalid_ids" });
    expect(parseVoicemailCallbackQuery({ source: "voicemail", mailbox: "group", call_row_id: CALL, org_id: ORG, attempt_id: "nope" })).toMatchObject({ ok: false, reason: "invalid_attempt_id" });
  });
});

describe("VM4b — agent-voicemail callback repair (2026-09-30): new form, legacy compatibility, fail-closed conflicts", () => {
  const ATT = "eeeeeeee-0000-0000-0000-000000000001";
  const A2 = "aaaaaaaa-0000-0000-0000-0000000000a2";
  const ids = `call_row_id=${CALL}&org_id=${ORG}&attempt_id=${ATT}`;
  const read = (search: string) => readVoicemailCallbackQuery(new URLSearchParams(search));
  const agentOk = { ok: true, mailbox: `agent:${A1}`, callRowId: CALL, orgId: ORG, attemptId: ATT };

  it("accepts the NEW agent form and canonicalizes it to the internal 'agent:<uuid>' string", () => {
    expect(read(`source=voicemail&mailbox=agent&mailbox_agent_id=${A1}&${ids}`)).toEqual(agentOk);
    expect(read(`source=voicemail&mailbox=agent&mailbox_agent_id=${A1.toUpperCase()}&${ids}`)).toEqual(agentOk);
    // attempt_id stays optional (the safe paths omit it) and validated when present, exactly as before
    expect(read(`source=voicemail&mailbox=agent&mailbox_agent_id=${A1}&call_row_id=${CALL}&org_id=${ORG}`))
      .toEqual({ ...agentOk, attemptId: null });
    expect(read(`source=voicemail&mailbox=agent&mailbox_agent_id=${A1}&call_row_id=x&org_id=${ORG}`)).toMatchObject({ ok: false, reason: "invalid_ids" });
    expect(read(`source=voicemail&mailbox=agent&mailbox_agent_id=${A1}&call_row_id=${CALL}&org_id=${ORG}&attempt_id=nope`)).toMatchObject({ ok: false, reason: "invalid_attempt_id" });
  });

  it("LEGACY COMPATIBILITY: a legacy agent:<uuid> query (encoded or not) and a legacy group query still parse", () => {
    expect(read(`source=voicemail&mailbox=agent%3A${A1}&${ids}`)).toEqual(agentOk);
    expect(read(`source=voicemail&mailbox=agent:${A1}&${ids}`)).toEqual(agentOk);
    expect(read(`source=voicemail&mailbox=agent:${A1.toUpperCase()}&${ids}`)).toEqual(agentOk);
    expect(read(`source=voicemail&mailbox=group&${ids}`)).toEqual({ ok: true, mailbox: "group", callRowId: CALL, orgId: ORG, attemptId: ATT });
  });

  it("CONFLICTING identities fail closed — never reconciled or guessed", () => {
    for (const extra of [`mailbox_agent_id=${A1}`, `mailbox_agent_id=${A2}`, "mailbox_agent_id="]) {
      expect(read(`source=voicemail&mailbox=agent:${A1}&${extra}&${ids}`)).toEqual({ ok: false, reason: "conflicting_mailbox" });
      // a group mailbox never takes an agent id as ownership authority — not even an empty one
      expect(read(`source=voicemail&mailbox=group&${extra}&${ids}`)).toEqual({ ok: false, reason: "conflicting_mailbox" });
    }
  });

  it("MISSING or INVALID mailbox_agent_id fails closed", () => {
    for (const idPart of ["", "&mailbox_agent_id=", "&mailbox_agent_id=nope", `&mailbox_agent_id=agent:${A1}`, "&mailbox_agent_id=%2B15559990001", `&mailbox_agent_id=${A1}x`]) {
      expect(read(`source=voicemail&mailbox=agent${idPart}&${ids}`)).toEqual({ ok: false, reason: "invalid_mailbox_agent_id" });
    }
  });

  it("mailbox values are exact and case-sensitive (SQL's LIKE 'agent:%' is case-sensitive)", () => {
    for (const mb of [`AGENT:${A1}`, `Agent:${A1}`, "GROUP", "Group", "AGENT", "agents", `agent%3A${A1}x`, "agent%3A"]) {
      expect(read(`source=voicemail&mailbox=${mb}&mailbox_agent_id=${A1}&${ids}`)).toMatchObject({ ok: false });
      expect(read(`source=voicemail&mailbox=${mb}&${ids}`)).toMatchObject({ ok: false });
    }
    expect(read(`source=voicemail&mailbox=AGENT:${A1}&${ids}`)).toEqual({ ok: false, reason: "invalid_mailbox" });
  });

  it("any DUPLICATED key fails closed (URLSearchParams.get would silently take the first)", () => {
    const good = `source=voicemail&mailbox=agent&mailbox_agent_id=${A1}&${ids}`;
    for (const dup of ["source=voicemail", "mailbox=agent", "mailbox=group", `mailbox_agent_id=${A1}`, `mailbox_agent_id=${A2}`,
      `call_row_id=${CALL}`, `org_id=${ORG}`, `attempt_id=${ATT}`]) {
      expect(read(`${good}&${dup}`)).toEqual({ ok: false, reason: "duplicate_param" });
      expect(read(`${dup}&${good}`)).toEqual({ ok: false, reason: "duplicate_param" });
    }
  });

  it("source must be exactly 'voicemail'", () => {
    for (const src of ["Voicemail", "VOICEMAIL", "voicemail ", "x", ""]) {
      expect(read(`source=${encodeURIComponent(src)}&mailbox=group&${ids}`)).toEqual({ ok: false, reason: "not_voicemail" });
    }
    expect(read(`mailbox=group&${ids}`)).toEqual({ ok: false, reason: "not_voicemail" });
  });
});
