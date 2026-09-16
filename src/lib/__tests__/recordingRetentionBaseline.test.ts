// Corrective pass (2026-09-16) — REPRODUCTION suite.
//
// These tests run against the PREVIOUS source of recording-retention-purge's voicemail source-cleanup
// pass, extracted verbatim from commit 411faf4 (see fixtures/recordingRetentionBaseline411faf4.ts).
// They document the four defects the independent reviewer reproduced, so the corrected behaviour in
// recordingRetentionVoicemail.test.ts is a measured change and not an assertion of intent.
//
//   D1  provider DELETE succeeds, the metadata RPC errors -> one deletion reported, cleanup left
//       pending, nothing logged.
//   D2  provider DELETE fails and recording the failure also errors -> attempts never advance, and
//       nothing indicates the persistence failed.
//   D3  101 healthy eligible rows -> only 100 are ever processed.
//   D4  a stalled first DELETE has no AbortSignal and blocks every later row.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { retryVoicemailSourceCleanup } from "./fixtures/recordingRetentionBaseline411faf4";

const REPO = path.resolve(__dirname, "../../..");
const SID = (n: number) => "RE" + n.toString(16).padStart(32, "0");

interface Call {
  fn: string;
  args: Record<string, unknown>;
}

/** Minimal supabase double: records rpc calls and answers from a per-function script. */
function fakeSupabase(handlers: Record<string, (args: Record<string, unknown>) => unknown>) {
  const calls: Call[] = [];
  return {
    calls,
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      const h = handlers[fn];
      return Promise.resolve(h ? h(args) : { data: null, error: null });
    },
  };
}

let realFetch: typeof globalThis.fetch;
beforeEach(() => {
  realFetch = globalThis.fetch;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function gitRefReadable(ref: string): boolean {
  try {
    execFileSync("git", ["cat-file", "-e", ref], { cwd: REPO, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("baseline fixture fidelity", () => {
  // Shells out to git, so it is skipped rather than failed in a shallow clone without the commit.
  it.skipIf(!gitRefReadable("411faf4"))("is byte-identical to 411faf4 after the credential prologue", () => {
    const fixture = readFileSync(
      path.join(REPO, "src/lib/__tests__/fixtures/recordingRetentionBaseline411faf4.ts"),
      "utf8",
    );
    const original = execFileSync(
      "git",
      ["show", "411faf4:supabase/functions/recording-retention-purge/index.ts"],
      { cwd: REPO, encoding: "utf8" },
    );
    // the approved-but-never-deployed 411faf4 source, pinned by hash
    expect(createHash("sha256").update(original).digest("hex")).toBe(
      "c80e3a61a72750b7c42cd23c4c99347c399f5675cdd9a01bf82668c2cdeffb83",
    );
    // everything after `const out = { deleted: 0, failed: 0 };` must match the original verbatim
    const marker = "  const out = { deleted: 0, failed: 0 };\n";
    const fixtureTail = fixture.slice(fixture.indexOf(marker) + marker.length);
    const originalTail = original.slice(
      original.indexOf("async function retryVoicemailSourceCleanup"),
    );
    const originalBodyTail = originalTail.slice(
      originalTail.indexOf('const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");\n') +
        'const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");\n'.length,
    );
    expect(fixtureTail).toBe(originalBodyTail);
  });
});

describe("D1 — provider DELETE succeeds but the metadata RPC errors (411faf4)", () => {
  it("reports one deletion, leaves cleanup pending, and logs nothing about the failure", async () => {
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 204 })) as typeof globalThis.fetch;
    const db = fakeSupabase({
      voicemails_cleanup_batch: () => ({
        data: [{ id: "r1", recording_sid: SID(1), provider_account_sid: null }],
        error: null,
      }),
      mark_voicemail_source_deleted: () => ({ data: null, error: { message: "statement timeout" } }),
    });

    const out = await retryVoicemailSourceCleanup(db, "ACtest", "tok");

    // the defect: a cleanup the database never recorded is counted as done
    expect(out).toEqual({ deleted: 1, failed: 0 });
    // and the error is invisible
    expect(console.error).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
    // the row's durable state was never advanced, so the obligation silently persists
    expect(db.calls.filter((c) => c.fn === "record_voicemail_cleanup_failure")).toHaveLength(0);
  });
});

describe("D2 — provider DELETE fails and recording the failure also errors (411faf4)", () => {
  /** Runs the baseline against one row whose provider DELETE fails, modelling source_cleanup_attempts. */
  async function runWithFailureRpc(rpcErrors: boolean) {
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 500 })) as typeof globalThis.fetch;
    let attempts = 0; // stands in for voicemails.source_cleanup_attempts
    const db = fakeSupabase({
      voicemails_cleanup_batch: () => ({
        data: [{ id: "r1", recording_sid: SID(2), provider_account_sid: null }],
        error: null,
      }),
      record_voicemail_cleanup_failure: () => {
        if (rpcErrors) return { data: null, error: { message: "deadlock detected" } };
        attempts += 1;
        return { data: { updated: true }, error: null };
      },
    });
    const out = await retryVoicemailSourceCleanup(db, "ACtest", "tok");
    return { out, attempts: () => attempts };
  }

  it("control: when the RPC succeeds the attempt counter does advance", async () => {
    const { out, attempts } = await runWithFailureRpc(false);
    expect(out).toEqual({ deleted: 0, failed: 1 });
    expect(attempts()).toBe(1);
  });

  it("leaves the attempt counter unchanged with no indication that persistence failed", async () => {
    const { out, attempts } = await runWithFailureRpc(true);

    // identical reported result to the control above — the caller cannot tell them apart
    expect(out).toEqual({ deleted: 0, failed: 1 });
    expect(attempts()).toBe(0); // nothing advanced it
    expect(console.error).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe("D3 — 101 healthy eligible rows (411faf4)", () => {
  it("processes only the first 100 and never asks for another batch", async () => {
    const eligible = new Set(Array.from({ length: 101 }, (_, i) => `r${i}`));
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 204 })) as typeof globalThis.fetch;
    const db = fakeSupabase({
      voicemails_cleanup_batch: (args) => {
        const limit = Number(args.p_limit);
        const rows = [...eligible].slice(0, limit).map((id) => ({
          id,
          recording_sid: SID(Number(id.slice(1)) + 100),
          provider_account_sid: null,
        }));
        return { data: rows, error: null };
      },
      mark_voicemail_source_deleted: (args) => {
        const sid = String(args.p_recording_sid);
        eligible.delete(`r${parseInt(sid.slice(2), 16) - 100}`);
        return { data: { updated: true }, error: null };
      },
    });

    const out = await retryVoicemailSourceCleanup(db, "ACtest", "tok");

    expect(out.deleted).toBe(100); // the 101st row is never touched
    expect(eligible.size).toBe(1);
    expect(db.calls.filter((c) => c.fn === "voicemails_cleanup_batch")).toHaveLength(1);
  });
});

describe("D4 — a stalled first DELETE (411faf4)", () => {
  it("blocks every later row: no AbortSignal, strictly sequential", async () => {
    let issued = 0;
    let releaseFirst: (() => void) | undefined;
    const signals: (AbortSignal | undefined)[] = [];
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      issued += 1;
      signals.push(init?.signal ?? undefined);
      if (issued === 1) {
        await new Promise<void>((resolve) => { releaseFirst = resolve; });
      }
      return new Response(null, { status: 204 });
    }) as unknown as typeof globalThis.fetch;

    const db = fakeSupabase({
      voicemails_cleanup_batch: () => ({
        data: [
          { id: "r1", recording_sid: SID(11), provider_account_sid: null },
          { id: "r2", recording_sid: SID(12), provider_account_sid: null },
        ],
        error: null,
      }),
      mark_voicemail_source_deleted: () => ({ data: { updated: true }, error: null }),
    });

    const running = retryVoicemailSourceCleanup(db, "ACtest", "tok");
    // drain the microtask queue: the second row still has not started
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(issued).toBe(1);
    expect(signals[0]).toBeUndefined(); // no cancellation is possible

    releaseFirst?.();
    const out = await running;
    expect(out.deleted).toBe(2);
    expect(issued).toBe(2);
  });
});
