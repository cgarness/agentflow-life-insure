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

// ---------------------------------------------------------------- mapping v2: several users, two agencies (M1 + M2 applied)
console.log("   scenario 8: mapping v2 — standard address fields, typed values, stored = preview, mixed v1/v2, edits, isolation");
{
  const ORG_B = "a0000000-0000-0000-0000-0000000000e3", USER2 = "e2000000-0000-0000-0000-000000000002", USER_B = "e3000000-0000-0000-0000-000000000001";
  const insert = async (table: string, rows: unknown) => {
    const res = await fetch(`${base}/${table}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}`,
      Prefer: "return=representation" }, body: JSON.stringify(rows) });
    ok(res.ok, `insert ${table}: ${res.status} ${await res.clone().text()}`);
    return await res.json();
  };
  await insert("organizations", [{ id: ORG_B, name: "E2E Org B", status: "active" }]);   // seeded by the M2 trigger
  await insert("profiles", [{ id: USER2, organization_id: ORG, role: "Agent", status: "Active" },
                            { id: USER_B, organization_id: ORG_B, role: "Agent", status: "Active" }]);
  const [amt] = await insert("custom_fields", [{ organization_id: ORG, name: "Amt Requested", type: "Number", applies_to: ["Leads"], created_by: USER }]);
  const [recv] = await insert("custom_fields", [{ organization_id: ORG, name: "Received", type: "Date", applies_to: ["Leads"], created_by: USER2 }]);

  const V2HEADER = ["First", "Last", "Phone", "Address", "City", "Zip", "Amt Requested", "Notes"];
  const v2tabs = new Map<number, string[][]>();
  const v2fetch = ((input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const r = (st: number, b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: st }));
    if (url.includes("oauth2.googleapis.com/token")) return r(200, { access_token: "ya29.e2e", expires_in: 3599 });
    if (url.includes("/drive/v3/files/")) return r(200, { id: "SPREADSHEET_E2E_V2", name: "E2E V2", mimeType: "application/vnd.google-apps.spreadsheet", trashed: false });
    const values = url.match(/\/values\/([^?]+)/);
    if (values) {
      const id = Number(decodeURIComponent(values[1]).match(/^'V(\d+)'!/)?.[1]);
      const t = v2tabs.get(id) ?? [V2HEADER];
      return r(200, { values: t });
    }
    if (url.includes("sheets.googleapis.com/v4/spreadsheets/")) {
      return r(200, { properties: { title: "E2E V2", locale: "en_US" }, sheets: [...v2tabs.keys()].map((id, i) => ({ properties: { sheetId: id,
        title: `V${id}`, index: i, gridProperties: { rowCount: 1000, columnCount: 9 } } })) });
    }
    return r(404, {});
  }) as typeof fetch;
  const ctxFor = (userId: string, orgId: string): A.Ctx => ({ svc: svc as never, cfg: CFG, fetchFn: v2fetch, userId, orgId });
  const cA = ctxFor(USER, ORG), cA2 = ctxFor(USER2, ORG), cB = ctxFor(USER_B, ORG_B);
  const sameObj = (x: unknown, y: Record<string, string>) =>   // jsonb reorders object keys: compare as sorted entries
    JSON.stringify(Object.entries((x ?? {}) as Record<string, string>).sort()) === JSON.stringify(Object.entries(y).sort());
  for (const [ctx, sub] of [[cA2, "sub-v2-a2"], [cB, "sub-v2-b"]] as [A.Ctx, string][]) {   // the owner (USER) is already connected
    const r = await svc.rpc("google_sheets_store_connection", { p_user: ctx.userId, p_org: ctx.orgId, p_expected_generation: 0,
      p_google_sub: sub, p_google_email: `${sub}@example.test`, p_scopes: ["openid", "email", "https://www.googleapis.com/auth/drive.file"],
      p_refresh_token: `rt-${sub}` });
    ok(r.data?.[0]?.outcome === "connected", `connect ${sub}: ${JSON.stringify(r)}`);
  }

  // Catalog per user: agency standard fields for everyone in the agency; personal fields only for their owner.
  const catA = await A.context(cA) as Record<string, any>, catA2 = await A.context(cA2) as Record<string, any>, catB = await A.context(cB) as Record<string, any>;
  const names = (cat: Record<string, any>) => cat.custom_fields.map((f: { name: string }) => f.name).sort().join(",");
  ok(JSON.stringify(catA.mapping_versions) === "[1,2]" && catA.catalog_version === 2, "typed catalog advertised");
  ok(names(catA) === "Address,Amt Requested,City,ZIP Code", `owner A catalog: ${names(catA)}`);
  ok(names(catA2) === "Address,City,Received,ZIP Code", `same-agency agent: own personal only: ${names(catA2)}`);
  ok(names(catB) === "Address,City,ZIP Code", `agency B: its own standard fields only: ${names(catB)}`);
  const idOf = (cat: Record<string, any>, n: string) => cat.custom_fields.find((f: { name: string }) => f.name === n).id as string;
  ok(idOf(catB, "City") !== idOf(catA, "City"), "agencies have distinct standard field ids");

  const v2map = { v: 2, columns: [{ header: "First", target: "first_name" }, { header: "Last", target: "last_name" }, { header: "Phone", target: "phone" },
    { header: "Address", target: `custom:${idOf(catA, "Address")}` }, { header: "City", target: `custom:${idOf(catA, "City")}` },
    { header: "Zip", target: `custom:${idOf(catA, "ZIP Code")}` }, { header: "Amt Requested", target: `custom:${amt.id}` }], ignored: ["Notes"] };
  const ROWS = [["Vic", "Lee", "5550061001", "1 Main St", "Austin", "02134", "$1,234.50", "note"], ["Val", "Ray", "5550061002", "", "Waco", "73301-1234", "007", ""]];
  v2tabs.set(1, [V2HEADER, ...ROWS]);

  // Preview → activate (include existing) → sync; every stored value equals what the preview showed.
  const pv = await A.preview(cA, { spreadsheet_id: "SPREADSHEET_E2E_V2", sheet_id: 1, mapping: v2map, identity_mode: "row_position", lead_source_default: "Sheets V2" }) as Record<string, any>;
  ok(pv.mapping_version === 2 && JSON.stringify(pv.unaccounted_headers) === "[]" && pv.locale === "en_US", "preview: v2, everything accounted for");
  const saved = await A.save(cA, { payload: { spreadsheet_id: "SPREADSHEET_E2E_V2", sheet_id: 1, spreadsheet_name: "E2E V2", sheet_title: "V1",
    display_name: "V2 tab", mapping: v2map, identity_mode: "row_position", id_header: null, lead_source_default: "Sheets V2", include_existing: true } });
  await A.activate(cA, { source_id: saved.source_id, expected_version: saved.config_version });
  const v2src = saved.source_id as string;
  await svc.patch("google_sheets_sources", `id=eq.${v2src}`, { last_checked_at: null });
  const run1 = await A.syncNow(cA, { source_id: v2src });
  ok(run1.status === "ok" && run1.imported === 2, `v2 import: ${JSON.stringify(run1)}`);
  for (const prow of pv.rows as { first_name: string; fields: { target: string; value: string }[] }[]) {
    const [lead] = await q("leads", `organization_id=eq.${ORG}&first_name=eq.${prow.first_name}`);
    ok(lead.assigned_agent_id === USER && lead.user_id === USER, `${prow.first_name}: assigned to the connected agent`);
    for (const f of prow.fields) {
      const stored = f.target === "lead_source" ? lead.lead_source : f.target === "email" ? lead.email : f.target === "state" ? lead.state
        : lead.custom_fields?.[catA.custom_fields.find((x: { id: string }) => `custom:${x.id}` === f.target)?.name ?? "Amt Requested"];
      ok(stored === f.value, `${prow.first_name} ${f.target}: stored ${JSON.stringify(stored)} = preview ${JSON.stringify(f.value)}`);
    }
  }
  const vic = (await q("leads", `organization_id=eq.${ORG}&first_name=eq.Vic`))[0];
  ok(sameObj(vic.custom_fields, { "Address": "1 Main St", "City": "Austin", "ZIP Code": "02134", "Amt Requested": "1234.50" }),
    `Vic stored: ${JSON.stringify(vic.custom_fields)}`);
  const val = (await q("leads", `organization_id=eq.${ORG}&first_name=eq.Val`))[0];
  ok(sameObj(val.custom_fields, { "City": "Waco", "ZIP Code": "73301-1234", "Amt Requested": "007" }), "leading zeros and ZIP+4 exact");
  await svc.patch("google_sheets_sources", `id=eq.${v2src}`, { last_checked_at: null });
  const run2 = await A.syncNow(cA, { source_id: v2src });
  ok(run2.imported === 0 && (await leads("Vic")) === 1, "re-run imports nothing (receipts)");

  // Mixed: an existing v1 source on the same connection keeps raw values; then the owner edits it to v2 with Address/City/ZIP.
  v2tabs.set(2, [V2HEADER, ["Wes", "Kim", "5550062001", "9 Elm", "Plano", "07001", "$5,000", ""]]);
  const v1map = { v: 1, columns: [{ header: "First", target: "first_name" }, { header: "Last", target: "last_name" }, { header: "Phone", target: "phone" },
    { header: "Amt Requested", target: `custom:${amt.id}` }] };
  const s1 = await A.save(cA, { payload: { spreadsheet_id: "SPREADSHEET_E2E_V2", sheet_id: 2, spreadsheet_name: "E2E V2", sheet_title: "V2",
    display_name: "V1 tab", mapping: v1map, identity_mode: "row_position", id_header: null, lead_source_default: "Sheets", include_existing: true } });
  await A.activate(cA, { source_id: s1.source_id, expected_version: s1.config_version });
  await svc.patch("google_sheets_sources", `id=eq.${s1.source_id}`, { last_checked_at: null });
  ok((await A.syncNow(cA, { source_id: s1.source_id })).imported === 1, "v1 source imports");
  const wes = (await q("leads", `organization_id=eq.${ORG}&first_name=eq.Wes`))[0];
  ok(sameObj(wes.custom_fields, { "Amt Requested": "$5,000" }), `v1 stays raw: ${JSON.stringify(wes.custom_fields)}`);
  const cur = await source(s1.source_id);
  const edited = { ...v2map, ignored: ["Notes"] };
  await A.save(cA, { source_id: s1.source_id, expected_version: cur.config_version, payload: { spreadsheet_id: "SPREADSHEET_E2E_V2", sheet_id: 2,
    spreadsheet_name: "E2E V2", sheet_title: "V2", display_name: "V1 tab", mapping: edited, identity_mode: "row_position", id_header: null,
    lead_source_default: "Sheets" } });
  v2tabs.set(2, [V2HEADER, ["Wes", "Kim", "5550062001", "9 Elm", "Plano", "07001", "$5,000", ""], ["Xia", "Ng", "5550062002", "4 Oak", "Allen", "75002", "$1,000", ""]]);
  await svc.patch("google_sheets_sources", `id=eq.${s1.source_id}`, { last_checked_at: null });
  const run3 = await A.syncNow(cA, { source_id: s1.source_id });
  ok(run3.imported === 1 && (await leads("Wes")) === 1 && (await leads("Xia")) === 1, `edit → only the new row imports: ${JSON.stringify(run3)}`);
  ok(sameObj((await q("leads", `organization_id=eq.${ORG}&first_name=eq.Wes`))[0].custom_fields, { "Amt Requested": "$5,000" }),
    "an already-imported lead is never rewritten (no automatic backfill)");
  ok(sameObj((await q("leads", `organization_id=eq.${ORG}&first_name=eq.Xia`))[0].custom_fields,
    { "Address": "4 Oak", "City": "Allen", "ZIP Code": "75002", "Amt Requested": "1000" }), "the new row carries the address fields");

  // A column added after the preview stops a v2 draft's activation; nothing is written.
  v2tabs.set(3, [V2HEADER, ROWS[0]]);
  const d3 = await A.save(cA, { payload: { spreadsheet_id: "SPREADSHEET_E2E_V2", sheet_id: 3, spreadsheet_name: "E2E V2", sheet_title: "V3",
    display_name: "V3", mapping: v2map, identity_mode: "row_position", id_header: null, lead_source_default: "Sheets", include_existing: false } });
  v2tabs.set(3, [[...V2HEADER, "Spouse"], [...ROWS[0], "x"]]);
  ok((await refused(A.activate(cA, { source_id: d3.source_id, expected_version: d3.config_version }))) === "unacknowledged_columns", "new column blocks activation");
  ok((await source(d3.source_id)).state === "draft", "the draft stays a draft");

  // Isolation: another agent cannot import into the owner's personal field; agency B cannot use agency A's fields.
  v2tabs.set(4, [V2HEADER, ROWS[0]]);
  ok((await refused(A.preview(cA2, { spreadsheet_id: "SPREADSHEET_E2E_V2", sheet_id: 4, mapping: v2map, identity_mode: "row_position" })))
    === "custom_field_unavailable", "same-agency agent: another user's personal field is unavailable");
  ok((await refused(A.preview(cB, { spreadsheet_id: "SPREADSHEET_E2E_V2", sheet_id: 4, mapping: v2map, identity_mode: "row_position" })))
    === "custom_field_unavailable", "other agency: agency A's fields are unavailable");
  const mapA2 = { ...v2map, columns: v2map.columns.filter((x) => x.target !== `custom:${amt.id}`), ignored: ["Notes", "Amt Requested"] };
  const pa2 = await A.preview(cA2, { spreadsheet_id: "SPREADSHEET_E2E_V2", sheet_id: 4, mapping: mapA2, identity_mode: "row_position" }) as Record<string, any>;
  ok(pa2.rows[0].fields.some((f: { target: string; value: string }) => f.value === "Austin"), "same-agency agent maps the shared agency City");

  // Two owners in two agencies sync at the same time: each gets exactly its own leads.
  const mapB = { v: 2, columns: [{ header: "First", target: "first_name" }, { header: "Last", target: "last_name" }, { header: "Phone", target: "phone" },
    { header: "City", target: `custom:${idOf(catB, "City")}` }], ignored: ["Address", "Zip", "Amt Requested", "Notes"] };
  v2tabs.set(5, [V2HEADER, ["Yan", "Bee", "5550063001", "", "Frisco", "", "", ""]]);
  v2tabs.set(6, [V2HEADER, ["Zed", "Ace", "5550063002", "", "Irving", "", "", ""]]);
  const sB = await A.save(cB, { payload: { spreadsheet_id: "SPREADSHEET_E2E_V2", sheet_id: 5, spreadsheet_name: "E2E V2", sheet_title: "V5",
    display_name: "B", mapping: mapB, identity_mode: "row_position", id_header: null, lead_source_default: "Sheets", include_existing: true } });
  await A.activate(cB, { source_id: sB.source_id, expected_version: sB.config_version });
  const sA6 = await A.save(cA, { payload: { spreadsheet_id: "SPREADSHEET_E2E_V2", sheet_id: 6, spreadsheet_name: "E2E V2", sheet_title: "V6",
    display_name: "A6", mapping: { ...mapB, columns: [...mapB.columns.slice(0, 3), { header: "City", target: `custom:${idOf(catA, "City")}` }] },
    identity_mode: "row_position", id_header: null, lead_source_default: "Sheets", include_existing: true } });
  await A.activate(cA, { source_id: sA6.source_id, expected_version: sA6.config_version });
  const [rb, ra] = await Promise.all([A.syncNow(cB, { source_id: sB.source_id }), A.syncNow(cA, { source_id: sA6.source_id })]);
  ok(rb.imported === 1 && ra.imported === 1, `concurrent owners: ${JSON.stringify([rb, ra])}`);
  const yan = (await q("leads", `first_name=eq.Yan`)), zed = (await q("leads", `first_name=eq.Zed`));
  ok(yan.length === 1 && yan[0].organization_id === ORG_B && yan[0].assigned_agent_id === USER_B && yan[0].custom_fields.City === "Frisco", "agency B lead");
  ok(zed.length === 1 && zed[0].organization_id === ORG && zed[0].assigned_agent_id === USER && zed[0].custom_fields.City === "Irving", "agency A lead");
  ok(recv.id && (await leads("Vic")) === 1, "no duplicates anywhere");

  // ---------------------------------------------------------------- correction C
  console.log("   scenario 9: v2 writes re-read the sheet; content past GR needs an exact acknowledgement; no duplicates, no receipt changes");
  // A range-aware fake: A1:GR row reads, GS1:… column-major reads, each tab with its own grid width (Google trims empties).
  const wtabs = new Map<number, { width: number; cells: string[][] }>();
  const colNum = (l: string) => [...l].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  const trimEnd = (xs: string[]) => { const out = [...xs]; while (out.length && !out[out.length - 1]) out.pop(); return out; };
  const scans: string[] = [];
  const wfetch = ((input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const r = (st: number, b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: st }));
    if (url.includes("oauth2.googleapis.com/token")) return r(200, { access_token: "ya29.e2e", expires_in: 3599 });
    if (url.includes("/drive/v3/files/")) return r(200, { id: "SPREADSHEET_E2E_W", name: "E2E W", mimeType: "application/vnd.google-apps.spreadsheet", trashed: false });
    const values = url.match(/\/values\/([^?]+)/);
    if (values) {
      const m = decodeURIComponent(values[1]).match(/^'W(\d+)'!([A-Z]+)1:([A-Z]+)(\d+)$/)!;
      const t = wtabs.get(Number(m[1]))!;
      const from = colNum(m[2]) - 1, to = Math.min(colNum(m[3]), t.width);
      if (url.includes("majorDimension=COLUMNS")) {
        scans.push(`${m[2]}:${m[3]}`);
        const cols = Array.from({ length: Math.max(0, to - from) }, (_, i) => trimEnd(t.cells.map((row) => row[from + i] ?? "")));
        while (cols.length && !cols[cols.length - 1].length) cols.pop();
        return r(200, cols.length ? { majorDimension: "COLUMNS", values: cols } : {});
      }
      return r(200, { values: t.cells.map((row) => trimEnd(row.slice(from, to))) });
    }
    if (url.includes("sheets.googleapis.com/v4/spreadsheets/")) {
      return r(200, { properties: { title: "E2E W", locale: "en_US" }, sheets: [...wtabs.keys()].map((id, i) => ({ properties: { sheetId: id,
        title: `W${id}`, index: i, gridProperties: { rowCount: 1000, columnCount: wtabs.get(id)!.width } } })) });
    }
    return r(404, {});
  }) as typeof fetch;
  const cW: A.Ctx = { svc: svc as never, cfg: CFG, fetchFn: wfetch, userId: USER, orgId: ORG };
  const W = (id: number, extra: Record<string, unknown> = {}) => ({ spreadsheet_id: "SPREADSHEET_E2E_W", sheet_id: id, identity_mode: "row_position",
    lead_source_default: "Sheets W", ...extra });
  const payload = (id: number, mapping: unknown, include = true) => ({ ...W(id), spreadsheet_name: "E2E W", sheet_title: `W${id}`, display_name: `W${id}`,
    mapping, id_header: null, include_existing: include });
  const imported = async (id: number, mapping: unknown) => ((await A.preview(cW, W(id, { mapping }))) as Record<string, any>).imported_before as number;

  // 9a. An ACTIVE v2 source: a mapping edit against a sheet that changed after the preview is refused; nothing changes.
  wtabs.set(1, { width: 8, cells: [V2HEADER, ["Ames", "Orr", "5550091001", "2 Pine", "Tyler", "01002", "$10", ""], ["Ada", "Orr", "5550091002", "", "Katy", "", "", ""]] });
  const sw1 = await A.save(cW, { payload: payload(1, v2map) });
  await A.activate(cW, { source_id: sw1.source_id, expected_version: sw1.config_version });
  await svc.patch("google_sheets_sources", `id=eq.${sw1.source_id}`, { last_checked_at: null });
  ok((await A.syncNow(cW, { source_id: sw1.source_id })).imported === 2, "9a: active v2 source imported its rows");
  const before = await source(sw1.source_id);
  const receiptsBefore = await imported(1, v2map);
  ok(receiptsBefore === 2, `9a: two receipts (${receiptsBefore})`);
  const editedMap = { ...v2map, columns: v2map.columns.filter((x) => x.header !== "Address"), ignored: ["Notes", "Address"] };
  const pe = await A.preview(cW, W(1, { mapping: editedMap })) as Record<string, any>;
  ok(JSON.stringify(pe.unaccounted_headers) === "[]" && pe.not_importable.signature === null, "9a: the owner previews the edit");
  wtabs.get(1)!.cells = [[...V2HEADER, "Spouse"], ...wtabs.get(1)!.cells.slice(1).map((x) => [...x, ""]), ["Ali", "Orr", "5550091003", "", "Waco", "", "", "", "Lu"]];
  wtabs.get(1)!.width = 9;
  const editPayload = (mapping: unknown, ver: number) => ({ source_id: sw1.source_id, expected_version: ver, payload: payload(1, mapping) });
  ok((await refused(A.save(cW, editPayload(editedMap, before.config_version)))) === "unacknowledged_columns", "9a: a column added after the preview is refused");
  wtabs.get(1)!.cells[0][5] = "Postal";   // and a mapped header renamed
  ok((await refused(A.save(cW, editPayload({ ...editedMap, ignored: [...editedMap.ignored, "Spouse"] }, before.config_version)))) === "header:missing:Zip",
    "9a: a mapped header that disappeared is refused");
  const after = await source(sw1.source_id);
  ok(JSON.stringify(after.mapping) === JSON.stringify(before.mapping) && after.config_version === before.config_version, "9a: mapping and version unchanged");
  wtabs.get(1)!.cells[0][5] = "Zip";
  ok((await imported(1, v2map)) === receiptsBefore, "9a: receipts unchanged by the refusals");
  await svc.patch("google_sheets_sources", `id=eq.${sw1.source_id}`, { last_checked_at: null });
  const r9a = await A.syncNow(cW, { source_id: sw1.source_id });
  ok(r9a.imported === 1 && (await leads("Ames")) === 1 && (await leads("Ada")) === 1 && (await leads("Ali")) === 1,
    `9a: the running source keeps syncing with its stored mapping; only the new row imports: ${JSON.stringify(r9a)}`);
  const fixed = { ...editedMap, ignored: [...editedMap.ignored, "Spouse"] };
  const ok9 = await A.save(cW, editPayload(fixed, before.config_version)) as Record<string, any>;
  ok(ok9.config_version === before.config_version + 1, "9a: the corrected edit (new column acknowledged) is saved");
  await svc.patch("google_sheets_sources", `id=eq.${sw1.source_id}`, { last_checked_at: null });
  ok((await A.syncNow(cW, { source_id: sw1.source_id })).imported === 0 && (await leads("Ames")) === 1, "9a: no re-import after the edit");
  ok(sameObj((await q("leads", `organization_id=eq.${ORG}&first_name=eq.Ames`))[0].custom_fields,
    { "Address": "2 Pine", "City": "Tyler", "ZIP Code": "01002", "Amt Requested": "10" }), "9a: an imported lead is never rewritten by an edit");

  // 9b. 260 columns: a headerless column with data (GS) and a header (GT) past GR. Exact acknowledgement for save AND activate.
  const filler = (n: number) => Array.from({ length: n }, () => "");
  const wide = (rows: string[][]) => rows.map((x, i) => [...x, ...filler(200 - x.length), i === 0 ? "" : i === 2 ? "past-gr-secret" : "", i === 0 ? "Spouse" : "Kim"]);
  wtabs.set(2, { width: 260, cells: wide([V2HEADER, ["Bea", "Fox", "5550092001", "", "Plano", "", "", ""], ["Ben", "Fox", "5550092002", "", "Allen", "", "", ""]]) });
  const h2 = await A.headers(cW, { spreadsheet_id: "SPREADSHEET_E2E_W", sheet_id: 2 }) as Record<string, any>;
  ok(JSON.stringify(h2.beyond_limit) === JSON.stringify({ width: 260, checked_through: 260, columns: [{ letter: "GS", header: "", has_data: true },
    { letter: "GT", header: "Spouse", has_data: true }], unchecked: false }), `9b: headers report the real width and content past GR: ${JSON.stringify(h2.beyond_limit)}`);
  const p2 = await A.preview(cW, W(2, { mapping: v2map })) as Record<string, any>;
  ok(JSON.stringify(p2.not_importable.beyond.headers) === '["Spouse"]' && JSON.stringify(p2.not_importable.beyond.headerless) === '["GS"]'
    && /^[0-9a-f]{64}$/.test(p2.not_importable.signature), "9b: preview lists what can't be imported, with a token");
  ok(!JSON.stringify([h2, p2]).includes("past-gr-secret"), "9b: no cell value past GR is ever returned");
  const sources2 = async () => (await q("google_sheets_sources", `organization_id=eq.${ORG}&spreadsheet_id=eq.SPREADSHEET_E2E_W&sheet_id=eq.2`)).length as number;
  for (const bad of [undefined, "0".repeat(64)]) {
    ok((await refused(A.save(cW, { payload: payload(2, v2map), not_importable_ack: bad }))) === "unacknowledged_columns" && (await sources2()) === 0,
      `9b: save refused without the exact acknowledgement (${bad ? "wrong" : "none"}); nothing created`);
  }
  const sw2 = await A.save(cW, { payload: payload(2, v2map), not_importable_ack: p2.not_importable.signature }) as Record<string, any>;
  ok((await sources2()) === 1, "9b: saved with the acknowledgement");
  ok((await refused(A.activate(cW, { source_id: sw2.source_id, expected_version: sw2.config_version }))) === "unacknowledged_columns"
    && (await source(sw2.source_id)).state === "draft", "9b: activate also needs it; the draft stays a draft");
  await A.activate(cW, { source_id: sw2.source_id, expected_version: sw2.config_version, not_importable_ack: p2.not_importable.signature });
  await svc.patch("google_sheets_sources", `id=eq.${sw2.source_id}`, { last_checked_at: null });
  ok((await A.syncNow(cW, { source_id: sw2.source_id })).imported === 2, "9b: activated and imported A–GR");
  const bea = (await q("leads", `organization_id=eq.${ORG}&first_name=eq.Bea`))[0];
  ok(sameObj(bea.custom_fields, { "City": "Plano" }) && !JSON.stringify(await q("leads", `organization_id=eq.${ORG}`)).includes("past-gr-secret"),
    "9b: nothing past GR is stored");
  wtabs.get(2)!.cells[1][201] = "changed later";   // content past GR changes after activation: syncs never block
  await svc.patch("google_sheets_sources", `id=eq.${sw2.source_id}`, { last_checked_at: null });
  ok((await A.syncNow(cW, { source_id: sw2.source_id })).imported === 0 && (await leads("Bea")) === 1, "9b: no duplicates; sync unaffected");

  // 9c. Exactly 200 columns: no extra read, nothing to acknowledge. 450 columns: scanned to OJ, the rest reported unchecked.
  scans.length = 0;
  wtabs.set(3, { width: 200, cells: [[...V2HEADER, ...filler(192)], ["Cato", "Day", "5550093001", "", "", "", "", "", ...filler(192)]] });
  const p3 = await A.preview(cW, W(3, { mapping: v2map })) as Record<string, any>;
  ok(p3.not_importable.signature === null && p3.beyond_limit.width === 200 && scans.length === 0, "9c: 200 columns — no scan, nothing to acknowledge");
  wtabs.set(4, { width: 450, cells: [V2HEADER, ["Dee", "Day", "5550093002", "", "", "", "", ""]] });
  const p4 = await A.preview(cW, W(4, { mapping: v2map })) as Record<string, any>;
  ok(p4.beyond_limit.checked_through === 400 && p4.beyond_limit.unchecked === true && /^[0-9a-f]{64}$/.test(p4.not_importable.signature)
    && JSON.stringify(scans) === '["GS:OJ"]', `9c: 450 columns — bounded scan (${JSON.stringify(scans)}), the rest unchecked and acknowledged`);
}

console.log(`   OK (${checks} end-to-end checks)`);
