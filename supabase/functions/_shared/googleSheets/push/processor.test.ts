import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { DbError, type ClaimedSource, type SheetsDb } from "../db.ts";
import type { JobResult, PushClaim, PushDb } from "./db.ts";
import { processTargets, runTarget } from "./processor.ts";

const CFG = { enabled: true, clientId: "cid", clientSecret: "s", redirectUri: "https://x", allowedOrigins: [], stateKey: "k".repeat(40), workerToken: "w".repeat(40) };
const SRC = (id: string): ClaimedSource => ({
  source_id: id, organization_id: "o1", user_id: "u1", connection_id: "c1", auth_generation: 7,
  spreadsheet_id: "SPREADSHEET_123", sheet_id: 0, identity_mode: "row_position", id_header: null,
  mapping: { v: 1, columns: [{ header: "First", target: "first_name" }, { header: "Last", target: "last_name" }, { header: "Phone", target: "phone" }] },
  lead_source_default: "Google Sheets", config_version: 3, phase: "steady", row_epoch: 1,
});
const CLAIM = (sources: string[]): PushClaim => ({ target_id: "t1", organization_id: "o1", user_id: "u1", connection_id: "c1",
  spreadsheet_id: "SPREADSHEET_123", attempt_id: "a1", from_seq: 0, snapshot_seq: 1, sources, oldest_received_at: null, oldest_queued_at: null });

function sheetsDb(finishTriggers: string[], opts: { already?: number } = {}) {
  return {
    loadState: async () => ({ rows: [], receipt_ids: [] }),
    refreshToken: async () => ({ refresh_token: "rt", auth_generation: 7 }),
    markReconnect: async () => true,
    context: async () => ({ duplicate_rule: "phone_or_email", duplicate_scope: "all_agents", duplicate_action: "flag", default_status: "New",
      lead_sources: [], has_lead_created_workflows: false, custom_fields: [] }),
    ingest: async (_s: ClaimedSource, _l: string, rows: { k: string }[]) => ({
      imported: Math.max(0, rows.length - (opts.already ?? 0)), flagged: 0, skipped: 0, errors: 0, new_pending: 0,
      rows: rows.map((r, i) => ({ k: r.k, o: i < (opts.already ?? 0) ? "already" : "imported" })) }),
    finish: async (_s: ClaimedSource, _l: string, t: string) => { finishTriggers.push(t); return "completed"; },
  } as unknown as SheetsDb;
}

function google(opts: { values?: string[][]; valuesStatus?: number; refresh?: [number, unknown] } = {}) {
  const urls: string[] = [];
  const fn = ((input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    urls.push(url);
    const r = (s: number, b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: s }));
    if (url.includes("oauth2.googleapis.com/token")) return r(...(opts.refresh ?? [200, { access_token: "ya29.t", expires_in: 3600 }]));
    if (url.includes("/drive/v3/files/")) return r(200, { id: "x", name: "Leads", mimeType: "application/vnd.google-apps.spreadsheet", trashed: false });
    if (url.includes("/values/")) return r(opts.valuesStatus ?? 200, { values: opts.values ?? [["First", "Last", "Phone"], ["Ann", "Lee", "5550001111"]] });
    if (url.includes("sheets.googleapis.com/v4/spreadsheets/")) {
      return r(200, { properties: { title: "Leads" }, sheets: [{ properties: { sheetId: 0, title: "Sheet1", index: 0, gridProperties: { rowCount: 100, columnCount: 5 } } }] });
    }
    return r(404, {});
  }) as typeof fetch;
  return { fn, urls };
}

function pushDb(opts: { claimSource?: (n: number) => ClaimedSource | null | "stale"; claims?: (PushClaim | null)[]; dirty?: boolean[] } = {}) {
  const calls = { claimSource: 0, claim: [] as (string | null)[], complete: [] as JobResult[] };
  let claimIdx = 0, completeIdx = 0;
  const db = {
    claim: async (_l: string, target: string | null) => { calls.claim.push(target); return opts.claims?.[claimIdx++] ?? null; },
    claimSource: async (_t: string, _l: string, source: string) => {
      const r = opts.claimSource ? opts.claimSource(calls.claimSource) : SRC(source);
      calls.claimSource++;
      if (r === "stale") throw new DbError("stale: job lease lost");
      return r;
    },
    complete: async (_t: string, _l: string, res: JobResult) => {
      calls.complete.push(res);
      return { status: "completed", outcome: res.outcome, dirty: opts.dirty?.[completeIdx++] ?? false };
    },
  } as unknown as PushDb;
  return { db, calls };
}
const noSleep = () => Promise.resolve();

Deno.test("runTarget: one tab → runSource(trigger push) → done, with counts, Google requests and the commit time", async () => {
  const triggers: string[] = [];
  const g = google();
  const p = pushDb();
  const res = await runTarget({ db: sheetsDb(triggers), push: p.db, cfg: CFG, fetchFn: g.fn, sleep: noSleep }, CLAIM(["s1"]), "L", 60_000);
  assertEquals(res.outcome, "done");
  assertEquals(res.imported, 1);
  assertEquals(res.sources_run, 1);
  assertEquals(triggers, ["push"]);
  assertEquals(res.google_requests, g.urls.length);
  assertEquals(res.google_requests, 4); // OAuth refresh + Drive files.get + Sheets metadata + values.get
  assert(res.first_commit_at !== null);
});

Deno.test("runTarget: two tabs are both run; receipt-protected rows count as duplicates prevented", async () => {
  const triggers: string[] = [];
  const res = await runTarget({ db: sheetsDb(triggers, { already: 1 }), push: pushDb().db, cfg: CFG, fetchFn: google().fn, sleep: noSleep },
    CLAIM(["s1", "s2"]), "L", 60_000);
  assertEquals(res.sources_run, 2);
  assertEquals(res.already, 2);
  assertEquals(res.imported, 0);
  assertEquals(triggers, ["push", "push"]);
});

Deno.test("runTarget: a source held by Sync now is retried in-process, then the job is retried (never 'done')", async () => {
  const p = pushDb({ claimSource: () => null });
  const res = await runTarget({ db: sheetsDb([]), push: p.db, cfg: CFG, fetchFn: google().fn, sleep: noSleep }, CLAIM(["s1"]), "L", 60_000);
  assertEquals(p.calls.claimSource, 4); // first try + 3 retries
  assertEquals([res.outcome, res.reason], ["retry", "busy"]);
  const p2 = pushDb({ claimSource: (n) => (n < 2 ? null : SRC("s1")) });
  const res2 = await runTarget({ db: sheetsDb([]), push: p2.db, cfg: CFG, fetchFn: google().fn, sleep: noSleep }, CLAIM(["s1"]), "L", 60_000);
  assertEquals(res2.outcome, "done");
});

Deno.test("runTarget: Google 429 → retry, invalid_grant → blocked, a lost job lease → retry stale", async () => {
  const quota = await runTarget({ db: sheetsDb([]), push: pushDb().db, cfg: CFG, fetchFn: google({ valuesStatus: 429 }).fn, sleep: noSleep },
    CLAIM(["s1"]), "L", 60_000);
  assertEquals([quota.outcome, quota.reason], ["retry", "google_backoff"]);
  const grant = await runTarget({ db: sheetsDb([]), push: pushDb().db, cfg: CFG,
    fetchFn: google({ refresh: [400, { error: "invalid_grant" }] }).fn, sleep: noSleep }, CLAIM(["s1"]), "L", 60_000);
  assertEquals([grant.outcome, grant.reason], ["blocked", "reconnect"]);
  const lost = await runTarget({ db: sheetsDb([]), push: pushDb({ claimSource: () => "stale" }).db, cfg: CFG, fetchFn: google().fn, sleep: noSleep },
    CLAIM(["s1"]), "L", 60_000);
  assertEquals([lost.outcome, lost.reason], ["retry", "stale"]);
});

Deno.test("runTarget: an incomplete row is pending (no lead) and the job is still done", async () => {
  const res = await runTarget({ db: sheetsDb([]), push: pushDb().db, cfg: CFG,
    fetchFn: google({ values: [["First", "Last", "Phone"], ["Ann", "", ""]] }).fn, sleep: noSleep }, CLAIM(["s1"]), "L", 60_000);
  assertEquals(res.outcome, "done");
  assertEquals(res.imported, 0);
  assertEquals(res.errors, 1);
  assertEquals(res.first_commit_at, null);
});

Deno.test("runTarget: no eligible tabs (paused, removed) → done without a Google request", async () => {
  const g = google();
  const res = await runTarget({ db: sheetsDb([]), push: pushDb().db, cfg: CFG, fetchFn: g.fn, sleep: noSleep }, CLAIM([]), "L", 60_000);
  assertEquals(res.outcome, "done");
  assertEquals(g.urls.length, 0);
});

Deno.test("processTargets: a dirty completion re-runs the same target; then it steals other due work and stops", async () => {
  const p = pushDb({ claims: [CLAIM(["s1"]), CLAIM(["s1"]), null], dirty: [true, false] });
  const s = await processTargets({ db: sheetsDb([]), push: p.db, cfg: CFG, fetchFn: google().fn, sleep: noSleep },
    { target: "t1", worker: "receiver", budgetMs: 60_000 });
  assertEquals(p.calls.claim, ["t1", "t1", null]);
  assertEquals(s.targets, 2);
  assertEquals(p.calls.complete.length, 2);
});

Deno.test("processTargets: a target leased elsewhere falls back to stealing once, then stops", async () => {
  const p = pushDb({ claims: [null, null] });
  const s = await processTargets({ db: sheetsDb([]), push: p.db, cfg: CFG, fetchFn: google().fn, sleep: noSleep },
    { target: "t1", worker: "receiver", budgetMs: 60_000 });
  assertEquals(p.calls.claim, ["t1", null]);
  assertEquals(s.targets, 0);
});
