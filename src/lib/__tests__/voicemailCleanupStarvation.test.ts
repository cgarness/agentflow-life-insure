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
  normalizeBlockedSummary,
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

  it("a capped scan says so rather than under-reporting silently", async () => {
    const h = harness({ rows: Array.from({ length: 40 }, () => blockedRow()), scanLimit: 10 });
    const out = await runVoicemailSourceCleanup(h.deps);
    expect(out.blocked_scan_capped).toBe(true);
    expect(out.blocked_ownership_total).toBe(10);
    expect(out.queue_empty).toBe(false);
  });

  it("normalizeBlockedSummary accepts both shapes and treats an unusable one as UNKNOWN", () => {
    const shape = { blocked_due: 2, blocked_total: 5, blocked_orgs: 1, oldest_blocked_at: "2026-09-17T00:00:00Z", scan_capped: true };
    expect(normalizeBlockedSummary([shape])).toEqual({ due: 2, total: 5, orgs: 1, oldest: "2026-09-17T00:00:00Z", capped: true });
    expect(normalizeBlockedSummary(shape)).toEqual({ due: 2, total: 5, orgs: 1, oldest: "2026-09-17T00:00:00Z", capped: true });
    expect(normalizeBlockedSummary(null)).toBeNull();
    expect(normalizeBlockedSummary([])).toBeNull();
    // a negative or non-numeric count is floored to 0 rather than propagated
    expect(normalizeBlockedSummary([{ blocked_total: -3, blocked_due: "x" as unknown as number }])?.total).toBe(0);
  });
});
