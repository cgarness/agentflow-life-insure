// Corrective pass (2026-09-16) — CORRECTED behaviour of recording-retention-purge's voicemail phases.
//
// The four defects D1-D4 each have a counterpart in recordingRetentionBaseline.test.ts, which
// demonstrates the same input against the 411faf4 source and shows the old behaviour failing. The
// remaining cases here specify NEW contract the previous revision had no equivalent for (explicit
// phase outcomes, budgets, readback, ceiling visibility) and are not claimed as measured regressions
// against it. The contract under test:
//   * provider deletion and database reconciliation are counted separately and never conflated;
//   * `{updated:false}` is resolved by bounded readback, not assumed to mean success;
//   * a failed failure-record leaves the obligation outstanding and never credits the attempt counter;
//   * provider requests are cancellable, database waits are bounded, and a timeout is UNKNOWN;
//   * the pass walks past the first batch, bounds its own concurrency, and stops when it stops making
//     progress;
//   * degraded outcomes are distinguishable from a healthy empty queue.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LIMITS,
  PROVIDER_WAIT_GRACE_MS,
  phaseDeadline,
  VOICEMAIL_UNHEARD_MAX_DAYS,
  boundedDb,
  providerConfirmsDeleted,
  runBounded,
  runVoicemailPhases,
  runVoicemailRetention,
  runVoicemailSourceCleanup,
  type CleanupRow,
  type ProviderResult,
  type VoicemailDeps,
} from "../../../supabase/functions/recording-retention-purge/voicemail";

const REPO = path.resolve(__dirname, "../../..");
const ORG = "aaaaaaaa-0000-0000-0000-00000000000a";
const sid = (n: number) => "RE" + n.toString(16).padStart(32, "0");

interface Row {
  id: string;
  recording_sid: string;
  provider_account_sid: string | null;
  cleanup_state: "pending" | "failed" | "deleted";
  attempts: number;
  next_at: number | null;
}

interface Harness {
  deps: VoicemailDeps;
  rows: Row[];
  clock: { t: number };
  logs: Array<{ level: string; message: string; detail?: Record<string, unknown> }>;
  providerCalls: Array<{ sid: string; owner: string; timeoutMs: number }>;
  batchCalls: number;
}

/** A model of the voicemails table faithful to M7's three cleanup RPCs. */
function harness(opts: {
  rows?: Row[];
  provider?: (sid: string, n: number) => Promise<ProviderResult>;
  markSourceDeleted?: (sid: string) => Promise<{ data: unknown; error: { message: string } | null }>;
  recordCleanupFailure?: (sid: string) => Promise<{ data: unknown; error: { message: string } | null }>;
  readCleanupState?: (sid: string) => Promise<{ data: unknown; error: { message: string } | null }>;
  cleanupBatch?: (limit: number, n: number) => Promise<{ data: unknown; error: { message: string } | null }>;
  credentials?: () => { accountSid: string; authToken: string } | null;
  onProviderStart?: () => void;
} = {}): Harness {
  const rows = opts.rows ?? [];
  const clock = { t: 1_000_000 };
  const logs: Harness["logs"] = [];
  const providerCalls: Harness["providerCalls"] = [];
  const h = { rows, clock, logs, providerCalls, batchCalls: 0 } as Harness;
  const find = (s: string) => rows.find((r) => r.recording_sid === s);

  h.deps = {
    nowMs: () => clock.t,
    invocationStartMs: clock.t,
    retentionAnchorMs: clock.t,

    listRoutingSettings: async () => ({ data: [], error: null }),
    expiredBatch: async () => ({ data: [], error: null }),
    removeObjects: async () => ({ data: null, error: null }),
    markPurged: async () => ({ data: 0, error: null }),

    credentials: opts.credentials ?? (() => ({ accountSid: "ACtest", authToken: "tok" })),
    cleanupBatch: async (limit) => {
      const n = h.batchCalls++;
      if (opts.cleanupBatch) return opts.cleanupBatch(limit, n) as never;
      const due = rows
        .filter((r) => r.cleanup_state !== "deleted" && r.attempts < 50 && (r.next_at === null || r.next_at <= clock.t))
        .slice(0, limit)
        .map(({ id, recording_sid, provider_account_sid, attempts }) => ({
          id, recording_sid, provider_account_sid, source_cleanup_attempts: attempts,
        }));
      return { data: due, error: null };
    },
    deleteProviderRecording: async ({ ownerAccountSid, recordingSid, timeoutMs }) => {
      const n = providerCalls.length;
      providerCalls.push({ sid: recordingSid, owner: ownerAccountSid, timeoutMs });
      opts.onProviderStart?.();
      if (opts.provider) return opts.provider(recordingSid, n);
      return { kind: "status", status: 204 };
    },
    markSourceDeleted: async (s) => {
      if (opts.markSourceDeleted) return opts.markSourceDeleted(s) as never;
      const r = find(s);
      if (r && r.cleanup_state !== "deleted") {
        r.cleanup_state = "deleted";
        return { data: { updated: true }, error: null };
      }
      return { data: { updated: false }, error: null };
    },
    recordCleanupFailure: async (s) => {
      if (opts.recordCleanupFailure) return opts.recordCleanupFailure(s) as never;
      const r = find(s);
      if (r && r.cleanup_state !== "deleted") {
        r.cleanup_state = "failed";
        r.attempts += 1;
        r.next_at = clock.t + 60_000;
        return { data: { updated: true }, error: null };
      }
      return { data: { updated: false }, error: null };
    },
    readCleanupState: async (s) => {
      if (opts.readCleanupState) return opts.readCleanupState(s) as never;
      const r = find(s);
      return { data: r ? { source_cleanup_state: r.cleanup_state } : null, error: null };
    },
    log: (level, message, detail) => logs.push({ level, message, detail }),
  };
  return h;
}

function makeRows(n: number, from = 1): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `r${from + i}`,
    recording_sid: sid(from + i),
    provider_account_sid: null,
    cleanup_state: "pending" as const,
    attempts: 0,
    next_at: null,
  }));
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ── 1. Durable cleanup reporting ─────────────────────────────────────────────────────────────────

describe("cleanup reporting distinguishes provider deletion from database reconciliation", () => {
  it("D1 (returned error): provider confirmed + metadata RPC errors -> unresolved, not a completed cleanup", async () => {
    const h = harness({
      rows: makeRows(1),
      markSourceDeleted: async () => ({ data: null, error: { message: "statement timeout" } }),
    });
    const out = await runVoicemailSourceCleanup(h.deps);

    expect(out.provider_deletions).toBe(1); // provider side only
    expect(out.reconciled).toBe(0); // NOT reported as durable cleanup
    expect(out.unresolved).toBe(1);
    expect(out.status).toBe("failed");
    expect(h.logs.some((l) => l.level === "error" && /database reconciliation FAILED/.test(l.message))).toBe(true);
    expect(h.rows[0].cleanup_state).not.toBe("deleted"); // the obligation stands
  });

  it("D1 (thrown error): a metadata RPC that rejects is handled the same way", async () => {
    const h = harness({
      rows: makeRows(1),
      markSourceDeleted: async () => {
        throw new Error("connection reset");
      },
    });
    const out = await runVoicemailSourceCleanup(h.deps);
    expect(out.provider_deletions).toBe(1);
    expect(out.reconciled).toBe(0);
    expect(out.unresolved).toBe(1);
    expect(h.logs.some((l) => /connection reset/.test(String(l.detail?.error)))).toBe(true);
  });

  it("D2 (returned error): provider failed AND recording the failure errors -> unresolved, attempts NOT credited", async () => {
    const h = harness({
      rows: makeRows(1),
      provider: async () => ({ kind: "status", status: 500 }),
      recordCleanupFailure: async () => ({ data: null, error: { message: "deadlock detected" } }),
    });
    const out = await runVoicemailSourceCleanup(h.deps);

    expect(out.provider_failures).toBe(1);
    expect(out.provider_failures_recorded).toBe(0); // nothing was durably recorded
    expect(out.unresolved).toBe(1);
    expect(out.status).toBe("failed");
    expect(h.rows[0].attempts).toBe(0);
    const log = h.logs.find((l) => /recording that failure did not confirm/.test(l.message));
    expect(log?.level).toBe("error");
    expect(String(log?.detail?.note)).toMatch(/50-attempt ceiling cannot protect/);
    expect(String(log?.detail?.attempt_counter)).toBe("not credited");
  });

  it("D2 (thrown error): a failure-record RPC that rejects is handled the same way", async () => {
    const h = harness({
      rows: makeRows(1),
      provider: async () => ({ kind: "status", status: 503 }),
      recordCleanupFailure: async () => {
        throw new Error("socket hang up");
      },
    });
    const out = await runVoicemailSourceCleanup(h.deps);
    expect(out.provider_failures_recorded).toBe(0);
    expect(out.unresolved).toBe(1);
    expect(h.rows[0].attempts).toBe(0);
  });

  it("provider failure that IS recorded advances attempts and counts separately", async () => {
    const h = harness({ rows: makeRows(1), provider: async () => ({ kind: "status", status: 500 }) });
    const out = await runVoicemailSourceCleanup(h.deps);
    expect(out.provider_failures).toBe(1);
    expect(out.provider_failures_recorded).toBe(1);
    expect(out.unresolved).toBe(0);
    expect(h.rows[0].attempts).toBe(1);
    expect(h.rows[0].next_at).toBeGreaterThan(h.clock.t);
    // recording the failure perfectly is still OUTSTANDING work, never a healthy completion
    expect(out.status).toBe("partial");
    expect(out.reason).toBe("provider_failures");
  });

  it("a pass in which every provider DELETE failed is never reported as completed", async () => {
    const h = harness({ rows: makeRows(20), provider: async () => ({ kind: "status", status: 401 }) });
    const out = await runVoicemailSourceCleanup(h.deps);
    expect(out.provider_failures).toBe(20);
    expect(out.provider_failures_recorded).toBe(20);
    expect(out.status).not.toBe("completed");
    expect(out.status).toBe("partial");
  });

  it("an errored reconciliation whose write actually committed is recovered by readback", async () => {
    const rows = makeRows(1);
    const h = harness({
      rows,
      markSourceDeleted: async (sd) => {
        // the UPDATE commits, then the response is lost
        rows.find((r) => r.recording_sid === sd)!.cleanup_state = "deleted";
        return { data: null, error: { message: "connection lost after commit" } };
      },
    });
    const out = await runVoicemailSourceCleanup(h.deps);
    expect(out.reconciled).toBe(1);
    expect(out.unresolved).toBe(0);
    expect(h.logs.some((l) => /reads back as deleted/.test(l.message))).toBe(true);
  });

  it("a timed-out failure record never claims the attempt counter did or did not advance", async () => {
    const h = harness({
      rows: makeRows(1),
      provider: async () => ({ kind: "status", status: 500 }),
      recordCleanupFailure: async () => ({ data: null, error: { message: "canceling statement due to statement timeout" } }),
    });
    const out = await runVoicemailSourceCleanup(h.deps);
    expect(out.unresolved).toBe(1);
    const log = h.logs.find((l) => /recording that failure did not confirm/.test(l.message));
    expect(log).toBeDefined();
    expect(String(log?.detail?.attempt_counter)).toMatch(/not credited/);
    expect(String(log?.detail?.note)).toMatch(/did not confirm/);
  });

  it("surfaces rows about to cross M7's 50-attempt ceiling instead of letting them vanish", async () => {
    const rows = makeRows(2);
    rows[0].attempts = 49;
    const h = harness({ rows, provider: async () => ({ kind: "status", status: 500 }) });
    const out = await runVoicemailSourceCleanup(h.deps);
    expect(out.near_attempt_ceiling).toBe(1);
  });

  it("idempotent reconciliation: {updated:false} plus a readback of 'deleted' counts as reconciled", async () => {
    const rows = makeRows(1);
    rows[0].cleanup_state = "deleted"; // already reconciled by a concurrent actor
    const h = harness({
      rows,
      // the batch still offered it (a stale read), so force it through the pass
      cleanupBatch: async (_l, n) =>
        n === 0
          ? { data: [{ id: rows[0].id, recording_sid: rows[0].recording_sid, provider_account_sid: null }], error: null }
          : { data: [], error: null },
    });
    const out = await runVoicemailSourceCleanup(h.deps);
    expect(out.provider_deletions).toBe(1);
    expect(out.reconciled).toBe(1); // proved by readback, not assumed
    expect(out.unresolved).toBe(0);
    expect(out.status).toBe("completed");
  });

  it("{updated:false} with a MISSING row is unresolved, never a silent success", async () => {
    const h = harness({
      rows: makeRows(1),
      markSourceDeleted: async () => ({ data: { updated: false }, error: null }),
      readCleanupState: async () => ({ data: null, error: null }),
    });
    const out = await runVoicemailSourceCleanup(h.deps);
    expect(out.reconciled).toBe(0);
    expect(out.unresolved).toBe(1);
    expect(h.logs.some((l) => /row not found/.test(String(l.detail?.note)))).toBe(true);
  });

  it("{updated:false} with an unreadable readback is unresolved", async () => {
    const h = harness({
      rows: makeRows(1),
      markSourceDeleted: async () => ({ data: { updated: false }, error: null }),
      readCleanupState: async () => ({ data: null, error: { message: "permission denied" } }),
    });
    const out = await runVoicemailSourceCleanup(h.deps);
    expect(out.unresolved).toBe(1);
    expect(h.logs.some((l) => /readback failed/.test(String(l.detail?.note)))).toBe(true);
  });

  it("a failure-record answering {updated:false} on an already-deleted row discharges the obligation", async () => {
    const rows = makeRows(1);
    const h = harness({
      rows,
      provider: async () => ({ kind: "status", status: 500 }),
      recordCleanupFailure: async () => {
        rows[0].cleanup_state = "deleted"; // another actor finished it meanwhile
        return { data: { updated: false }, error: null };
      },
    });
    const out = await runVoicemailSourceCleanup(h.deps);
    expect(out.provider_failures).toBe(1);
    expect(out.reconciled).toBe(1);
    expect(out.unresolved).toBe(0);
  });
});

// ── 2. Provider outcomes ─────────────────────────────────────────────────────────────────────────

describe("provider outcomes", () => {
  it.each([
    ["2xx", 204, true],
    ["200", 200, true],
    ["404 (already gone)", 404, true],
    ["500", 500, false],
    ["401", 401, false],
  ])("%s", async (_label, status, confirmed) => {
    expect(providerConfirmsDeleted({ kind: "status", status })).toBe(confirmed);
    const h = harness({ rows: makeRows(1), provider: async () => ({ kind: "status", status }) });
    const out = await runVoicemailSourceCleanup(h.deps);
    expect(out.provider_deletions).toBe(confirmed ? 1 : 0);
    expect(out.reconciled).toBe(confirmed ? 1 : 0);
  });

  it("network failure is a provider failure and is durably recorded", async () => {
    const h = harness({
      rows: makeRows(1),
      provider: async () => ({ kind: "network", message: "getaddrinfo ENOTFOUND" }),
    });
    const out = await runVoicemailSourceCleanup(h.deps);
    expect(out.provider_failures_recorded).toBe(1);
    expect(h.rows[0].attempts).toBe(1);
  });

  it("a thrown provider dependency is normalised, not propagated", async () => {
    const h = harness({
      rows: makeRows(1),
      provider: async () => {
        throw new Error("fetch failed");
      },
    });
    const out = await runVoicemailSourceCleanup(h.deps);
    expect(out.provider_failures_recorded).toBe(1);
  });

  it("a provider timeout is a provider failure, and the request carries a cancellation budget", async () => {
    const h = harness({
      rows: makeRows(1),
      provider: async () => {
        throw new Error("The operation was aborted");
      },
    });
    const out = await runVoicemailSourceCleanup(h.deps);
    expect(out.provider_failures_recorded).toBe(1);
    expect(h.providerCalls[0].timeoutMs).toBe(LIMITS.PROVIDER_REQUEST_TIMEOUT_MS);
  });

  it("a malformed recording SID never reaches the provider", async () => {
    const rows = makeRows(1);
    rows[0].recording_sid = "NOT-A-SID";
    const h = harness({ rows });
    const out = await runVoicemailSourceCleanup(h.deps);
    expect(h.providerCalls).toHaveLength(0);
    expect(out.skipped_invalid_sid).toBe(1);
    expect(out.rows_attempted).toBe(0);
  });

  it("uses the row's owning account for the URL and the platform credential to authenticate", async () => {
    const sub = "AC" + "b".repeat(32);
    const rows = makeRows(1);
    rows[0].provider_account_sid = sub;
    const h = harness({ rows });
    await runVoicemailSourceCleanup(h.deps);
    expect(h.providerCalls[0].owner).toBe(sub);
  });

  it("a malformed owning account SID falls back to the platform account, never shaping the URL", async () => {
    const rows = makeRows(1);
    rows[0].provider_account_sid = "../../Accounts/ACevil";
    const h = harness({ rows });
    await runVoicemailSourceCleanup(h.deps);
    expect(h.providerCalls[0].owner).toBe("ACtest");
  });
});

// ── 3. Bounded execution and progress beyond one batch ───────────────────────────────────────────

describe("bounded execution", () => {
  it("D4 corrected: a stalled first row does not stop later rows", async () => {
    let release: (() => void) | undefined;
    const started: string[] = [];
    const h = harness({
      rows: makeRows(3),
      provider: async (s, n) => {
        started.push(s);
        if (n === 0) await new Promise<void>((r) => { release = r; });
        return { kind: "status", status: 204 };
      },
    });
    const running = runVoicemailSourceCleanup(h.deps);
    for (let i = 0; i < 50; i++) await Promise.resolve();

    expect(started.length).toBeGreaterThanOrEqual(3); // rows 2 and 3 started while row 1 hangs
    release?.();
    const out = await running;
    expect(out.reconciled).toBe(3);
    expect(out.status).toBe("completed");
  });

  it("D3 corrected: 101 healthy eligible rows are all processed across batches", async () => {
    const h = harness({ rows: makeRows(101) });
    const out = await runVoicemailSourceCleanup(h.deps);

    expect(out.rows_attempted).toBe(101);
    expect(out.reconciled).toBe(101);
    expect(out.batches).toBe(3); // 100 + 1 + empty
    expect(out.queue_empty).toBe(true);
    expect(out.status).toBe("completed");
    expect(h.rows.every((r) => r.cleanup_state === "deleted")).toBe(true);
  });

  it("stays within its capacity ceiling and reports partial rather than running forever", async () => {
    const h = harness({ rows: makeRows(LIMITS.CLEANUP_BATCH_SIZE * (LIMITS.CLEANUP_MAX_BATCHES + 2)) });
    const out = await runVoicemailSourceCleanup(h.deps);
    expect(out.batches).toBe(LIMITS.CLEANUP_MAX_BATCHES);
    expect(out.rows_attempted).toBe(LIMITS.CLEANUP_BATCH_SIZE * LIMITS.CLEANUP_MAX_BATCHES);
    expect(out.stopped_reason).toBe("max_batches");
    expect(out.status).toBe("partial");
  });

  it("a queue drained on a SHORT final batch at the ceiling is completed, not partial", async () => {
    const n = LIMITS.CLEANUP_BATCH_SIZE * (LIMITS.CLEANUP_MAX_BATCHES - 1) + 1; // last batch holds 1
    const h = harness({ rows: makeRows(n) });
    const out = await runVoicemailSourceCleanup(h.deps);
    expect(out.rows_attempted).toBe(n);
    expect(out.reconciled).toBe(n);
    expect(out.status).toBe("completed");
  });

  it("a FULL final batch at the ceiling stays partial — a full batch cannot prove the queue is empty", async () => {
    const h = harness({ rows: makeRows(LIMITS.CLEANUP_BATCH_SIZE * LIMITS.CLEANUP_MAX_BATCHES) });
    const out = await runVoicemailSourceCleanup(h.deps);
    expect(out.stopped_reason).toBe("max_batches");
    expect(out.status).toBe("partial");
  });

  it("a malformed batch row is one unresolved obligation, not a lost pass", async () => {
    const good = makeRows(2);
    const h = harness({
      rows: good,
      cleanupBatch: async (_l, n) =>
        n === 0
          ? { data: [null, ...good.map(({ id, recording_sid, provider_account_sid }) => ({ id, recording_sid, provider_account_sid }))], error: null }
          : { data: [], error: null },
    });
    const out = await runVoicemailSourceCleanup(h.deps);
    expect(out.reconciled).toBe(2); // the good rows still counted
    expect(out.unresolved + out.skipped_invalid_sid).toBeGreaterThanOrEqual(1);
    expect(out.status).not.toBe("completed");
  });

  it("the helper bounds the provider call itself, even if the dependency ignores its timeout", async () => {
    vi.useFakeTimers();
    const h = harness({
      rows: makeRows(1),
      provider: () => new Promise(() => {}), // never settles, never honours timeoutMs
    });
    const running = runVoicemailSourceCleanup(h.deps);
    await vi.advanceTimersByTimeAsync(LIMITS.PROVIDER_REQUEST_TIMEOUT_MS + PROVIDER_WAIT_GRACE_MS + 50);
    const out = await running;
    expect(out.provider_failures).toBe(1);
    expect(out.provider_failures_recorded).toBe(1);
  });

  it("both phases yield when the invocation budget is already spent by the recording pass", async () => {
    const h = harness({ rows: makeRows(5) });
    // the (unbounded, pre-existing) conversation-recording pass already consumed the whole invocation
    h.deps.invocationStartMs = h.clock.t - LIMITS.INVOCATION_BUDGET_MS - 1;
    const out = await runVoicemailSourceCleanup(h.deps);
    expect(out.budget_exhausted).toBe(true);
    expect(out.rows_attempted).toBe(0);
    expect(h.providerCalls).toHaveLength(0);
    expect(h.rows.every((r) => r.cleanup_state !== "deleted")).toBe(true); // all still recoverable
  });

  it("an unchanged batch terminates without repeating provider DELETEs", async () => {
    const h = harness({
      rows: makeRows(3),
      // every reconciliation fails, so the rows' durable state never changes and the batch repeats
      markSourceDeleted: async () => ({ data: null, error: { message: "read-only transaction" } }),
    });
    const out = await runVoicemailSourceCleanup(h.deps);

    expect(h.providerCalls).toHaveLength(3); // NOT 6 — each row attempted exactly once
    expect(out.rows_attempted).toBe(3);
    expect(out.unresolved).toBe(3);
    expect(out.stopped_reason).toBe("no_progress");
    expect(out.status).toBe("failed");
    expect(out.batches).toBe(2);
  });

  it("budget exhaustion stops starting work and leaves the remainder recoverable", async () => {
    const h = harness({ rows: makeRows(10) });
    // jump past the deadline once two rows have been started
    const original = h.deps.deleteProviderRecording;
    h.deps.deleteProviderRecording = async (args) => {
      if (h.providerCalls.length >= 2) h.clock.t += LIMITS.CLEANUP_PASS_BUDGET_MS + 1;
      return original(args);
    };
    const out = await runVoicemailSourceCleanup(h.deps);

    expect(out.budget_exhausted).toBe(true);
    expect(out.stopped_reason).toBe("budget");
    expect(out.status).toBe("partial");
    expect(out.rows_attempted).toBeLessThan(10);
    // the untouched rows are still eligible for a later invocation
    const stillDue = h.rows.filter((r) => r.cleanup_state !== "deleted");
    expect(stillDue.length).toBe(10 - out.reconciled);
    expect(h.logs.some((l) => /budget exhausted/.test(l.message))).toBe(true);
  });

  it("bounds database waits and treats a timeout as unknown, never as a rollback", async () => {
    vi.useFakeTimers();
    const slow = boundedDb<number>(() => new Promise(() => {}), LIMITS.DB_REQUEST_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(LIMITS.DB_REQUEST_TIMEOUT_MS + 10);
    const r = await slow;
    expect(r.timedOut).toBe(true);
    expect(r.error?.message).toMatch(/timed out/);
    expect(r.data).toBeNull();
  });

  it("a timed-out reconciliation is unresolved and says the transaction may still have committed", async () => {
    vi.useFakeTimers();
    const h = harness({
      rows: makeRows(1),
      markSourceDeleted: () => new Promise(() => {}), // never settles
      readCleanupState: async () => ({ data: { source_cleanup_state: "pending" }, error: null }),
    });
    const running = runVoicemailSourceCleanup(h.deps);
    await vi.advanceTimersByTimeAsync(LIMITS.DB_REQUEST_TIMEOUT_MS * 3);
    const out = await running;
    expect(out.unresolved).toBe(1);
    expect(out.reconciled).toBe(0);
    const log = h.logs.find((l) => l.detail?.timed_out === true);
    expect(String(log?.detail?.note)).toMatch(/does not prove the transaction rolled back/);
  });

  it("one row throwing unexpectedly is unresolved and does not discard the pass's counters", async () => {
    const rows = makeRows(3);
    const h = harness({
      rows,
      markSourceDeleted: async (s) => {
        if (s === rows[1].recording_sid) throw new Error("kaboom");
        rows.find((r) => r.recording_sid === s)!.cleanup_state = "deleted";
        return { data: { updated: true }, error: null };
      },
      readCleanupState: async (s) => {
        if (s === rows[1].recording_sid) throw new Error("kaboom too");
        const r = rows.find((x) => x.recording_sid === s);
        return { data: r ? { source_cleanup_state: r.cleanup_state } : null, error: null };
      },
    });
    const out = await runVoicemailSourceCleanup(h.deps);
    expect(out.reconciled).toBe(2); // the other two rows still counted
    expect(out.unresolved).toBe(1);
    expect(out.status).toBe("partial");
  });

  it("a logger that throws cannot change an outcome", async () => {
    const h = harness({ rows: makeRows(1), provider: async () => ({ kind: "status", status: 500 }) });
    h.deps.log = () => { throw new Error("logging is broken"); };
    const out = await runVoicemailSourceCleanup(h.deps);
    expect(out.provider_failures_recorded).toBe(1);
    expect(out.status).toBe("partial"); // unchanged by the broken logger
  });

  it("runBounded keeps at most `concurrency` in flight and reports what it never started", async () => {
    let inFlight = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    let stop = false;
    const p = runBounded(items, 3, () => stop, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((r) => releases.push(r));
      inFlight -= 1;
    });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(peak).toBe(3);
    stop = true;
    releases.forEach((r) => r());
    const { started, notStarted } = await p;
    expect(started).toBe(3);
    expect(notStarted).toHaveLength(5);
  });
});

// ── 4. Degraded outcomes are distinguishable ─────────────────────────────────────────────────────

describe("degraded outcomes are distinguishable from a healthy empty queue", () => {
  it("healthy empty queue", async () => {
    const h = harness({ rows: [] });
    const out = await runVoicemailSourceCleanup(h.deps);
    expect(out.status).toBe("completed");
    expect(out.reason).toBe("no_work");
    expect(out.queue_empty).toBe(true);
    expect(out.rows_attempted).toBe(0);
  });

  it("missing credentials is skipped, not a healthy zero", async () => {
    const h = harness({ rows: makeRows(3), credentials: () => null });
    const out = await runVoicemailSourceCleanup(h.deps);
    expect(out.status).toBe("skipped");
    expect(out.reason).toBe("missing_credentials");
    expect(out.queue_empty).toBe(false);
    expect(h.providerCalls).toHaveLength(0);
  });

  it("an absent v2 schema is skipped as schema_unavailable, and reports no batch it never used", async () => {
    const h = harness({
      cleanupBatch: async () => ({
        data: null,
        error: { message: 'relation "public.voicemails" does not exist' },
      }),
    });
    const out = await runVoicemailSourceCleanup(h.deps);
    expect(out.status).toBe("skipped");
    expect(out.reason).toBe("schema_unavailable");
    expect(out.batches).toBe(0);
  });

  it("a TRANSIENT database fault is db_unavailable, never the benign schema_unavailable", async () => {
    const h = harness({
      cleanupBatch: async () => ({ data: null, error: { message: "connection reset by peer" } }),
    });
    const out = await runVoicemailSourceCleanup(h.deps);
    expect(out.status).toBe("skipped");
    expect(out.reason).toBe("db_unavailable");
    expect(h.logs.some((l) => l.level === "error")).toBe(true);
  });

  it("a permission regression is db_unavailable, not mistaken for an absent schema", async () => {
    const h = harness({
      cleanupBatch: async () => ({
        data: null,
        error: { message: "permission denied for function voicemails_cleanup_batch" },
      }),
    });
    const out = await runVoicemailSourceCleanup(h.deps);
    expect(out.reason).toBe("db_unavailable");
  });

  it("voicemail_phases_ok is the scan-level signal the unchanged top-level ok cannot give", async () => {
    const healthy = await runVoicemailPhases(harness({ rows: [] }).deps);
    expect(healthy.voicemail_phases_ok).toBe(true);
    const broken = await runVoicemailPhases(harness({ rows: makeRows(1), provider: async () => ({ kind: "status", status: 500 }) }).deps);
    expect(broken.voicemail_phases_ok).toBe(false);
    expect(broken.voicemail_source_cleanup.status).toBe("partial");
  });

  it("partial: some work reconciled, some unresolved", async () => {
    const rows = makeRows(2);
    let n = 0;
    const h = harness({
      rows,
      markSourceDeleted: async (s) => {
        if (n++ === 0) {
          rows.find((r) => r.recording_sid === s)!.cleanup_state = "deleted";
          return { data: { updated: true }, error: null };
        }
        return { data: null, error: { message: "boom" } };
      },
    });
    const out = await runVoicemailSourceCleanup(h.deps);
    expect(out.status).toBe("partial");
    expect(out.reconciled).toBe(1);
    expect(out.unresolved).toBe(1);
  });

  it("the four outcomes are mutually distinguishable in the serialized response", async () => {
    const healthy = await runVoicemailSourceCleanup(harness({ rows: [] }).deps);
    const missing = await runVoicemailSourceCleanup(harness({ credentials: () => null }).deps);
    const failed = await runVoicemailSourceCleanup(
      harness({
        rows: makeRows(1),
        markSourceDeleted: async () => ({ data: null, error: { message: "x" } }),
      }).deps,
    );
    const partialH = harness({ rows: makeRows(2) });
    let k = 0;
    partialH.deps.markSourceDeleted = async (s) => {
      if (k++ === 0) {
        partialH.rows.find((r) => r.recording_sid === s)!.cleanup_state = "deleted";
        return { data: { updated: true }, error: null };
      }
      return { data: null, error: { message: "y" } };
    };
    const partial = await runVoicemailSourceCleanup(partialH.deps);

    const shapes = [healthy, missing, failed, partial].map((o) => `${o.status}:${o.reason ?? ""}`);
    expect(new Set(shapes).size).toBe(4);
    expect(shapes).toEqual([
      "completed:no_work",
      "skipped:missing_credentials",
      "failed:unresolved",
      "partial:unresolved",
    ]);
  });
});

// ── 5. Retention phase: preserved checks, new reporting ──────────────────────────────────────────

describe("voicemail retention", () => {
  const anchor = Date.UTC(2026, 8, 16, 8, 15, 0);
  let round2 = 0;
  beforeEach(() => { round2 = 0; });

  function retentionHarness(over: Partial<VoicemailDeps> = {}) {
    const h = harness();
    const logs = h.logs;
    const deps: VoicemailDeps = {
      ...h.deps,
      retentionAnchorMs: anchor,
      invocationStartMs: h.clock.t,
      nowMs: () => h.clock.t,
      listRoutingSettings: async () => ({
        data: [{ organization_id: ORG, voicemail_retention_days: 30 }],
        error: null,
      }),
      ...over,
    };
    return { deps, logs, clock: h.clock };
  }

  it("passes the unchanged cutoffs: listened at the org's retention, unheard at the 90-day cap", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const { deps } = retentionHarness({
      expiredBatch: async (args) => {
        seen.push(args as unknown as Record<string, unknown>);
        return { data: [], error: null };
      },
    });
    await runVoicemailRetention(deps);
    expect(seen[0].listenedCutoff).toBe(new Date(anchor - 30 * 86_400_000).toISOString());
    expect(seen[0].unheardCutoff).toBe(new Date(anchor - VOICEMAIL_UNHEARD_MAX_DAYS * 86_400_000).toISOString());
    expect(seen[0].limit).toBe(LIMITS.RETENTION_BATCH_SIZE);
    expect(VOICEMAIL_UNHEARD_MAX_DAYS).toBe(90);
  });

  it("PRESERVED: a failed storage removal marks nothing purged and leaves the work for the next run", async () => {
    let markPurgedCalls = 0;
    const { deps, logs } = retentionHarness({
      expiredBatch: async () => ({ data: [{ id: "v1", storage_path: "o/a.mp3" }], error: null }),
      removeObjects: async () => ({ data: null, error: { message: "storage unavailable" } }),
      markPurged: async () => {
        markPurgedCalls += 1;
        return { data: 1, error: null };
      },
    });
    const out = await runVoicemailRetention(deps);
    expect(markPurgedCalls).toBe(0);
    expect(out.rows_purged).toBe(0);
    expect(out.objects_removed).toBe(0);
    expect(out.orgs_incomplete).toBe(1);
    expect(out.status).toBe("failed");
    expect(logs.some((l) => /storage removal failed/.test(l.message))).toBe(true);
  });

  it("counts objects the storage layer actually removed and surfaces a shortfall", async () => {
    const { deps, logs } = retentionHarness({
      expiredBatch: async () =>
        round2++ === 0
          ? { data: [{ id: "v1", storage_path: "o/a.mp3" }, { id: "v2", storage_path: "o/b.mp3" }], error: null }
          : { data: [], error: null },
      removeObjects: async () => ({ data: [{ name: "o/a.mp3" }], error: null }), // only one of two
      markPurged: async () => ({ data: 2, error: null }),
    });
    const out = await runVoicemailRetention(deps);
    expect(out.objects_removed).toBe(1);
    expect(out.objects_missing).toBe(1);
    expect(out.status).toBe("partial");
    expect(logs.some((l) => /fewer objects than requested/.test(l.message))).toBe(true);
  });

  it("an absent v2 schema skips the phase with a reason", async () => {
    const { deps } = retentionHarness({
      listRoutingSettings: async () => ({ data: null, error: { message: "does not exist" } }),
    });
    const out = await runVoicemailRetention(deps);
    expect(out.status).toBe("skipped");
    expect(out.reason).toBe("schema_unavailable");
  });

  it("a healthy empty run is completed and distinguishable from a skip", async () => {
    const { deps } = retentionHarness();
    const out = await runVoicemailRetention(deps);
    expect(out.status).toBe("completed");
    expect(out.queue_empty).toBe(true);
    expect(out.orgs_processed).toBe(1);
  });

  it("counts purged rows from the RPC's own result and reports partial when an org breaks", async () => {
    let round = 0;
    const { deps } = retentionHarness({
      expiredBatch: async () =>
        round++ === 0
          ? { data: [{ id: "v1", storage_path: "o/a.mp3" }], error: null }
          : { data: null, error: { message: "timeout" } },
      markPurged: async () => ({ data: 1, error: null }),
    });
    const out = await runVoicemailRetention(deps);
    expect(out.rows_purged).toBe(1);
    expect(out.objects_removed).toBe(1);
    expect(out.orgs_incomplete).toBe(1);
    expect(out.status).toBe("partial");
  });

  it("budget exhaustion is partial, not failed — nothing went wrong, there was just more to do", async () => {
    const h = harness();
    const deps: VoicemailDeps = {
      ...h.deps,
      retentionAnchorMs: anchor,
      invocationStartMs: h.clock.t,
      listRoutingSettings: async () => ({
        data: [
          { organization_id: ORG, voicemail_retention_days: 30 },
          { organization_id: "bbbbbbbb-0000-0000-0000-00000000000b", voicemail_retention_days: 30 },
        ],
        error: null,
      }),
      expiredBatch: async () => {
        h.clock.t += LIMITS.RETENTION_PASS_BUDGET_MS + 1;
        return { data: [], error: null };
      },
    };
    const out = await runVoicemailRetention(deps);
    expect(out.budget_exhausted).toBe(true);
    expect(out.rows_purged).toBe(0);
    expect(out.status).toBe("partial"); // NOT "failed"
    expect(out.reason).toBe("budget_exhausted");
  });

  it("names WHICH fault left an organization incomplete", async () => {
    const { deps } = retentionHarness({
      expiredBatch: async () => ({ data: [{ id: "v1", storage_path: "o/a.mp3" }], error: null }),
      removeObjects: async () => ({ data: null, error: { message: "storage unavailable" } }),
    });
    const out = await runVoicemailRetention(deps);
    expect(out.incomplete_reason).toBe("storage_error");
    expect(out.reason).toBe("storage_error");
  });

  it("a transient settings fault is db_unavailable, an absent schema is schema_unavailable", async () => {
    const transient = await runVoicemailRetention(
      retentionHarness({ listRoutingSettings: async () => ({ data: null, error: { message: "connection reset by peer" } }) }).deps,
    );
    expect(transient.reason).toBe("db_unavailable");
    const absent = await runVoicemailRetention(
      retentionHarness({ listRoutingSettings: async () => ({ data: null, error: { message: 'relation "public.inbound_routing_settings" does not exist' } }) }).deps,
    );
    expect(absent.reason).toBe("schema_unavailable");
  });

  it("stops starting organizations once its budget is gone", async () => {
    const h = harness();
    const deps: VoicemailDeps = {
      ...h.deps,
      retentionAnchorMs: anchor,
      invocationStartMs: h.clock.t,
      listRoutingSettings: async () => ({
        data: [
          { organization_id: ORG, voicemail_retention_days: 30 },
          { organization_id: "bbbbbbbb-0000-0000-0000-00000000000b", voicemail_retention_days: 30 },
        ],
        error: null,
      }),
      expiredBatch: async () => {
        h.clock.t += LIMITS.RETENTION_PASS_BUDGET_MS + 1;
        return { data: [], error: null };
      },
    };
    const out = await runVoicemailRetention(deps);
    expect(out.budget_exhausted).toBe(true);
    expect(out.orgs_processed).toBe(1);
  });
});

// ── 6. Real wiring: nothing can silently discard the corrected result ────────────────────────────

describe("handler wiring", () => {
  const indexPath = path.join(REPO, "supabase/functions/recording-retention-purge/index.ts");
  const source = () => readFileSync(indexPath, "utf8");

  it("index.ts awaits the helper and spreads its result straight into the JSON response", () => {
    const s = source();
    expect(s).toMatch(/import \{ runVoicemailPhases, type VoicemailDeps \} from "\.\/voicemail\.ts";/);
    expect(s).toMatch(/const voicemail = await runVoicemailPhases\(buildVoicemailDeps\(supabase, now, now\)\);/);
    expect(s).toMatch(/\.\.\.voicemail,/);
    // no try/catch may sit between the helper call and the response
    const call = s.indexOf("const voicemail = await runVoicemailPhases");
    const resp = s.indexOf("...voicemail,");
    expect(call).toBeGreaterThan(-1);
    expect(resp).toBeGreaterThan(call);
    expect(s.slice(call, resp)).not.toMatch(/\btry\b|\bcatch\b/);
  });

  it("the provider request is genuinely cancellable in the real wiring", () => {
    const s = source();
    expect(s).toMatch(/new AbortController\(\)/);
    expect(s).toMatch(/setTimeout\(\(\) => controller\.abort\(\), timeoutMs\)/);
    expect(s).toMatch(/signal: controller\.signal/);
    expect(s).toMatch(/clearTimeout\(timer\)/);
  });

  it("the authentication and conversation-recording purge are byte-identical to deployed v29", () => {
    const s = source();
    const v29 = execFileSync(
      "git",
      ["show", "origin/main:supabase/functions/recording-retention-purge/index.ts"],
      { cwd: REPO, encoding: "utf8" },
    );
    const START = 'import { createClient } from "https://esm.sh/@supabase/supabase-js@2";';
    const END = "      rowsCleared += ids.length;\n    }\n  }\n";
    const region = (t: string) => t.slice(t.indexOf(START), t.indexOf(END) + END.length);
    const HELPER_IMPORT = 'import { runVoicemailPhases, type VoicemailDeps } from "./voicemail.ts";\n';
    expect(region(s).replace(HELPER_IMPORT, "")).toBe(region(v29));
  });

  it("runVoicemailPhases never rejects, even when every dependency throws", async () => {
    const throwing = new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === "nowMs") return () => 0;
          if (prop === "retentionAnchorMs") return 0;
          if (prop === "invocationStartMs") return 0;
          if (prop === "log") return () => { throw new Error("even logging is broken"); };
          return () => { throw new Error(`dependency ${String(prop)} exploded`); };
        },
      },
    ) as VoicemailDeps;

    const out = await runVoicemailPhases(throwing);

    // It resolves rather than rejecting — that is the property that matters.
    // The two phases degrade differently, and both are honest:
    //   retention  -> its first dependency is called through boundedDb, which normalises the throw
    //                 into `{error}`, so the phase reports a SKIP with a reason;
    //   cleanup    -> `credentials()` is called directly, so the throw reaches the phase guard.
    // A logger that also throws changes neither: logging can never influence an outcome.
    expect(out.voicemail_retention.status).toBe("skipped");
    // "dependency exploded" is not a missing-object message, so it is correctly the NON-benign skip
    expect(out.voicemail_retention.reason).toBe("db_unavailable");
    expect(out.voicemail_source_cleanup.status).toBe("failed");
    expect(out.voicemail_source_cleanup.reason).toMatch(/unexpected_error/);
    // neither phase is mistakable for a healthy run
    expect(out.voicemail_retention.status).not.toBe("completed");
    expect(out.voicemail_source_cleanup.status).not.toBe("completed");
  });

  it("returns both phases under the exact response keys the handler spreads", async () => {
    const h = harness({ rows: [] });
    const out = await runVoicemailPhases(h.deps);
    expect(Object.keys(out).sort()).toEqual([
      "voicemail_phases_ok",
      "voicemail_retention",
      "voicemail_source_cleanup",
    ]);
    expect(JSON.parse(JSON.stringify(out)).voicemail_source_cleanup.status).toBe("completed");
  });
});

// ── 7. The documented limits are what the code actually uses ─────────────────────────────────────

describe("documented execution limits", () => {
  it("stay inside the SQL's own clamp and under the invocation cap", () => {
    // the SQL clamps p_limit to 1..500 — the batch size must stay inside it
    expect(LIMITS.CLEANUP_BATCH_SIZE).toBeGreaterThanOrEqual(1);
    expect(LIMITS.CLEANUP_BATCH_SIZE).toBeLessThanOrEqual(500);
    // neither phase budget may exceed the whole-invocation cap, or the cap would be unreachable
    expect(LIMITS.RETENTION_PASS_BUDGET_MS).toBeLessThan(LIMITS.INVOCATION_BUDGET_MS);
    expect(LIMITS.CLEANUP_PASS_BUDGET_MS).toBeLessThan(LIMITS.INVOCATION_BUDGET_MS);
  });

  it("phaseDeadline actually applies the invocation cap, not just the phase budget", () => {
    const h = harness();
    // plenty of invocation budget left -> the phase budget binds
    h.deps.invocationStartMs = h.clock.t;
    expect(phaseDeadline(h.deps, LIMITS.CLEANUP_PASS_BUDGET_MS)).toBe(h.clock.t + LIMITS.CLEANUP_PASS_BUDGET_MS);
    // the recording pass already ate most of the invocation -> the cap binds instead
    h.deps.invocationStartMs = h.clock.t - (LIMITS.INVOCATION_BUDGET_MS - 1_000);
    expect(phaseDeadline(h.deps, LIMITS.CLEANUP_PASS_BUDGET_MS)).toBe(h.clock.t + 1_000);
  });

  it("the provider timeout constant is the one actually handed to the provider call", async () => {
    const h = harness({ rows: makeRows(1) });
    await runVoicemailSourceCleanup(h.deps);
    expect(h.providerCalls[0].timeoutMs).toBe(LIMITS.PROVIDER_REQUEST_TIMEOUT_MS);
  });

  it("the database timeout constant is the one boundedDb actually enforces", async () => {
    vi.useFakeTimers();
    const p = boundedDb<number>(() => new Promise(() => {}), LIMITS.DB_REQUEST_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(LIMITS.DB_REQUEST_TIMEOUT_MS - 10);
    let settled = false;
    void p.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false); // not yet
    await vi.advanceTimersByTimeAsync(20);
    expect((await p).timedOut).toBe(true);
  });

  it("passes the configured batch size to the SQL function", async () => {
    const sizes: number[] = [];
    const h = harness({
      cleanupBatch: async (limit) => {
        sizes.push(limit);
        return { data: [], error: null };
      },
    });
    await runVoicemailSourceCleanup(h.deps);
    expect(sizes).toEqual([LIMITS.CLEANUP_BATCH_SIZE]);
  });
});

// keep the row helper referenced for type-checking of the deps surface
export type { CleanupRow };
