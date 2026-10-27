import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { runSource } from "./engine.ts";
import { DbError, type ClaimedSource, type SheetsDb } from "./db.ts";
import type { LedgerRow } from "./identity.ts";

const CFG = { enabled: true, clientId: "cid", clientSecret: "s", redirectUri: "https://x", allowedOrigins: [], stateKey: "k".repeat(40), workerToken: "w".repeat(40) };
const SRC: ClaimedSource = {
  source_id: "s1", organization_id: "o1", user_id: "u1", connection_id: "c1", auth_generation: 7,
  spreadsheet_id: "SPREADSHEET_123", sheet_id: 0, identity_mode: "row_position", id_header: null,
  mapping: { v: 1, columns: [{ header: "First", target: "first_name" }, { header: "Last", target: "last_name" }, { header: "Phone", target: "phone" }] },
  lead_source_default: "Google Sheets", config_version: 3, phase: "steady", row_epoch: 1,
};

function fakeDb(ledger: LedgerRow[] = [], opts: { staleOnIngest?: boolean; finish?: string } = {}) {
  const calls: Record<string, unknown[]> = { ingest: [], finish: [], markReconnect: [] };
  const db = {
    claim: async () => [],
    loadState: async () => ({ rows: ledger, receipt_ids: [] }),
    refreshToken: async () => ({ refresh_token: "rt", auth_generation: 7 }),
    markReconnect: async (...a: unknown[]) => { calls.markReconnect.push(a); return true; },
    context: async () => ({ duplicate_rule: "phone_or_email", duplicate_scope: "all_agents", duplicate_action: "flag", default_status: "New",
                            lead_sources: [], has_lead_created_workflows: false, custom_fields: [] }),
    ingest: async (_s: ClaimedSource, _l: string, rows: any[], pending: unknown[]) => {
      calls.ingest.push({ rows, pending });
      if (opts.staleOnIngest && rows.length) throw new DbError("stale: configuration changed");
      return { imported: rows.length, flagged: 0, skipped: 0, errors: 0, new_pending: pending.length, rows: [] };
    },
    finish: async (_s: ClaimedSource, _l: string, _t: string, r: Record<string, unknown>) => { calls.finish.push(r); return opts.finish ?? "completed"; },
  } as unknown as SheetsDb;
  return { db, calls };
}

function google(values: string[][], opts: { valuesStatus?: number; valuesBody?: unknown; refresh?: [number, unknown] } = {}) {
  return (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const r = (s: number, b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: s }));
    if (url.includes("oauth2.googleapis.com/token")) return r(...(opts.refresh ?? [200, { access_token: "ya29.t", expires_in: 3600 }]));
    if (url.includes("/drive/v3/files/")) return r(200, { id: "x", name: "Leads", mimeType: "application/vnd.google-apps.spreadsheet", trashed: false });
    if (url.includes("/values/")) return r(opts.valuesStatus ?? 200, opts.valuesBody ?? { values });
    if (url.includes("sheets.googleapis.com/v4/spreadsheets/")) {
      return r(200, { properties: { title: "Leads" }, sheets: [{ properties: { sheetId: 0, title: "Sheet1", index: 0, gridProperties: { rowCount: 100, columnCount: 5 } } }] });
    }
    return r(404, {});
  };
}

Deno.test("engine: imports new rows after a baseline and finishes with counts", async () => {
  const { db, calls } = fakeDb([]);
  const out = await runSource({ db, cfg: CFG, fetchFn: google([["First", "Last", "Phone"], ["Ann", "Lee", "5550001111"], ["Bo", "", "5550002222"]]) as typeof fetch },
    SRC, "lease", "schedule", 30_000);
  assertEquals(out.status, "ok");
  assertEquals(out.imported, 1);
  assertEquals(out.errors, 1);
  const f = calls.finish[0] as Record<string, unknown>;
  assertEquals(f.health, "ok");
  assertEquals(f.errors, 1);
  assertEquals((f.errors_sample as unknown[]).length, 1);
});

Deno.test("engine: more than 500 candidates → 500 processed in batches of 50, backlog flagged", async () => {
  const rows = [["First", "Last", "Phone"], ...Array.from({ length: 620 }, (_, i) => ["F" + i, "L", String(5550000000 + i)])];
  const { db, calls } = fakeDb([]);
  const out = await runSource({ db, cfg: CFG, fetchFn: google(rows) as typeof fetch }, { ...SRC, phase: "initial" }, "l", "schedule", 30_000);
  assertEquals(out.imported, 500);
  assert(out.backlog);
  const batches = (calls.ingest as { rows: unknown[] }[]).filter((c) => c.rows.length > 0);
  assertEquals(batches.length, 10);
  assert(batches.every((b) => b.rows.length === 50));
  assertEquals((calls.finish[0] as Record<string, unknown>).phase_complete, false);
});

Deno.test("engine: structural change in no-ID mode → needs_review, nothing imported", async () => {
  const ledger: LedgerRow[] = [{ k: "pos:2", n: 2, f: "not-this-fingerprint", kind: "done", reason: null }];
  const { db, calls } = fakeDb(ledger);
  const out = await runSource({ db, cfg: CFG, fetchFn: google([["First", "Last", "Phone"], ["Ann", "Lee", "5550001111"]]) as typeof fetch }, SRC, "l", "schedule", 30_000);
  assertEquals(out.status, "needs_review");
  assertEquals(calls.ingest.length, 0);
  assertEquals((calls.finish[0] as Record<string, unknown>).review_reason, "rows_changed");
});

Deno.test("engine: header change → needs_review (header_changed)", async () => {
  const { db, calls } = fakeDb([]);
  const out = await runSource({ db, cfg: CFG, fetchFn: google([["Given", "Last", "Phone"], ["Ann", "Lee", "5550001111"]]) as typeof fetch }, SRC, "l", "schedule", 30_000);
  assertEquals(out.status, "needs_review");
  assertEquals((calls.finish[0] as Record<string, unknown>).review_reason, "header_changed");
  assertEquals(calls.ingest.length, 0);
});

Deno.test("engine: invalid_grant → generation-guarded reconnect, no import", async () => {
  const { db, calls } = fakeDb([]);
  const out = await runSource({ db, cfg: CFG, fetchFn: google([], { refresh: [400, { error: "invalid_grant" }] }) as typeof fetch }, SRC, "l", "schedule", 30_000);
  assertEquals(out.status, "reconnect");
  assertEquals(calls.markReconnect[0], ["c1", 7, "invalid_grant"]);
  assertEquals(calls.ingest.length, 0);
});

Deno.test("engine: quota 403 backs off (not access lost); real 404 → access_lost", async () => {
  const q = fakeDb([]);
  const o1 = await runSource({ db: q.db, cfg: CFG, fetchFn: google([], { valuesStatus: 403, valuesBody: { error: { errors: [{ reason: "rateLimitExceeded" }] } } }) as typeof fetch },
    SRC, "l", "schedule", 30_000);
  assertEquals(o1.status, "backoff");
  assertEquals((q.calls.finish[0] as Record<string, unknown>).backoff, true);
  const n = fakeDb([]);
  const o2 = await runSource({ db: n.db, cfg: CFG, fetchFn: google([], { valuesStatus: 404, valuesBody: {} }) as typeof fetch }, SRC, "l", "schedule", 30_000);
  assertEquals(o2.status, "access_lost");
});

Deno.test("engine: stale work stops without overwriting state", async () => {
  const { db, calls } = fakeDb([], { staleOnIngest: true });
  const out = await runSource({ db, cfg: CFG, fetchFn: google([["First", "Last", "Phone"], ["Ann", "Lee", "5550001111"]]) as typeof fetch }, SRC, "l", "schedule", 30_000);
  assertEquals(out.status, "stale");
  assertEquals(calls.finish.length, 1); // lease release attempt; SQL refuses status writes for a changed version
});

Deno.test("engine: tab over 10,000 rows → needs_review too_large (never truncated)", async () => {
  const rows = [["First", "Last", "Phone"], ...Array.from({ length: 10_001 }, () => ["A", "B", "5551112222"])];
  const { db, calls } = fakeDb([]);
  const out = await runSource({ db, cfg: CFG, fetchFn: google(rows) as typeof fetch }, SRC, "l", "schedule", 30_000);
  assertEquals(out.status, "needs_review");
  assertEquals((calls.finish[0] as Record<string, unknown>).review_reason, "too_large");
  assertEquals(calls.ingest.length, 0);
});

// ---------------------------------------------------------------- mapping v2 runs (typed catalog, sheet locale)
const AMT = "22222222-2222-4222-8222-222222222222", WHEN = "33333333-3333-4333-8333-333333333333", ZIPF = "44444444-4444-4444-8444-444444444444";
const TYPED = [
  { id: AMT, name: "Amt Requested", created_by: "u1", created_at: null, type: "Number" },
  { id: WHEN, name: "Date Received", created_by: "u1", created_at: null, type: "Date" },
  { id: ZIPF, name: "ZIP Code", created_by: null, created_at: null, type: "Text" },
];
const typedDb = (ledger: LedgerRow[]) => {
  const f = fakeDb(ledger);
  (f.db as unknown as { context: () => Promise<unknown> }).context = async () => ({ duplicate_rule: "phone_or_email", duplicate_scope: "all_agents",
    duplicate_action: "flag", default_status: "New", lead_sources: [], has_lead_created_workflows: false, custom_fields: TYPED, catalog_version: 2 });
  return f;
};
const typedGoogle = (locale: string) => (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("sheets.googleapis.com/v4/spreadsheets/") && !url.includes("/values/")) {
    return Promise.resolve(new Response(JSON.stringify({ properties: { title: "Leads", locale },
      sheets: [{ properties: { sheetId: 0, title: "Sheet1", index: 0, gridProperties: { rowCount: 100, columnCount: 7 } } }] }), { status: 200 }));
  }
  return google([["First", "Last", "Phone", "Amt", "When", "Zip"], ["Ann", "Lee", "5550001111", "$1,234.50", "10/27/2026", "02134"]])(input);
};
const typedColumns = [{ header: "First", target: "first_name" }, { header: "Last", target: "last_name" }, { header: "Phone", target: "phone" },
  { header: "Amt", target: `custom:${AMT}` }, { header: "When", target: `custom:${WHEN}` }, { header: "Zip", target: `custom:${ZIPF}` }];
const newRowsOnly: LedgerRow[] = [];

Deno.test("engine v2: stored values are lossless-typed with the sheet's locale; ZIP (Text) is byte-exact", async () => {
  const { db, calls } = typedDb(newRowsOnly);
  const out = await runSource({ db, cfg: CFG, fetchFn: typedGoogle("en_US") as typeof fetch },
    { ...SRC, mapping: { v: 2, columns: typedColumns, ignored: [] } }, "lease", "push", 30_000);
  assertEquals([out.status, out.imported], ["ok", 1]);
  const lead = ((calls.ingest.find((x) => (x as { rows: unknown[] }).rows.length) as { rows: { lead: { custom_fields: unknown } }[] }).rows[0]).lead;
  assertEquals(lead.custom_fields, { "Amt Requested": "1234.50", "Date Received": "2026-10-27", "ZIP Code": "02134" });
});

Deno.test("engine v2: a day-first sheet keeps M/D/Y-looking dates exactly", async () => {
  const { db, calls } = typedDb(newRowsOnly);
  await runSource({ db, cfg: CFG, fetchFn: typedGoogle("en_GB") as typeof fetch },
    { ...SRC, mapping: { v: 2, columns: typedColumns, ignored: [] } }, "lease", "manual", 30_000);
  const lead = ((calls.ingest.find((x) => (x as { rows: unknown[] }).rows.length) as { rows: { lead: { custom_fields: Record<string, string> } }[] }).rows[0]).lead;
  assertEquals(lead.custom_fields["Date Received"], "10/27/2026");
});

Deno.test("engine v1 under the typed catalog: values stay raw (existing sources never change behaviour)", async () => {
  const { db, calls } = typedDb(newRowsOnly);
  await runSource({ db, cfg: CFG, fetchFn: typedGoogle("en_US") as typeof fetch },
    { ...SRC, mapping: { v: 1, columns: typedColumns } }, "lease", "schedule", 30_000);
  const lead = ((calls.ingest.find((x) => (x as { rows: unknown[] }).rows.length) as { rows: { lead: { custom_fields: unknown } }[] }).rows[0]).lead;
  assertEquals(lead.custom_fields, { "Amt Requested": "$1,234.50", "Date Received": "10/27/2026", "ZIP Code": "02134" });
});

Deno.test("engine v2 without the typed catalog (catalog rolled back): values fall back to raw, nothing fails", async () => {
  const { db, calls } = fakeDb(newRowsOnly);
  (db as unknown as { context: () => Promise<unknown> }).context = async () => ({ duplicate_rule: "phone_or_email", duplicate_scope: "all_agents",
    duplicate_action: "flag", default_status: "New", lead_sources: [], has_lead_created_workflows: false,
    custom_fields: TYPED.map(({ id, name, created_by, created_at }) => ({ id, name, created_by, created_at })) });
  const out = await runSource({ db, cfg: CFG, fetchFn: typedGoogle("en_US") as typeof fetch },
    { ...SRC, mapping: { v: 2, columns: typedColumns, ignored: ["Notes"] } }, "lease", "push", 30_000);
  assertEquals(out.status, "ok");
  const lead = ((calls.ingest.find((x) => (x as { rows: unknown[] }).rows.length) as { rows: { lead: { custom_fields: unknown } }[] }).rows[0]).lead;
  assertEquals(lead.custom_fields, { "Amt Requested": "$1,234.50", "Date Received": "10/27/2026", "ZIP Code": "02134" });
});
