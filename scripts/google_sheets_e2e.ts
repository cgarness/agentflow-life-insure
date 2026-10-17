// =====================================================================================================
// Google Sheets — END-TO-END Review harness (LOCAL ONLY; invoked by scripts/run_google_sheets_tests.sh).
// Runs the REAL google-sheets-api action code + sync engine against the candidate migration through a
// local PostgREST (the production HTTP path). Only Google HTTP is faked. Every scenario goes
// planner → Review preview → Review apply → next sync and asserts on leads, ledger effects and status.
// Usage: deno run --allow-net=127.0.0.1 --allow-env --allow-read scripts/google_sheets_e2e.ts <postgrest-url> <jwt-secret>
// =====================================================================================================
import * as A from "../supabase/functions/google-sheets-api/actions.ts";
import { DbError } from "../supabase/functions/_shared/googleSheets/db.ts";
import { postgrestClient, signHs256 } from "./google_sheets_postgrest_client.ts";

const [base, secret] = Deno.args;
if (!base?.startsWith("http://127.0.0.1:")) throw new Error("REFUSING: local PostgREST only");
const SERVICE = await signHs256(secret, { role: "service_role" });
const svc = postgrestClient(base, SERVICE);
const ORG = "a0000000-0000-0000-0000-0000000000e2", USER = "e2000000-0000-0000-0000-000000000001";
const SPREADSHEET = "SPREADSHEET_E2E_REVIEW";
const HEADER = ["Lead ID", "First", "Last", "Phone", "Email"];
const ID_MAPPING = { v: 1, columns: [{ header: "First", target: "first_name" }, { header: "Last", target: "last_name" },
  { header: "Phone", target: "phone" }, { header: "Email", target: "email" }] };
const CFG = { enabled: true, clientId: "cid.e2e", clientSecret: "s", redirectUri: "https://x/cb", allowedOrigins: [],
  stateKey: "k".repeat(40), workerToken: "w".repeat(40) };

// ---------------------------------------------------------------- fake Google (one spreadsheet, one tab per source)
const tabs = new Map<number, string[][]>();
const fetchFn = ((input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  const r = (s: number, b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: s }));
  if (url.includes("oauth2.googleapis.com/tokeninfo")) return r(200, { aud: CFG.clientId, scope: "openid email https://www.googleapis.com/auth/drive.file", expires_in: 3599 });
  if (url.includes("oauth2.googleapis.com/token")) return r(200, { access_token: "ya29.e2e", expires_in: 3599 });
  if (url.includes("/drive/v3/files/")) return r(200, { id: SPREADSHEET, name: "E2E", mimeType: "application/vnd.google-apps.spreadsheet", trashed: false });
  const values = url.match(/\/values\/([^?]+)/);
  if (values) {
    const id = Number(decodeURIComponent(values[1]).match(/^'Tab(\d+)'!/)?.[1]);
    return r(200, { values: [HEADER, ...(tabs.get(id) ?? [])] });
  }
  if (url.includes("sheets.googleapis.com/v4/spreadsheets/")) {
    return r(200, { properties: { title: "E2E" }, sheets: [...tabs.keys()].map((id, i) => ({ properties: { sheetId: id, title: `Tab${id}`, index: i, gridProperties: { rowCount: 1000, columnCount: 5 } } })) });
  }
  return r(404, {});
}) as typeof fetch;
const c: A.Ctx = { svc: svc as never, cfg: CFG, fetchFn, userId: USER, orgId: ORG };

// ---------------------------------------------------------------- helpers
let checks = 0;
function ok(cond: unknown, msg: string): void {
  if (!cond) { console.error(`   FAIL: ${msg}`); Deno.exit(1); }
  checks++;
}
const row = (id: string, first: string, last: string, phone: string) => [id, first, last, phone, ""];
async function q(table: string, filter: string) {
  return (await fetch(`${base}/${table}?${filter}`, { headers: { Authorization: `Bearer ${SERVICE}` } })).json();
}
async function source(id: string) { return (await q("google_sheets_sources", `id=eq.${id}`))[0]; }
async function leads(first: string) {
  return (await q("leads", `organization_id=eq.${ORG}&first_name=eq.${encodeURIComponent(first)}`)).length as number;
}
async function addSource(sheet: number, rows: string[][]) {
  tabs.set(sheet, rows);
  const saved = await A.save(c, { payload: { spreadsheet_id: SPREADSHEET, sheet_id: sheet, spreadsheet_name: "E2E", sheet_title: `Tab${sheet}`,
    display_name: `E2E ${sheet}`, mapping: ID_MAPPING, identity_mode: "source_id", id_header: "Lead ID", lead_source_default: "Google Sheets",
    include_existing: false } });
  await A.activate(c, { source_id: saved.source_id, expected_version: saved.config_version });
  return saved.source_id as string;
}
async function sync(src: string) {
  await svc.patch("google_sheets_sources", `id=eq.${src}`, { last_checked_at: null });   // test only: skip the 30 s Sync-now cooldown
  return await A.syncNow(c, { source_id: src });
}
async function preview(src: string) {
  const s = await source(src);
  return await A.identityReviewPreview(c, { source_id: src, expected_version: s.config_version }) as Record<string, any>;
}
async function apply(src: string, snapshot: string, decisions: Record<string, string>) {
  const s = await source(src);
  return await A.identityReviewApply(c, { source_id: src, expected_version: s.config_version, snapshot, decisions });
}
async function refused(p: Promise<unknown>): Promise<string> {
  try { await p; return "applied"; } catch (e) { return e instanceof DbError || e instanceof A.ActionError ? (e instanceof A.ActionError ? e.code : e.message) : String(e); }
}
async function reconnect() {
  const conn = (await q("google_sheets_connections", `user_id=eq.${USER}`))[0];
  const r = await svc.rpc("google_sheets_store_connection", { p_user: USER, p_org: ORG, p_expected_generation: conn?.auth_generation ?? 0,
    p_google_sub: "sub-e2e", p_google_email: "e2e@example.test", p_scopes: ["openid", "email", "https://www.googleapis.com/auth/drive.file"],
    p_refresh_token: "rt-e2e" });
  ok(r.data?.[0]?.outcome === "connected", `connect fixture: ${JSON.stringify(r)}`);
}
const keys = (p: Record<string, any>) => (p.rows as { key: string }[]).map((r) => r.key);
const hint = (p: Record<string, any>, k: string) => (p.rows as { key: string; hint: string | null }[]).find((r) => r.key === k)?.hint;

// ---------------------------------------------------------------- fixtures
await reconnect();

const ANN = ["Ann", "Lee", "5550001111"], BO = ["Bo", "Diaz", "5550002222"];

console.log("   scenario 1: exact sorted blank-ID repro → Keep excluded");
{
  const src = await addSource(11, [row("", ...ANN), row("B1", ...BO)]);
  ok((await sync(src)).imported === 0, "baseline rows are not imported");
  tabs.set(11, [row("B1", ...BO), row("NEWID", ...ANN)]);
  const out = await sync(src);
  ok(out.status === "needs_review" && out.imported === 0 && (await leads("Ann")) === 0, `sorted + completed → review, nothing imported (${out.status})`);
  ok((await source(src)).review_reason === "identity_ambiguous", "review reason");
  const p = await preview(src);
  ok(JSON.stringify(keys(p)) === JSON.stringify(["id:NEWID"]) && hint(p, "id:NEWID") === "content", `decision rows ${JSON.stringify(p.rows)}`);
  ok(JSON.stringify(p.unresolved_rows) === "[2]" && p.established === 1, "unresolved row + established ID");
  await apply(src, p.snapshot, { "id:NEWID": "exclude" });
  const after = await sync(src);
  ok(after.status === "ok" && (await leads("Ann")) === 0 && (await source(src)).health === "ok", "kept excluded; next sync healthy");
  ok((await sync(src)).imported === 0 && (await leads("Ann")) === 0, "still excluded on later syncs");
}

console.log("   scenario 1b: same repro → explicit Import, imported once, never replayed");
{
  const src = await addSource(12, [row("", "Ivy", "Lee", "5550003333"), row("B2", ...BO)]);
  await sync(src);
  tabs.set(12, [row("B2", ...BO), row("IVY1", "Ivy", "Lee", "5550003333")]);
  ok((await sync(src)).status === "needs_review", "review");
  const p = await preview(src);
  await apply(src, p.snapshot, { "id:IVY1": "import" });
  const out = await sync(src);
  ok(out.imported === 1 && (await leads("Ivy")) === 1, `explicit import imports once (${JSON.stringify(out)})`);
  ok((await sync(src)).imported === 0 && (await leads("Ivy")) === 1, "receipt prevents replay");
}

console.log("   scenario 2: excluded row edited, moved, then given an ID → review (no content/position match needed)");
{
  const src = await addSource(13, [row("", "Cara", "Ng", "5550004444"), row("B3", ...BO)]);
  await sync(src);
  tabs.set(13, [row("B3", ...BO), row("CN1", "Carina", "Ng", "5550004444")]);
  const out = await sync(src);
  ok(out.status === "needs_review" && (await leads("Carina")) === 0, "edited + moved + completed is NOT imported automatically");
  const p = await preview(src);
  ok(JSON.stringify(keys(p)) === JSON.stringify(["id:CN1"]) && hint(p, "id:CN1") === null, `no hint, still a decision: ${JSON.stringify(p.rows)}`);
  await apply(src, p.snapshot, { "id:CN1": "exclude" });
  ok((await sync(src)).status === "ok" && (await leads("Carina")) === 0, "explicit Keep excluded honoured");
}

console.log("   scenario 3: several excluded blank-ID rows (moved, completed, deleted, still in place) + a new row");
{
  const src = await addSource(14, [row("", "Abe", "One", "5550010001"), row("", "Cy", "Two", "5550010002"), row("C1", "Cal", "Three", "5550010003"),
                                   row("", "Di", "Four", "5550010004"), row("", "Ed", "Five", "5550010005")]);
  await sync(src);
  tabs.set(14, [row("", "Di", "Four", "5550010004"), row("", "Cy", "Two", "5550010002"), row("C1", "Cal", "Three", "5550010003"),
                row("A7", "Abe", "One", "5550010001"), row("N1", "Nia", "Six", "5550010006")]);
  ok((await sync(src)).status === "needs_review" && (await leads("Nia")) === 0, "nothing imported while ambiguous (the new row waits too)");
  const p = await preview(src);
  ok(JSON.stringify(keys(p)) === JSON.stringify(["noid:2", "id:A7", "id:N1"]), `decision rows ${JSON.stringify(keys(p))}`);
  ok(hint(p, "noid:2") === "content" && hint(p, "id:A7") === "content" && hint(p, "id:N1") === "position", "hints");
  ok(p.kept === 1 && JSON.stringify(p.unresolved_rows) === "[2,5,6]", `Cy kept in place; unresolved ${JSON.stringify(p.unresolved_rows)}`);
  await apply(src, p.snapshot, { "noid:2": "exclude", "id:A7": "exclude", "id:N1": "import" });
  const out = await sync(src);
  ok(out.status === "ok" && out.imported === 1 && (await leads("Nia")) === 1 && (await leads("Abe")) === 0 && (await leads("Di")) === 0,
     `only the new row imported (${JSON.stringify(out)})`);
  ok((await sync(src)).status === "ok", "no further review: every exclusion is anchored again");
  // a later ambiguity never offers established rows (receipt N1, ID baselines C1/A7)
  tabs.set(14, [row("", "Cy", "Two", "5550010002"), row("", "Di", "Four", "5550010004"), row("C1", "Cal", "Three", "5550010003"),
                row("A7", "Abe", "One", "5550010001"), row("N1", "Nia", "Six", "5550010006"), row("Z9", "Zoe", "Nine", "5550010009")]);
  ok((await sync(src)).status === "needs_review", "moved exclusions + a new ID → review again");
  const p2 = await preview(src);
  ok(!keys(p2).some((k) => ["id:C1", "id:A7", "id:N1"].includes(k)) && keys(p2).includes("id:Z9"), `established never offered: ${JSON.stringify(keys(p2))}`);
}

console.log("   scenario 4: genuinely new identical-looking row next to its excluded twin → review → Import");
{
  const src = await addSource(15, [row("", "Gus", "Twin", "5550020001"), row("B5", ...BO)]);
  await sync(src);
  tabs.set(15, [row("", "Gus", "Twin", "5550020001"), row("B5", ...BO), row("N9", "Gus", "Twin", "5550020001")]);
  ok((await sync(src)).status === "needs_review" && (await leads("Gus")) === 0, "content alone cannot tell the twin apart → review");
  const p = await preview(src);
  ok(JSON.stringify(keys(p)) === JSON.stringify(["noid:2", "id:N9"]) && hint(p, "noid:2") === "same_row" && hint(p, "id:N9") === "content", `rows ${JSON.stringify(p.rows)}`);
  await apply(src, p.snapshot, { "noid:2": "exclude", "id:N9": "import" });
  ok((await sync(src)).imported === 1 && (await leads("Gus")) === 1, "the new look-alike imported once");
  ok((await sync(src)).status === "ok" && (await leads("Gus")) === 1, "no replay, no new review");
}

console.log("   scenario 5: a row arriving, then a row changing, between preview and apply → refreshed preview required");
{
  const src = await addSource(16, [row("", "Hal", "Late", "5550030001"), row("B6", ...BO)]);
  await sync(src);
  tabs.set(16, [row("B6", ...BO), row("H1", "Hal", "Late", "5550030001")]);
  await sync(src);
  const p = await preview(src);
  const before = await source(src);
  tabs.set(16, [row("B6", ...BO), row("H1", "Hal", "Late", "5550030001"), row("Q1", "Quin", "New", "5550030002")]);
  ok((await refused(apply(src, p.snapshot, { "id:H1": "exclude" }))) === "review_changed", "arrival → review_changed");
  const mid = await source(src);
  ok(mid.health === "needs_review" && mid.config_version === before.config_version, "refused apply changed nothing");
  const p2 = await preview(src);
  ok(JSON.stringify(keys(p2)) === JSON.stringify(["id:H1", "id:Q1"]), `refreshed preview includes the arrival: ${JSON.stringify(keys(p2))}`);
  tabs.set(16, [row("B6", ...BO), row("H1", "Hal", "Later", "5550030001"), row("Q1", "Quin", "New", "5550030002")]);
  ok((await refused(apply(src, p2.snapshot, { "id:H1": "exclude", "id:Q1": "import" }))) === "review_changed", "change → review_changed");
  const p3 = await preview(src);
  await apply(src, p3.snapshot, { "id:H1": "exclude", "id:Q1": "import" });
  const out = await sync(src);
  ok(out.imported === 1 && (await leads("Quin")) === 1 && (await leads("Hal")) === 0, "decisions applied only to the reviewed rows");
}

console.log("   scenario 6: reconnect between preview and apply → old snapshot refused, nothing changed");
{
  const src = await addSource(17, [row("", "Ike", "Gen", "5550040001"), row("B7", ...BO)]);
  await sync(src);
  tabs.set(17, [row("B7", ...BO), row("I1", "Ike", "Gen", "5550040001")]);
  await sync(src);
  const p = await preview(src);
  const before = await source(src);
  await reconnect();   // same Google account, new authorisation generation
  ok((await refused(apply(src, p.snapshot, { "id:I1": "import" }))) === "review_changed", "stale-generation snapshot refused");
  const after = await source(src);
  ok(after.health === "needs_review" && after.config_version === before.config_version && after.next_sync_at === before.next_sync_at, "nothing changed");
  const p2 = await preview(src);
  await apply(src, p2.snapshot, { "id:I1": "exclude" });
  ok((await sync(src)).status === "ok" && (await leads("Ike")) === 0, "a fresh review under the new generation applies");
}

console.log("   scenario 7: structural review (no Lead ID): explicit choices for content-matched and unmatched rows");
{
  tabs.set(18, [["", "Al", "Pos", "5550050001", ""], ["", "Be", "Pos", "5550050002", ""]]);
  const saved = await A.save(c, { payload: { spreadsheet_id: SPREADSHEET, sheet_id: 18, spreadsheet_name: "E2E", sheet_title: "Tab18",
    display_name: "E2E 18", mapping: ID_MAPPING, identity_mode: "row_position", id_header: null, lead_source_default: "Google Sheets", include_existing: false } });
  await A.activate(c, { source_id: saved.source_id, expected_version: saved.config_version });
  const src = saved.source_id as string;
  tabs.set(18, [["", "Al", "Pos", "5550050001", ""], ["", "Be", "Pos", "5550050002", ""], ["", "Cy", "Pos", "5550050003", ""]]);
  ok((await sync(src)).imported === 1, "appended row imported");
  tabs.set(18, [["", "Xi", "Top", "5550050009", ""], ["", "Al", "Pos", "5550050001", ""], ["", "Be", "Pos", "5550050002", ""], ["", "Cy", "Pos", "5550050003", ""]]);
  ok((await sync(src)).status === "needs_review" && (await source(src)).review_reason === "rows_changed", "insert above → review");
  const s = await source(src);
  const body = { source_id: src, expected_version: s.config_version, identity_mode: "row_position", id_header: null, mapping: ID_MAPPING };
  const r = await A.review(c, body, true) as Record<string, any>;
  ok(r.established === 0 && r.matched === 3 && r.unknown === 1, `counts ${JSON.stringify(r)}`);
  ok((await refused(A.review(c, { ...body, import_unknown: true, snapshot: r.snapshot }, false))) === "invalid_argument", "a choice for content-matched rows is required");
  await A.review(c, { ...body, import_matched: false, import_unknown: true, snapshot: r.snapshot }, false);
  const out = await sync(src);
  ok(out.imported === 1 && (await leads("Xi")) === 1 && (await leads("Cy")) === 1, `only the unmatched row imported (${JSON.stringify(out)})`);
}

console.log(`   OK (${checks} end-to-end checks)`);
