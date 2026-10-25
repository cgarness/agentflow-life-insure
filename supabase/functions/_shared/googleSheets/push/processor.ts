// Push processing: claim a queued target (job lease + snapshot) → for each eligible tab, the explicitly authorised
// push claim of that source → the UNCHANGED runSource engine (trigger "push") → push_complete, which re-derives the
// outcome in SQL and only then advances processed_seq. Loops while the target is dirty (a notification arrived
// mid-run → exactly one follow-up run), then steals other due targets while the budget lasts. Nothing here can
// lose a notification: a crash leaves processed_seq unchanged and an expiring lease for the next worker.
import type { SheetsConfig } from "../config.ts";
import { DbError, type ClaimedSource, type SheetsDb } from "../db.ts";
import { runSource, type RunOutcome } from "../engine.ts";
import { sanitizeError } from "../errors.ts";
import { PUSH } from "./config.ts";
import type { JobOutcome, JobResult, PushClaim, PushDb, Worker } from "./db.ts";

export interface ProcessDeps {
  db: SheetsDb; push: PushDb; cfg: SheetsConfig; fetchFn: typeof fetch;
  now?: () => number; sleep?: (ms: number) => Promise<void>;
}
export interface ProcessSummary { targets: number; imported: number; outcomes: string[] }

const SEVERITY: Record<JobOutcome, number> = { done: 0, backlog: 1, retry: 2, blocked: 3 };

/** Maps one source run to the job outcome it forces (the job takes the most severe). */
export function outcomeFor(out: RunOutcome): { outcome: JobOutcome; reason: string } {
  switch (out.status) {
    case "ok": return out.backlog ? { outcome: "backlog", reason: "backlog" } : { outcome: "done", reason: "" };
    case "needs_review": case "access_lost": return { outcome: "done", reason: "" }; // the source left the eligible set
    case "reconnect": return { outcome: "blocked", reason: "reconnect" };
    case "backoff": return { outcome: "retry", reason: "google_backoff" };
    case "stale": return { outcome: "retry", reason: "stale" };
    default: return { outcome: "retry", reason: "run_failed" };
  }
}

export async function runTarget(deps: ProcessDeps, claim: PushClaim, lease: string, budgetMs: number): Promise<JobResult> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const deadline = now() + budgetMs;
  const res: JobResult = { outcome: "done", reason: "", sources_run: 0, imported: 0, flagged: 0, skipped: 0, already: 0,
    errors: 0, google_requests: 0, first_commit_at: null };
  const bump = (o: JobOutcome, reason: string) => {
    if (SEVERITY[o] > SEVERITY[res.outcome]) { res.outcome = o; res.reason = reason; }
  };
  const counting = ((input: string | URL | Request, init?: RequestInit) => {
    res.google_requests++;
    return deps.fetchFn(input, init);
  }) as typeof fetch;

  try {
    for (const sourceId of claim.sources) {
      if (deadline - now() < PUSH.minSourceBudgetMs) { bump("backlog", "budget"); break; }
      let claimed: ClaimedSource | null = null;
      let srcLease = "";
      for (let attempt = 0; attempt <= PUSH.busyRetries; attempt++) {
        srcLease = crypto.randomUUID();
        claimed = await deps.push.claimSource(claim.target_id, lease, sourceId, srcLease);
        if (claimed || attempt === PUSH.busyRetries || now() + PUSH.busyWaitMs + PUSH.minSourceBudgetMs > deadline) break;
        await sleep(PUSH.busyWaitMs);
      }
      if (!claimed) { bump("retry", "busy"); continue; }
      res.sources_run++;
      const out = await runSource({
        db: deps.db, cfg: deps.cfg, fetchFn: counting, now,
        onIngest: (r) => { if (r.imported > 0 && !res.first_commit_at) res.first_commit_at = new Date(now()).toISOString(); },
      }, claimed, srcLease, "push", Math.max(1_000, Math.min(PUSH.sourceBudgetMs, deadline - now() - 2_000)));
      res.imported += out.imported; res.flagged += out.flagged; res.skipped += out.skipped;
      res.already += out.already; res.errors += out.errors;
      const o = outcomeFor(out);
      bump(o.outcome, o.reason);
    }
  } catch (e) {
    // A lost job lease ('stale: job lease lost') or an infrastructure error: keep the work queued.
    bump("retry", e instanceof DbError && e.stale ? "stale" : "run_failed");
    console.error(`google-sheets-push: target ${claim.target_id} run failed: ${sanitizeError(e)}`);
  }
  return res;
}

/**
 * Processes `target` (or, with null, the next due target) and keeps going while work is due and the budget lasts.
 * The SQL claim enforces scope, the concurrency cap and per-connection serialisation.
 */
export async function processTargets(deps: ProcessDeps, opts: { target: string | null; worker: Worker; budgetMs: number }): Promise<ProcessSummary> {
  const now = deps.now ?? Date.now;
  const started = now();
  const summary: ProcessSummary = { targets: 0, imported: 0, outcomes: [] };
  let next: string | null = opts.target;
  for (let i = 0; i < PUSH.maxTargetsPerRun; i++) {
    const remaining = opts.budgetMs - (now() - started);
    if (remaining < PUSH.minSourceBudgetMs + 2_000) break;
    const lease = crypto.randomUUID();
    const claim = await deps.push.claim(lease, next, PUSH.jobLeaseS, opts.worker);
    if (!claim) {
      if (next === null) break;
      next = null; // our target is leased elsewhere or not due: help with any other due work
      continue;
    }
    const result = await runTarget(deps, claim, lease, remaining - 2_000);
    const done = await deps.push.complete(claim.target_id, lease, result);
    summary.targets++; summary.imported += result.imported; summary.outcomes.push(done.outcome ?? done.status);
    next = done.dirty ? claim.target_id : null;
  }
  return summary;
}
