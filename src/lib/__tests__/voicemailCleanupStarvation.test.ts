// Corrective pass 13 — the voicemail source-cleanup queue must not be starved by rows whose owning
// provider account cannot be established.
//
// THE DEFECT (reproduced against the deployed v30 worker by an independent review): such a row is
// deliberately left completely untouched — no provider request, no failure record, no attempt
// increment, no backoff — because guessing an owner would delete another account's media and advancing
// the counter would silently retire the obligation at M7's 50-attempt ceiling. Correct in isolation, but
// M7's `voicemails_cleanup_batch` selects `ORDER BY created_at ASC LIMIT 100` with no owner filter, so
// those rows are immortal at the head of the queue: every batch returns the same prefix, the in-pass
// no-progress guard stops the invocation, and actionable rows behind them are never reached again.
//
// Every test below runs the REAL `runVoicemailSourceCleanup` over a model faithful to the live SQL.
// `selection: "pre-m8"` reproduces the defect; the default models M8's actionable selection.
import { describe, expect, it } from "vitest";
import {
  LIMITS,
  runVoicemailSourceCleanup,
  parseBlockedSummary,
  type ProviderResult,
  type VoicemailDeps,
} from "../../../supabase/functions/recording-retention-purge/voicemail";

const ORG_A = "aaaaaaaa-0000-0000-0000-00000000000a";
const ORG_B = "bbbbbbbb-0000-0000-0000-00000000000b";
const OWNER = "AC" + "d".repeat(32);
const ESTABLISHED = /^AC[0-9a-fA-F]{32}$/;

interface Row {
  id: string;
  recording_sid: string;
  organization_id: string;
  provider_account_sid: string | null;
  cleanup_state: "pending" | "failed" | "deleted";
  attempts: number;
  next_at: number | null;
  created_at: number;
}

let seq = 0;
function row(over: Partial<Row> = {}): Row {
  const n = ++seq;
  return {
    id: `vm-${n}`,
    recording_sid: "RE" + n.toString(16).padStart(32, "0"),
    organization_id: ORG_A,
    provider_account_sid: OWNER,
    cleanup_state: "pending",
    attempts: 0,
    next_at: null,
    created_at: n, // insertion order == created_at order, which is what the SQL orders by
    ...over,
  };
}
/** A row whose owner was never established — the kind that used to block the whole queue. */
const blockedRow = (over: Partial<Row> = {}) => row({ provider_account_sid: null, ...over });

interface Harness {
  deps: VoicemailDeps;
  rows: Row[];
  providerCalls: string[];
  batchCalls: number;
  logs: Array<{ level: string; message: string; detail?: Record<string, unknown> }>;
}

function harness(opts: {
  rows: Row[];
  selection?: "m8" | "pre-m8";
  provider?: (sid: string, n: number) => Promise<ProviderResult>;
  blockedSummaryFails?: boolean;
  /** Return this EXACT payload from the summary RPC — used to drive malformed-contract regressions. */
  blockedSummaryRaw?: unknown;
  scanLimit?: number;
} = { rows: [] }): Harness {
  const rows = opts.rows;
  const clock = { t: 1_000_000 };
  const h: Harness = { rows, providerCalls: [], batchCalls: 0, logs: [] } as unknown as Harness;
  const find = (sid: string) => rows.find((r) => r.recording_sid === sid);
  const due = (r: Row) =>
    r.cleanup_state !== "deleted" && r.attempts < 50 && (r.next_at === null || r.next_at <= clock.t);

  h.deps = {
    nowMs: () => clock.t,
    invocationStartMs: clock.t,
    retentionAnchorMs: clock.t,
    listRoutingSettings: async () => ({ data: [], error: null }),
    expiredBatch: async () => ({ data: [], error: null }),
    removeObjects: async () => ({ data: null, error: null }),
    markPurged: async () => ({ data: 0, error: null }),
    credentials: () => ({ accountSid: "ACplatform", authToken: "tok" }),

    // M8's `voicemails_cleanup_actionable_batch`, or M7's unfiltered one when reproducing the defect.
    cleanupActionableBatch: async (limit) => {
      h.batchCalls++;
      const eligible = rows
        .filter(due)
        .filter((r) => opts.selection === "pre-m8" || ESTABLISHED.test((r.provider_account_sid ?? "").trim()))
        .sort((a, b) => a.created_at - b.created_at)
        .slice(0, limit);
      return {
        data: eligible.map((r) => ({
          id: r.id, recording_sid: r.recording_sid,
          provider_account_sid: r.provider_account_sid, source_cleanup_attempts: r.attempts,
        })),
        error: null,
      };
    },
    cleanupBlockedSummary: async (scanLimit) => {
      if (opts.blockedSummaryFails) return { data: null, error: { message: "statement timeout" } };
      if ("blockedSummaryRaw" in opts) return { data: opts.blockedSummaryRaw as never, error: null };
      const cap = opts.scanLimit ?? scanLimit;
      const blocked = rows
        .filter((r) => r.cleanup_state !== "deleted" && r.attempts < 50)
        .filter((r) => !ESTABLISHED.test((r.provider_account_sid ?? "").trim()))
        .sort((a, b) => a.created_at - b.created_at);
      const capped = blocked.length > cap;
      const kept = blocked.slice(0, cap);
      return {
        data: [{
          blocked_due: kept.filter(due).length,
          blocked_total: kept.length,
          blocked_orgs: new Set(kept.map((r) => r.organization_id)).size,
          oldest_blocked_at: kept.length ? new Date(clock.t).toISOString() : null,
          scan_capped: capped,
        }],
        error: null,
      };
    },

    deleteProviderRecording: async ({ recordingSid }) => {
      const n = h.providerCalls.length;
      h.providerCalls.push(recordingSid);
      if (opts.provider) return opts.provider(recordingSid, n);
      return { kind: "status", status: 204 };
    },
    markSourceDeleted: async (sid) => {
      const r = find(sid);
      if (r && r.cleanup_state !== "deleted") { r.cleanup_state = "deleted"; return { data: { updated: true }, error: null }; }
      return { data: { updated: false }, error: null };
    },
    recordCleanupFailure: async (sid) => {
      const r = find(sid);
      if (r && r.cleanup_state !== "deleted") {
        r.cleanup_state = "failed"; r.attempts += 1; r.next_at = clock.t + 60_000;
        return { data: { updated: true }, error: null };
      }
      return { data: { updated: false }, error: null };
    },
    readCleanupState: async (sid) => {
      const r = find(sid);
      return { data: r ? { source_cleanup_state: r.cleanup_state } : null, error: null };
    },
    log: (level, message, detail) => { h.logs.push({ level, message, detail }); },
  };
  return h;
}

/** A fresh invocation over the SAME table, the way the nightly cron re-enters it. */
const runAgain = (h: Harness) => {
  h.batchCalls = 0;
  return runVoicemailSourceCleanup(h.deps);
};

describe("FAIL-FIRST: the pre-M8 selection starves actionable work", () => {
  it("100 blocked rows ahead of one actionable row: the actionable row is NEVER reached", async () => {
    const blocked = Array.from({ length: 100 }, () => blockedRow());
    const target = row();
    const h = harness({ rows: [...blocked, target], selection: "pre-m8" });

    const out = await runVoicemailSourceCleanup(h.deps);

    expect(h.providerCalls).toHaveLength(0);
    expect(out.rows_attempted).toBe(0);
    expect(out.reconciled).toBe(0);
    expect(out.unresolved_ownership).toBe(100);
    expect(out.stopped_reason).toBe("no_progress");
    expect(target.cleanup_state).toBe("pending");   // the healthy row is untouched, run after run
  });

  it("99 blocked rows: the boundary positive control — one actionable row trickles through per pass", async () => {
    const blocked = Array.from({ length: 99 }, () => blockedRow());
    const target = row();
    const h = harness({ rows: [...blocked, target], selection: "pre-m8" });

    const out = await runVoicemailSourceCleanup(h.deps);

    // It IS processed, but it consumed a whole batch of 100 slots to get one row of work done: the
    // proportional form of the same starvation.
    expect(out.reconciled).toBe(1);
    expect(out.unresolved_ownership).toBe(99);
    expect(target.cleanup_state).toBe("deleted");
  });

  it("three successive daily invocations make ZERO progress and issue ZERO provider requests", async () => {
    const blocked = Array.from({ length: 100 }, () => blockedRow());
    const target = row();
    const h = harness({ rows: [...blocked, target], selection: "pre-m8" });

    for (let day = 0; day < 3; day++) {
      const out = await runAgain(h);
      expect(out.reconciled).toBe(0);
      expect(out.rows_attempted).toBe(0);
    }
    expect(h.providerCalls).toHaveLength(0);
    expect(target.cleanup_state).toBe("pending");
  });
});

describe("CORRECTED: the actionable selection reaches work behind any blocked prefix", () => {
  it("100 blocked rows ahead of one actionable row: the actionable row is cleaned on the first pass", async () => {
    const blocked = Array.from({ length: 100 }, () => blockedRow());
    const target = row();
    const h = harness({ rows: [...blocked, target] });

    const out = await runVoicemailSourceCleanup(h.deps);

    expect(h.providerCalls).toEqual([target.recording_sid]);
    expect(out.rows_attempted).toBe(1);
    expect(out.reconciled).toBe(1);
    expect(target.cleanup_state).toBe("deleted");
  });

  it("MORE THAN 1,000 blocked rows still cannot hide actionable work", async () => {
    const blocked = Array.from({ length: 1_200 }, () => blockedRow());
    const targets = Array.from({ length: 3 }, () => row());
    const h = harness({ rows: [...blocked, ...targets] });

    const out = await runVoicemailSourceCleanup(h.deps);

    expect(out.reconciled).toBe(3);
    expect(h.providerCalls).toHaveLength(3);
    expect(out.blocked_ownership_total).toBe(1_200);
    expect(targets.every((t) => t.cleanup_state === "deleted")).toBe(true);
  });

  it("the blocked backlog is REPORTED, never presented as an empty queue", async () => {
    const h = harness({ rows: [...Array.from({ length: 7 }, () => blockedRow())] });

    const out = await runVoicemailSourceCleanup(h.deps);

    expect(out.actionable_queue_empty).toBe(true);   // nothing actionable was found …
    expect(out.queue_empty).toBe(false);             // … but the queue is NOT empty
    expect(out.blocked_ownership_total).toBe(7);
    expect(out.blocked_ownership_due).toBe(7);
    expect(out.status).toBe("partial");
    expect(out.reason).toBe("blocked_unresolved_ownership");
    expect(h.logs.some((l) => l.level === "error" && /BLOCKED on rows whose owning provider account/.test(l.message))).toBe(true);
  });

  it("a genuinely empty queue still reports completed / no_work", async () => {
    const h = harness({ rows: [] });
    const out = await runVoicemailSourceCleanup(h.deps);
    expect(out.queue_empty).toBe(true);
    expect(out.actionable_queue_empty).toBe(true);
    expect(out.blocked_ownership_total).toBe(0);
    expect(out.status).toBe("completed");
    expect(out.reason).toBe("no_work");
  });

  it("blocked rows stay owed and NO attempt is fabricated for them, across repeated invocations", async () => {
    const blocked = Array.from({ length: 100 }, () => blockedRow());
    const target = row();
    const h = harness({ rows: [...blocked, target] });

    for (let day = 0; day < 3; day++) await runAgain(h);

    for (const b of blocked) {
      expect(b.cleanup_state).toBe("pending");   // preserved, not retired
      expect(b.attempts).toBe(0);                // the 50-attempt ceiling is never credited
      expect(b.next_at).toBeNull();              // no backoff was invented either
    }
    expect(h.providerCalls).toEqual([target.recording_sid]);  // exactly one request, on the first pass
  });

  it("the second and third passes do not re-issue a DELETE for work already reconciled", async () => {
    const h = harness({ rows: [...Array.from({ length: 5 }, () => blockedRow()), row(), row()] });

    const first = await runVoicemailSourceCleanup(h.deps);
    expect(first.reconciled).toBe(2);
    const afterFirst = h.providerCalls.length;

    const second = await runAgain(h);
    expect(second.reconciled).toBe(0);
    expect(second.actionable_queue_empty).toBe(true);
    expect(second.queue_empty).toBe(false);          // 5 blocked rows are still owed
    expect(h.providerCalls).toHaveLength(afterFirst);
  });
});

describe("cross-organization: one organization's bad data cannot starve another's work", () => {
  it("org A is entirely blocked; org B's actionable row is still cleaned, and the report attributes both", async () => {
    const blockedA = Array.from({ length: 150 }, () => blockedRow({ organization_id: ORG_A }));
    const blockedB = blockedRow({ organization_id: ORG_B });
    const targetB = row({ organization_id: ORG_B });
    const h = harness({ rows: [...blockedA, blockedB, targetB] });

    const out = await runVoicemailSourceCleanup(h.deps);

    expect(targetB.cleanup_state).toBe("deleted");
    expect(out.reconciled).toBe(1);
    expect(out.blocked_ownership_total).toBe(151);
    expect(out.blocked_ownership_orgs).toBe(2);
    expect(blockedA.every((r) => r.attempts === 0)).toBe(true);
  });
});

describe("owner recovery makes a blocked row actionable again, with no other intervention", () => {
  it("a blocked row is skipped, then cleaned on the next pass once a callback persists its owner", async () => {
    const blocked = blockedRow();
    const h = harness({ rows: [blocked] });

    const first = await runVoicemailSourceCleanup(h.deps);
    expect(first.blocked_ownership_total).toBe(1);
    expect(first.rows_attempted).toBe(0);
    expect(h.providerCalls).toHaveLength(0);

    // exactly what twilio-recording-status v36's durable ownership recovery writes
    blocked.provider_account_sid = OWNER;

    const second = await runAgain(h);
    expect(second.blocked_ownership_total).toBe(0);
    expect(second.rows_attempted).toBe(1);
    expect(second.reconciled).toBe(1);
    // The row was cleaned, the next batch came back empty, and nothing is blocked any more — so this is
    // the one case where the queue genuinely IS empty and may say so.
    expect(second.actionable_queue_empty).toBe(true);
    expect(second.queue_empty).toBe(true);
    expect(second.status).toBe("completed");
    expect(blocked.cleanup_state).toBe("deleted");
  });

  it("a MALFORMED owner is blocked exactly like an absent one, and recovers the same way", async () => {
    const bad = row({ provider_account_sid: "../../Accounts/ACevil" });
    const h = harness({ rows: [bad] });

    expect((await runVoicemailSourceCleanup(h.deps)).blocked_ownership_total).toBe(1);
    expect(h.providerCalls).toHaveLength(0);

    bad.provider_account_sid = OWNER;
    expect((await runAgain(h)).reconciled).toBe(1);
  });
});

describe("everything the correction had to preserve", () => {
  it("the per-request provider timeout is still applied to every call", async () => {
    const h = harness({ rows: [...Array.from({ length: 3 }, () => blockedRow()), row()] });
    let seenTimeout = -1;
    const inner = h.deps.deleteProviderRecording;
    h.deps.deleteProviderRecording = async (args) => { seenTimeout = args.timeoutMs; return inner(args); };
    await runVoicemailSourceCleanup(h.deps);
    expect(seenTimeout).toBe(LIMITS.PROVIDER_REQUEST_TIMEOUT_MS);
  });

  it("bounded concurrency still caps in-flight provider requests", async () => {
    let inFlight = 0;
    let peak = 0;
    const h = harness({
      rows: [...Array.from({ length: 20 }, () => blockedRow()), ...Array.from({ length: 30 }, () => row())],
      provider: async () => {
        inFlight += 1; peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight -= 1;
        return { kind: "status", status: 204 };
      },
    });
    await runVoicemailSourceCleanup(h.deps);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(LIMITS.CLEANUP_CONCURRENCY);
  });

  it("the capacity ceiling still stops the pass, and blocked rows do not consume it", async () => {
    // more actionable rows than one invocation may process, plus a blocked prefix
    const rows = [
      ...Array.from({ length: 50 }, () => blockedRow()),
      ...Array.from({ length: LIMITS.CLEANUP_BATCH_SIZE * LIMITS.CLEANUP_MAX_BATCHES + 10 }, () => row()),
    ];
    const h = harness({ rows });
    const out = await runVoicemailSourceCleanup(h.deps);
    expect(h.batchCalls).toBe(LIMITS.CLEANUP_MAX_BATCHES);
    expect(out.stopped_reason).toBe("max_batches");
    expect(out.reconciled).toBe(LIMITS.CLEANUP_BATCH_SIZE * LIMITS.CLEANUP_MAX_BATCHES);
    expect(out.status).toBe("partial");
  });

  it("reconciliation truth is unchanged: a provider failure is recorded and counted honestly", async () => {
    const target = row();
    const h = harness({
      rows: [blockedRow(), target],
      provider: async () => ({ kind: "status", status: 503 }),
    });
    const out = await runVoicemailSourceCleanup(h.deps);
    expect(out.rows_attempted).toBe(1);
    expect(out.provider_deletions).toBe(0);
    expect(out.provider_failures).toBe(1);
    expect(out.provider_failures_recorded).toBe(1);
    expect(out.reconciled).toBe(0);
    expect(target.cleanup_state).toBe("failed");
    expect(target.attempts).toBe(1);          // the ATTEMPTED row advances …
    expect(h.rows[0].attempts).toBe(0);       // … and the blocked one still does not
  });

  it("a row one attempt from the ceiling is still surfaced", async () => {
    const nearly = row({ attempts: 49 });
    const h = harness({ rows: [blockedRow(), nearly] });
    const out = await runVoicemailSourceCleanup(h.deps);
    expect(out.near_attempt_ceiling).toBe(1);
  });
});

describe("the blocked summary is observability, never a gate on the work", () => {
  it("when the summary cannot be read, actionable work STILL runs and the backlog is reported UNKNOWN", async () => {
    const target = row();
    const h = harness({ rows: [blockedRow(), target], blockedSummaryFails: true });

    const out = await runVoicemailSourceCleanup(h.deps);

    expect(out.reconciled).toBe(1);                       // the work happened anyway
    expect(target.cleanup_state).toBe("deleted");
    expect(out.blocked_summary_unavailable).toBe(true);
    expect(out.blocked_ownership_total).toBe(0);          // not a claim of zero …
    expect(out.queue_empty).toBe(false);                  // … and it never reads as an empty queue
    expect(out.status).toBe("partial");
    expect(h.logs.some((l) => l.level === "error" && /blocked-work summary unavailable/.test(l.message))).toBe(true);
  });

  // THE REVIEWER'S FOUR CASES, through the REAL worker. Each previously produced
  // `completed / no_work / queue_empty: true / blocked_summary_unavailable: false`.
  const MALFORMED: Array<[string, unknown]> = [
    ["an empty object", {}],
    ["missing blocked_total despite 100 due rows", [{ blocked_due: 100, blocked_orgs: 1, oldest_blocked_at: "2026-09-17T00:00:00Z", scan_capped: false }]],
    ["a non-numeric count", [{ blocked_due: "x", blocked_total: "y", blocked_orgs: 1, oldest_blocked_at: null, scan_capped: false }]],
    ["a negative count", [{ blocked_due: 0, blocked_total: -5, blocked_orgs: 0, oldest_blocked_at: null, scan_capped: false }]],
    ["100 due rows with a total of zero", [{ blocked_due: 100, blocked_total: 0, blocked_orgs: 0, oldest_blocked_at: null, scan_capped: false }]],
    ["a non-boolean cap flag", [{ blocked_due: 1, blocked_total: 1, blocked_orgs: 1, oldest_blocked_at: "2026-09-17T00:00:00Z", scan_capped: "yes" }]],
    ["two summary rows", [{ blocked_due: 0, blocked_total: 0, blocked_orgs: 0, oldest_blocked_at: null, scan_capped: false },
                          { blocked_due: 0, blocked_total: 0, blocked_orgs: 0, oldest_blocked_at: null, scan_capped: false }]],
    // CORRECTIVE PASS 13c — a capped scan reporting nothing retained, in both accepted transport shapes.
    ["a capped scan with a zero total (bare object)", { blocked_due: 0, blocked_total: 0, blocked_orgs: 0, oldest_blocked_at: null, scan_capped: true }],
    ["a capped scan with a zero total (singleton array)", [{ blocked_due: 0, blocked_total: 0, blocked_orgs: 0, oldest_blocked_at: null, scan_capped: true }]],
  ];

  it.each(MALFORMED)("REGRESSION with NO actionable rows: %s is UNKNOWN, not a clean no_work", async (_label, raw) => {
    const h = harness({ rows: [], blockedSummaryRaw: raw });
    const out = await runVoicemailSourceCleanup(h.deps);

    expect(out.blocked_summary_unavailable).toBe(true);
    expect(out.queue_empty).toBe(false);
    expect(out.status).not.toBe("completed");
    expect(out.reason).not.toBe("no_work");
    expect(out.reason).toBe("blocked_summary_unavailable");
    expect(h.logs.some((l) => l.level === "error" && /blocked-work summary unavailable/.test(l.message))).toBe(true);
  });

  it.each(MALFORMED)("REGRESSION with actionable rows: %s still lets the cleanup run", async (_label, raw) => {
    const target = row();
    const h = harness({ rows: [target], blockedSummaryRaw: raw });
    const out = await runVoicemailSourceCleanup(h.deps);

    // the work is never gated on observability
    expect(out.reconciled).toBe(1);
    expect(target.cleanup_state).toBe("deleted");
    // but the backlog is UNKNOWN, so this is not a clean completion
    expect(out.blocked_summary_unavailable).toBe(true);
    expect(out.queue_empty).toBe(false);
    expect(out.status).toBe("partial");
  });

  it("CONTROL: a VALID zero backlog is believed — completed / no_work / queue_empty", async () => {
    const h = harness({
      rows: [],
      blockedSummaryRaw: [{ blocked_due: 0, blocked_total: 0, blocked_orgs: 0, oldest_blocked_at: null, scan_capped: false }],
    });
    const out = await runVoicemailSourceCleanup(h.deps);
    expect(out.blocked_summary_unavailable).toBe(false);
    expect(out.blocked_ownership_total).toBe(0);
    expect(out.queue_empty).toBe(true);
    expect(out.status).toBe("completed");
    expect(out.reason).toBe("no_work");
  });

  it("CONTROL: a VALID non-zero backlog is believed and reported", async () => {
    const h = harness({
      rows: [],
      blockedSummaryRaw: [{ blocked_due: 7, blocked_total: 9, blocked_orgs: 2, oldest_blocked_at: "2026-09-17T00:00:00Z", scan_capped: false }],
    });
    const out = await runVoicemailSourceCleanup(h.deps);
    expect(out.blocked_summary_unavailable).toBe(false);
    expect(out.blocked_ownership_due).toBe(7);
    expect(out.blocked_ownership_total).toBe(9);
    expect(out.blocked_ownership_orgs).toBe(2);
    expect(out.oldest_blocked_at).toBe("2026-09-17T00:00:00Z");
    expect(out.queue_empty).toBe(false);
    expect(out.status).toBe("partial");
    expect(out.reason).toBe("blocked_unresolved_ownership");
  });

  it("a capped scan says so rather than under-reporting silently", async () => {
    const h = harness({ rows: Array.from({ length: 40 }, () => blockedRow()), scanLimit: 10 });
    const out = await runVoicemailSourceCleanup(h.deps);
    expect(out.blocked_scan_capped).toBe(true);
    expect(out.blocked_ownership_total).toBe(10);
    expect(out.queue_empty).toBe(false);
  });

  it("parseBlockedSummary accepts both valid shapes", () => {
    const shape = { blocked_due: 2, blocked_total: 5, blocked_orgs: 1, oldest_blocked_at: "2026-09-17T00:00:00Z", scan_capped: true };
    const expected = { due: 2, total: 5, orgs: 1, oldest: "2026-09-17T00:00:00Z", capped: true };
    expect(parseBlockedSummary([shape])).toEqual({ ok: true, value: expected });   // the SQL array form
    expect(parseBlockedSummary(shape)).toEqual({ ok: true, value: expected });     // the bare-object form
    // a valid ZERO backlog is still a valid answer, and must NOT read as unknown
    expect(parseBlockedSummary([{ blocked_due: 0, blocked_total: 0, blocked_orgs: 0, oldest_blocked_at: null, scan_capped: false }]))
      .toEqual({ ok: true, value: { due: 0, total: 0, orgs: 0, oldest: null, capped: false } });
  });

  it("REGRESSION: every malformed contract is UNKNOWN with a named reason, never a fabricated zero", () => {
    const ok = { blocked_due: 2, blocked_total: 5, blocked_orgs: 1, oldest_blocked_at: "2026-09-17T00:00:00Z", scan_capped: true };
    const cases: Array<[string, unknown, RegExp]> = [
      ["null", null, /no summary returned/],
      ["undefined", undefined, /no summary returned/],
      ["empty array", [], /exactly 1 summary row, got 0/],
      ["several rows", [ok, ok], /exactly 1 summary row, got 2/],
      ["empty object", {}, /blocked_due is missing/],
      ["not an object", ["nope"], /not an object/],
      ["missing blocked_total despite 100 due", { ...ok, blocked_total: undefined }, /blocked_total is missing/],
      ["null count", { ...ok, blocked_total: null }, /blocked_total is null, not a number/],
      ["string count", { ...ok, blocked_total: "5" }, /blocked_total is string, not a number/],
      ["NaN count", { ...ok, blocked_total: Number.NaN }, /blocked_total is not finite/],
      ["Infinity count", { ...ok, blocked_total: Number.POSITIVE_INFINITY }, /blocked_total is not finite/],
      ["fractional count", { ...ok, blocked_total: 5.5 }, /not an integer/],
      ["negative count", { ...ok, blocked_total: -3, blocked_due: 0, blocked_orgs: 0 }, /blocked_total is negative/],
      ["missing scan_capped", { ...ok, scan_capped: undefined }, /scan_capped is missing/],
      ["non-boolean scan_capped", { ...ok, scan_capped: "true" }, /scan_capped is string, not a boolean/],
      ["missing oldest_blocked_at", { ...ok, oldest_blocked_at: undefined }, /oldest_blocked_at is missing/],
      ["non-string oldest_blocked_at", { ...ok, oldest_blocked_at: 17 }, /oldest_blocked_at is number/],
      ["due exceeds total", { ...ok, blocked_due: 100, blocked_total: 5 }, /blocked_due \(100\) exceeds blocked_total \(5\)/],
      ["orgs exceed total", { ...ok, blocked_orgs: 9, blocked_total: 5 }, /blocked_orgs \(9\) exceeds blocked_total \(5\)/],
      ["100 due, total zero", { blocked_due: 100, blocked_total: 0, blocked_orgs: 0, oldest_blocked_at: null, scan_capped: false }, /blocked_due \(100\) exceeds blocked_total \(0\)/],
      ["total without orgs", { blocked_due: 1, blocked_total: 5, blocked_orgs: 0, oldest_blocked_at: "x", scan_capped: false }, /blocked_total is 5 but blocked_orgs is 0/],
      ["total zero but oldest set", { blocked_due: 0, blocked_total: 0, blocked_orgs: 0, oldest_blocked_at: "x", scan_capped: false }, /blocked_total is 0 but oldest_blocked_at is set/],
      ["total positive but oldest null", { blocked_due: 1, blocked_total: 5, blocked_orgs: 1, oldest_blocked_at: null, scan_capped: false }, /oldest_blocked_at is null/],
      ["capped scan, zero total", { blocked_due: 0, blocked_total: 0, blocked_orgs: 0, oldest_blocked_at: null, scan_capped: true }, /scan_capped is true but blocked_total is 0/],
    ];
    for (const [label, input, reason] of cases) {
      const r = parseBlockedSummary(input as never);
      expect(r.ok, `${label} must be UNKNOWN`).toBe(false);
      if (!r.ok) expect(r.reason, label).toMatch(reason);
    }
  });
});

// ── Corrective pass 13c ──────────────────────────────────────────────────────────────────────────
// THE INCONSISTENCY, reproduced at 7d5e89e through the REAL worker with an empty actionable batch and
// this exact response:
//     { blocked_due: 0, blocked_total: 0, blocked_orgs: 0, oldest_blocked_at: null, scan_capped: true }
// The parser accepted it and the pass reported, in one breath:
//     status = completed   reason = no_work   queue_empty = true
//     blocked_scan_capped = true   blocked_summary_unavailable = false
// "the scan was truncated" and "there is no backlog and nothing is owed" cannot both be true. M8 clamps
// the scan limit to at least 1 (`least(greatest(coalesce(p_scan_limit, 5000), 1), 50000)`), keeps
// `LIMIT n` rows out of a `LIMIT n + 1` probe, and sets `scan_capped` only when the probe over-filled —
// so a capped scan always retains at least one row. A zero total alongside it is a malformed response,
// and this says nothing about what production's SQL emits.
describe("CP13c: a capped scan that retained nothing is inconsistent, never evidence of an empty backlog", () => {
  const CAPPED_ZERO = { blocked_due: 0, blocked_total: 0, blocked_orgs: 0, oldest_blocked_at: null, scan_capped: true };
  // Both shapes the transport is allowed to hand back: the SQL `RETURNS TABLE` array and the bare object.
  const SHAPES: Array<[string, unknown]> = [
    ["bare object", CAPPED_ZERO],
    ["singleton array", [CAPPED_ZERO]],
  ];

  it.each(SHAPES)("the parser rejects it with a useful reason (%s)", (_label, raw) => {
    // Read through a widened view rather than an `if (!r.ok)` narrowing guard: the app project compiles
    // with `strictNullChecks: false`, where a discriminated union does not narrow on its literal tag.
    // This also asserts the reason unconditionally instead of inside a branch that could be skipped.
    const r = parseBlockedSummary(raw as never) as { ok: boolean; reason?: string };
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/scan_capped is true but blocked_total is 0/);
  });

  it.each(SHAPES)("EMPTY actionable queue (%s): UNKNOWN backlog, and none of the contradictory claims survive", async (_label, raw) => {
    const h = harness({ rows: [], blockedSummaryRaw: raw });

    const out = await runVoicemailSourceCleanup(h.deps);

    // Every field the reproduction printed, asserted against what it used to be.
    expect(out.status).not.toBe("completed");          // was "completed"
    expect(out.reason).not.toBe("no_work");            // was "no_work"
    expect(out.reason).toBe("blocked_summary_unavailable");
    expect(out.queue_empty).toBe(false);               // was true
    expect(out.blocked_summary_unavailable).toBe(true); // was false
    // The rejected summary is not believed in part: nothing claims a capped scan either.
    expect(out.blocked_scan_capped).toBe(false);       // was true
    expect(out.blocked_ownership_total).toBe(0);       // an initial value, NOT a report of zero
    expect(out.actionable_queue_empty).toBe(true);     // the actionable queue really was drained
    expect(h.logs.some((l) => l.level === "error" && /blocked-work summary unavailable/.test(l.message))).toBe(true);
    expect(h.logs.some((l) => l.detail?.reason === "scan_capped is true but blocked_total is 0 (a capped scan retains at least one row)")).toBe(true);
  });

  it.each(SHAPES)("ONE actionable row (%s): malformed backlog evidence does NOT prevent legitimate cleanup", async (_label, raw) => {
    const target = row();
    const h = harness({ rows: [target], blockedSummaryRaw: raw });

    const out = await runVoicemailSourceCleanup(h.deps);

    // The work happens — observability never gates it.
    expect(h.providerCalls).toEqual([target.recording_sid]);
    expect(out.rows_attempted).toBe(1);
    expect(out.provider_deletions).toBe(1);
    expect(out.reconciled).toBe(1);
    expect(target.cleanup_state).toBe("deleted");
    // …and the pass still refuses to call the backlog known or the queue empty.
    expect(out.blocked_summary_unavailable).toBe(true);
    expect(out.blocked_scan_capped).toBe(false);
    expect(out.queue_empty).toBe(false);
    expect(out.status).toBe("partial");
    expect(out.reason).toBe("blocked_summary_unavailable");
  });

  it.each(SHAPES)("CONTROL (%s): a capped scan with a POSITIVE total is believed and stays visible as outstanding work", async (_label, shape) => {
    const raw = { blocked_due: 4, blocked_total: 10, blocked_orgs: 2, oldest_blocked_at: "2026-09-17T00:00:00Z", scan_capped: true };
    const h = harness({ rows: [], blockedSummaryRaw: Array.isArray(shape) ? [raw] : raw });

    const out = await runVoicemailSourceCleanup(h.deps);

    expect(out.blocked_summary_unavailable).toBe(false);
    expect(out.blocked_scan_capped).toBe(true);
    expect(out.blocked_ownership_due).toBe(4);
    expect(out.blocked_ownership_total).toBe(10);
    expect(out.blocked_ownership_orgs).toBe(2);
    expect(out.oldest_blocked_at).toBe("2026-09-17T00:00:00Z");
    expect(out.queue_empty).toBe(false);
    expect(out.status).toBe("partial");
    expect(out.reason).toBe("blocked_unresolved_ownership");
  });

  it.each(SHAPES)("CONTROL (%s): an UNCAPPED zero backlog is still believed — completed / no_work / queue_empty", async (_label, shape) => {
    const raw = { blocked_due: 0, blocked_total: 0, blocked_orgs: 0, oldest_blocked_at: null, scan_capped: false };
    const h = harness({ rows: [], blockedSummaryRaw: Array.isArray(shape) ? [raw] : raw });

    const out = await runVoicemailSourceCleanup(h.deps);

    expect(out.blocked_summary_unavailable).toBe(false);
    expect(out.blocked_scan_capped).toBe(false);
    expect(out.blocked_ownership_total).toBe(0);
    expect(out.queue_empty).toBe(true);
    expect(out.status).toBe("completed");
    expect(out.reason).toBe("no_work");
  });
});
