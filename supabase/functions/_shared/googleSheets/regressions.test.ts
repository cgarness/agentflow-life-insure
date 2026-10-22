// REGRESSION tests for the PR #442 review findings (reviewed head 8b675e5). Each test reproduces a reported
// defect through behaviour present in BOTH versions (planRows / planSourceId / runSource), so it fails on the
// reviewed code and passes on the corrected code. Controls (tests expected to pass on both) are marked CONTROL.
// Run against an old checkout with `deno test --no-check` (type shapes differ; behaviour is what is asserted).
import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { planRows, runSource } from "./engine.ts";
import { identityRows, planSourceId, type LedgerRow } from "./identity.ts";
import { resolveColumns, validateMapping, type SheetMapping } from "./mapping.ts";
import type { ClaimedSource, SheetsDb } from "./db.ts";

const COVERAGE = "33333333-3333-3333-3333-333333333333";
const MAPPING = {
  v: 1, columns: [
    { header: "First", target: "first_name" }, { header: "Last", target: "last_name" }, { header: "Phone", target: "phone" },
    { header: "Email", target: "email" }, { header: "State", target: "state" }, { header: "DOB", target: "date_of_birth" },
    { header: "Notes", target: "notes" }, { header: "Coverage", target: `custom:${COVERAGE}` },
  ],
};
const HEADER = ["Lead ID", "First", "Last", "Phone", "Email", "State", "DOB", "Notes", "Coverage"];
const NAMES = new Map([[COVERAGE, "Coverage Amount"]]);
// [id, first, last, phone, email?, state?, dob?, notes?, coverage?]
const R = (...c: string[]) => [...c, ...Array(HEADER.length - c.length).fill("")];
const ANN = ["Ann", "Lee", "5550001111"], BO = ["Bo", "Diaz", "5550002222"], CY = ["Cy", "Park", "5550003333"];
const DI = ["Di", "Moss", "5550004444"], CAL = ["Cal", "Ford", "5550005555"];

async function planned(values: string[][]) {
  const m = validateMapping(MAPPING);
  if (!m.ok) throw new Error("mapping");
  const cols = resolveColumns(HEADER, m.mapping as SheetMapping, "Lead ID");
  return await planRows(values, cols, NAMES);
}
/** Ledger exactly as activation writes it when "Also import existing rows" is unchecked. */
async function baselineOf(values: string[][]): Promise<LedgerRow[]> {
  return identityRows(await planned(values), "source_id").map((r) => ({ k: r.k, n: r.n, f: r.f, kind: "baseline", reason: null }));
}
async function plan(values: string[][], ledger: LedgerRow[], receipts: string[] = []) {
  return planSourceId(await planned(values), ledger, new Set(receipts));
}
const keys = (p: { candidates: { k: string }[] }) => p.candidates.map((c) => c.k);

// ------------------------------------------------------------------------------------------- Finding 1
Deno.test("REGRESSION F1: sorted blank-ID baseline that later gets an ID is never imported automatically (exact repro)", async () => {
  const ledger = await baselineOf([R("", ...ANN), R("B1", ...BO)]);            // blank:2 (Ann) excluded, id:B1 excluded
  const p = await plan([R("B1", ...BO), R("NEWID", ...ANN)], ledger);          // sorted; Ann now row 3 with an ID
  assertEquals(keys(p).includes("id:NEWID"), false, "the excluded row must not become an import candidate");
  assertEquals(p.candidates.length, 0);
  assertEquals(p.structural, "identity_ambiguous");
});

Deno.test("REGRESSION F1: excluded row edited, moved and then given an ID is not imported automatically", async () => {
  const ledger = await baselineOf([R("", ...ANN), R("B1", ...BO)]);
  const p = await plan([R("B1", ...BO), R("N2", "Annie", "Lee", "5550001111")], ledger);
  assertEquals(keys(p).includes("id:N2"), false);
  assertEquals(p.structural, "identity_ambiguous");
});

Deno.test("REGRESSION F1: several excluded blank-ID rows shuffled, one completed → nothing imported", async () => {
  const ledger = await baselineOf([R("", ...ANN), R("", ...CY), R("C1", ...CAL), R("", ...DI)]);
  const p = await plan([R("", ...DI), R("", ...ANN), R("CYID", ...CY), R("C1", ...CAL)], ledger);
  assertEquals(keys(p).includes("id:CYID"), false);
  assertEquals(p.candidates.length, 0);
  assertEquals(p.structural, "identity_ambiguous");
});

Deno.test("REGRESSION F1: identical-looking row with a new ID while the excluded twin moved → review, not import", async () => {
  const ledger = await baselineOf([R("", ...ANN), R("B1", ...BO)]);
  const p = await plan([R("B1", ...BO), R("", ...ANN), R("N9", ...ANN)], ledger);
  assertEquals(keys(p).includes("id:N9"), false);
  assertEquals(p.structural, "identity_ambiguous");
});

Deno.test("CONTROL F1: an excluded blank row completed in place (nothing else moved) stays excluded", async () => {
  const ledger = await baselineOf([R("", ...ANN), R("B1", ...BO)]);
  const p = await plan([R("A7", ...ANN), R("B1", ...BO), R("C9", ...CY)], ledger);
  assertEquals(keys(p), ["id:C9"]);
  assertEquals(p.structural, null);
});

// ------------------------------------------------------------------------------------------- Finding 3
async function conflictCase(a: string[], b: string[]) {
  const p = await plan([a, b], []);
  assertEquals(keys(p).includes("id:X"), false, "a conflicting duplicate ID must never import a silent winner");
  assertEquals(p.candidates.length, 0);
  assertEquals(p.newErrors.length, 2, "both rows are reported");
}
Deno.test("REGRESSION F3: same Lead ID + same core, different state → conflict", () =>
  conflictCase(R("X", ...ANN, "", "CA"), R("X", ...ANN, "", "TX")));
Deno.test("REGRESSION F3: same Lead ID + same core, different DOB → conflict", () =>
  conflictCase(R("X", ...ANN, "", "", "1980-01-01"), R("X", ...ANN, "", "", "1981-02-02")));
Deno.test("REGRESSION F3: same Lead ID + same core, different notes → conflict", () =>
  conflictCase(R("X", ...ANN, "", "", "", "call am"), R("X", ...ANN, "", "", "", "call pm")));
Deno.test("REGRESSION F3: same Lead ID + same core, different custom value → conflict", () =>
  conflictCase(R("X", ...ANN, "", "", "", "", "100000"), R("X", ...ANN, "", "", "", "", "250000")));
Deno.test("REGRESSION F3: valid + invalid row sharing a Lead ID with identical core → conflict, not the valid one", () =>
  conflictCase(R("X", ...ANN, "", "", "1980-01-01"), R("X", ...ANN, "", "", "not-a-date")));

Deno.test("CONTROL F3: genuinely identical repeats import once", async () => {
  const p = await plan([R("X", ...ANN, "", "CA"), R("X", ...ANN, "", "CA")], []);
  assertEquals(keys(p), ["id:X"]);
});

// ------------------------------------------------------------------------------------------- Finding 2 (engine)
const CFG = { enabled: true, clientId: "cid", clientSecret: "s", redirectUri: "https://x", allowedOrigins: [], stateKey: "k".repeat(40), workerToken: "w".repeat(40) };
const SRC: ClaimedSource = {
  source_id: "s1", organization_id: "o1", user_id: "u1", connection_id: "c1", auth_generation: 7,
  spreadsheet_id: "SPREADSHEET_123", sheet_id: 0, identity_mode: "source_id", id_header: "Lead ID", mapping: MAPPING,
  lead_source_default: "Google Sheets", config_version: 3, phase: "steady", row_epoch: 1,
};
function fakeDb(ledger: LedgerRow[], finishOutcome: unknown) {
  const calls = { ingest: [] as { rows: { k: string }[]; pending: unknown[] }[], finish: [] as Record<string, unknown>[] };
  const db = {
    claim: async () => [],
    loadState: async () => ({ rows: ledger, receipt_ids: [] }),
    refreshToken: async () => ({ refresh_token: "rt", auth_generation: 7 }),
    markReconnect: async () => true,
    context: async () => ({ duplicate_rule: "phone_or_email", duplicate_scope: "all_agents", duplicate_action: "flag", default_status: "New",
      lead_sources: [], has_lead_created_workflows: false, custom_fields: [{ id: COVERAGE, name: "Coverage Amount", created_by: null, created_at: null }] }),
    reviewState: async () => ({ rows: ledger, receipt_ids: [] }),
    ingest: async (_s: ClaimedSource, _l: string, rows: { k: string }[], pending: unknown[]) => {
      calls.ingest.push({ rows, pending });
      return { imported: rows.length, flagged: 0, skipped: 0, errors: 0, new_pending: pending.length, rows: [] };
    },
    finish: async (_s: ClaimedSource, _l: string, _t: string, r: Record<string, unknown>) => { calls.finish.push(r); return finishOutcome; },
  } as unknown as SheetsDb;
  return { db, calls };
}
function google(values: string[][]) {
  return (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const r = (s: number, b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: s }));
    if (url.includes("oauth2.googleapis.com/token")) return r(200, { access_token: "ya29.t", expires_in: 3600 });
    if (url.includes("/drive/v3/files/")) return r(200, { id: "x", name: "Leads", mimeType: "application/vnd.google-apps.spreadsheet", trashed: false });
    if (url.includes("/values/")) return r(200, { values });
    if (url.includes("sheets.googleapis.com/v4/spreadsheets/")) {
      return r(200, { properties: { title: "Leads" }, sheets: [{ properties: { sheetId: 0, title: "Sheet1", index: 0, gridProperties: { rowCount: 100, columnCount: 9 } } }] });
    }
    return r(404, {});
  };
}

Deno.test("REGRESSION F1 (engine): the sorted, completed excluded row is never sent to ingest", async () => {
  const ledger = await baselineOf([R("", ...ANN), R("B1", ...BO)]);
  const { db, calls } = fakeDb(ledger, "completed");
  const out = await runSource({ db, cfg: CFG, fetchFn: google([HEADER, R("B1", ...BO), R("NEWID", ...ANN)]) as typeof fetch }, SRC, "l", "schedule", 30_000);
  const sent = calls.ingest.flatMap((c) => c.rows.map((r) => r.k));
  assertEquals(sent.includes("id:NEWID"), false);
  assertEquals(out.imported, 0);
  assertEquals(out.status, "needs_review");
  assertEquals(calls.finish[0]?.review_reason, "identity_ambiguous");
});

Deno.test("REGRESSION F2 (engine): a finish that was not applied (released) is not reported as a completed sync", async () => {
  const { db, calls } = fakeDb([], "released");
  const out = await runSource({ db, cfg: CFG, fetchFn: google([HEADER, R("A1", ...ANN), R("B1", ...BO)]) as typeof fetch }, SRC, "l", "schedule", 30_000);
  assertEquals(calls.finish.length, 1);
  assert(out.status !== "ok", `status must not be ok when finish returned released (got ${out.status})`);
  assertEquals(out.status, "stale");
  assertEquals(out.imported, 2, "committed batches are still reported truthfully");
});

Deno.test("REGRESSION F2 (engine): a review finish that lost the lease is not reported as needs_review", async () => {
  const ledger = await baselineOf([R("", ...ANN), R("B1", ...BO)]);
  const { db } = fakeDb(ledger, "not_owner");
  const out = await runSource({ db, cfg: CFG, fetchFn: google([HEADER, R("B1", ...BO), R("NEWID", ...ANN)]) as typeof fetch }, SRC, "l", "schedule", 30_000);
  assertEquals(out.status, "stale");
});
