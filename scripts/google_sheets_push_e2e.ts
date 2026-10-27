// =====================================================================================================
// Google Sheets PUSH — END-TO-END harness (LOCAL ONLY; invoked by scripts/run_google_sheets_tests.sh §8).
// Runs the REAL google-sheets-push receiver, push processor, maintenance pass and google-sheets-api hooks against
// the candidate migrations through a local PostgREST (the production HTTP path). Only Google HTTP is faked: the
// fake records every files.watch / channels.stop call and serves the tab contents. Notifications are built from
// the channel id / token / resource id the fake was given — exactly what Google would echo back.
// Usage: deno run --allow-net=127.0.0.1 --allow-env --allow-read scripts/google_sheets_push_e2e.ts <postgrest-url> <jwt-secret>
// =====================================================================================================
import * as A from "../supabase/functions/google-sheets-api/actions.ts";
import { handle as receive, type ReceiverDeps } from "../supabase/functions/google-sheets-push/index.ts";
import { sheetsDb } from "../supabase/functions/_shared/googleSheets/db.ts";
import { pushDb } from "../supabase/functions/_shared/googleSheets/push/db.ts";
import { processTargets } from "../supabase/functions/_shared/googleSheets/push/processor.ts";
import { runMaintenance } from "../supabase/functions/_shared/googleSheets/push/watches.ts";
import { postgrestClient, signHs256 } from "./google_sheets_postgrest_client.ts";

const [base, secret] = Deno.args;
if (!base?.startsWith("http://127.0.0.1:")) throw new Error("REFUSING: local PostgREST only");
const SERVICE = await signHs256(secret, { role: "service_role" });
const svc = postgrestClient(base, SERVICE);
const ORG = "a0000000-0000-0000-0000-0000000000f2", USER = "f2000000-0000-0000-0000-000000000001";
const SPREADSHEET = "SPREADSHEET_E2E_PUSH";
const HEADER = ["First", "Last", "Phone"];
const MAPPING = { v: 1, columns: [{ header: "First", target: "first_name" }, { header: "Last", target: "last_name" }, { header: "Phone", target: "phone" }] };
const CFG = { enabled: true, clientId: "cid.e2e", clientSecret: "s", redirectUri: "https://x/cb", allowedOrigins: [],
  stateKey: "k".repeat(40), workerToken: "w".repeat(40) };
const PCFG = { enabled: true, key: "e2e-push-key-".padEnd(40, "p"), maintenanceToken: "m".repeat(40),
  address: "https://e2e.supabase.co/functions/v1/google-sheets-push" };

// ---------------------------------------------------------------- fake Google
const tabs = new Map<number, string[][]>();
const tabHeaders = new Map<number, string[]>();   // a tab with its own header (mapping v2 scenario)
const watches: { id: string; token: string; address: string; resourceId: string }[] = [];
const stops: string[] = [];
let watchTtlMs = 86_000_000; // the lifetime the fake grants a new channel (shortened once to exercise renewal)
const fetchFn = ((input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const r = (s: number, b: unknown) => Promise.resolve(new Response(b === null ? null : JSON.stringify(b), { status: s }));
  if (url.includes("oauth2.googleapis.com/token")) return r(200, { access_token: "ya29.e2e", expires_in: 3599 });
  if (url.includes(`/drive/v3/files/${SPREADSHEET}/watch`)) {
    const body = JSON.parse(String(init?.body));
    const w = { id: body.id, token: body.token, address: body.address, resourceId: `RES-${watches.length + 1}` };
    watches.push(w);
    return r(200, { kind: "api#channel", id: w.id, resourceId: w.resourceId, expiration: String(Date.now() + watchTtlMs) });
  }
  if (url.includes("/drive/v3/channels/stop")) { stops.push(JSON.parse(String(init?.body)).id); return r(204, null); }
  if (url.includes("/drive/v3/files/")) return r(200, { id: SPREADSHEET, name: "E2E", mimeType: "application/vnd.google-apps.spreadsheet", trashed: false });
  const values = url.match(/\/values\/([^?]+)/);
  if (values) {
    const id = Number(decodeURIComponent(values[1]).match(/^'Tab(\d+)'!/)?.[1]);
    return r(200, { values: [tabHeaders.get(id) ?? HEADER, ...(tabs.get(id) ?? [])] });
  }
  if (url.includes("sheets.googleapis.com/v4/spreadsheets/")) {
    return r(200, { properties: { title: "E2E", locale: "en_US" }, sheets: [...tabs.keys()].map((id, i) => ({ properties: { sheetId: id, title: `Tab${id}`, index: i, gridProperties: { rowCount: 1000, columnCount: (tabHeaders.get(id) ?? HEADER).length } } })) });
  }
  return r(404, {});
}) as typeof fetch;

// ---------------------------------------------------------------- wiring (background work is awaited explicitly)
const pending: Promise<unknown>[] = [];
const background = (p: Promise<unknown>) => { pending.push(p); };
async function settle() { while (pending.length) await pending.shift(); }
const c: A.Ctx = { svc: svc as never, cfg: CFG, fetchFn, userId: USER, orgId: ORG, push: { pcfg: PCFG, background } };
const sdb = sheetsDb(svc as never), pdb = pushDb(svc as never);
const receiverDeps: ReceiverDeps = { push: pdb, pcfg: PCFG, cfg: CFG, background,
  process: (t) => processTargets({ db: sdb, push: pdb, cfg: CFG, fetchFn }, { target: t, worker: "receiver", budgetMs: 60_000 }) };

let checks = 0;
function ok(cond: unknown, msg: string): void {
  if (!cond) { console.error(`   FAIL: ${msg}`); Deno.exit(1); }
  checks++;
}
async function q(table: string, filter: string) {
  return (await fetch(`${base}/${table}?${filter}`, { headers: { Authorization: `Bearer ${SERVICE}` } })).json();
}
async function leads(last: string) {
  return await q("leads", `organization_id=eq.${ORG}&last_name=eq.${encodeURIComponent(last)}&select=id,assigned_agent_id,user_id,organization_id`) as
    { id: string; assigned_agent_id: string; user_id: string; organization_id: string }[];
}
async function pushRuns() { return (await q("google_sheets_sync_runs", `user_id=eq.${USER}&trigger=eq.push&select=id`)).length as number; }
let msg = 1;
async function notify(opts: { ch?: (typeof watches)[number]; state?: string; number?: number; token?: string; id?: string } = {}) {
  const ch = opts.ch ?? watches.at(-1)!;
  const res = await receive(new Request(PCFG.address, { method: "POST", headers: {
    "X-Goog-Channel-ID": opts.id ?? ch.id, "X-Goog-Channel-Token": opts.token ?? ch.token, "X-Goog-Resource-ID": ch.resourceId,
    "X-Goog-Resource-State": opts.state ?? "update", "X-Goog-Message-Number": String(opts.number ?? ++msg), "X-Goog-Changed": "content",
    "X-Goog-Resource-URI": `https://www.googleapis.com/drive/v3/files/${SPREADSHEET}?alt=json` } }), receiverDeps);
  await settle();
  return res.status;
}
async function connect() {
  const conn = (await q("google_sheets_connections", `user_id=eq.${USER}`))[0];
  const r = await svc.rpc("google_sheets_store_connection", { p_user: USER, p_org: ORG, p_expected_generation: conn?.auth_generation ?? 0,
    p_google_sub: "sub-push-e2e", p_google_email: "push-e2e@example.test", p_scopes: ["openid", "email", "https://www.googleapis.com/auth/drive.file"],
    p_refresh_token: "rt-push-e2e" });
  ok(r.data?.[0]?.outcome === "connected", `connect: ${JSON.stringify(r)}`);
}
async function addTab(sheet: number, rows: string[][]) {
  tabs.set(sheet, rows);
  const saved = await A.save(c, { payload: { spreadsheet_id: SPREADSHEET, sheet_id: sheet, spreadsheet_name: "E2E", sheet_title: `Tab${sheet}`,
    display_name: `Push ${sheet}`, mapping: MAPPING, identity_mode: "row_position", lead_source_default: "Google Sheets", include_existing: false } });
  await A.activate(c, { source_id: saved.source_id, expected_version: saved.config_version });
  await settle();
  return saved.source_id as string;
}
const monitoring = async (src: string) => ((await A.status(c)).realtime as { sources: Record<string, { state: string }> } | null)?.sources?.[src]?.state;

// ---------------------------------------------------------------- scenarios
await connect();
const BASE = ["Base", "Row", "5551110000"];

console.log("   push 1: Enable registers ONE watch for the spreadsheet; the catch-up imports nothing (baseline)");
const t1 = await addTab(1, [BASE]);
ok(watches.length === 1 && watches[0].address === PCFG.address && watches[0].token.length === 43 && /^gs1[A-Za-z0-9_-]{40}$/.test(watches[0].id),
  `one watch with our address and a 43-char id/token: ${JSON.stringify(watches)}`);
ok((await leads("Row")).length === 0, "baseline row not imported");
ok(await monitoring(t1) === "active", "status: Real-time sync active");

console.log("   push 2: a new row → notification → exactly one lead, owned by the connection owner");
tabs.set(1, [BASE, ["Ann", "PushA", "5551110001"]]);
ok(await notify() === 200, "notification acknowledged");
const l = await leads("PushA");
ok(l.length === 1 && l[0].assigned_agent_id === USER && l[0].user_id === USER && l[0].organization_id === ORG, `one owned lead: ${JSON.stringify(l)}`);
const runsAfter2 = await pushRuns();
ok(runsAfter2 >= 1, "push run recorded with trigger push");

console.log("   push 3: Google redelivers the same message → acknowledged, no new run, no duplicate");
ok(await notify({ number: msg }) === 200, "duplicate acknowledged");
ok((await pushRuns()) === runsAfter2 && (await leads("PushA")).length === 1, "no new run, still one lead");

console.log("   push 4: an incomplete row creates nothing; completing it later imports it");
tabs.set(1, [BASE, ["Ann", "PushA", "5551110001"], ["Bo", "PushB", ""]]);
ok(await notify() === 200 && (await leads("PushB")).length === 0, "incomplete row pending, no lead");
tabs.set(1, [BASE, ["Ann", "PushA", "5551110001"], ["Bo", "PushB", "5551110002"]]);
ok(await notify() === 200 && (await leads("PushB")).length === 1, "completed row imported once");

console.log("   push 5: several rows at once → one notification imports all of them");
tabs.set(1, [...tabs.get(1)!, ["C1", "PushC", "5551110003"], ["C2", "PushC", "5551110004"], ["C3", "PushC", "5551110005"]]);
ok(await notify() === 200 && (await leads("PushC")).length === 3, "three rows, three leads");

console.log("   push 6: a second tab of the same spreadsheet shares the watch; one notification covers both tabs");
const t2 = await addTab(2, [BASE]);
ok(watches.length === 1, "no second watch for the same spreadsheet");
tabs.set(2, [BASE, ["Dee", "PushD", "5551110006"]]);
tabs.set(1, [...tabs.get(1)!, ["Eve", "PushE", "5551110007"]]);
ok(await notify() === 200 && (await leads("PushD")).length === 1 && (await leads("PushE")).length === 1, "both tabs imported from one notification");

console.log("   push 6b: a mapping v2 tab on the same watch stores lossless typed values from a notification");
{
  const res = await fetch(`${base}/custom_fields`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}`,
    Prefer: "return=representation" }, body: JSON.stringify([{ organization_id: ORG, name: "Amt Requested", type: "Number", applies_to: ["Leads"], created_by: USER },
      { organization_id: ORG, name: "ZIP Code", type: "Text", applies_to: ["Leads"], created_by: null }]) });
  const [amt, zip] = await res.json();
  tabHeaders.set(3, ["First", "Last", "Phone", "Amt", "Zip", "Notes"]);
  tabs.set(3, [["Base", "Row", "5551110000", "", "", ""]]);
  const saved = await A.save(c, { payload: { spreadsheet_id: SPREADSHEET, sheet_id: 3, spreadsheet_name: "E2E", sheet_title: "Tab3", display_name: "Push v2",
    mapping: { v: 2, columns: [...MAPPING.columns, { header: "Amt", target: `custom:${amt.id}` }, { header: "Zip", target: `custom:${zip.id}` }], ignored: ["Notes"] },
    identity_mode: "row_position", lead_source_default: "Google Sheets", include_existing: false } });
  await A.activate(c, { source_id: saved.source_id, expected_version: saved.config_version });
  await settle();
  ok(watches.length === 1, "still one watch for the spreadsheet");
  tabs.set(3, [["Base", "Row", "5551110000", "", "", ""], ["Fay", "PushV2", "5551110008", "$1,234.50", "02134", "x"]]);
  ok(await notify() === 200, "notification acknowledged");
  const v2 = await q("leads", `organization_id=eq.${ORG}&last_name=eq.PushV2&select=assigned_agent_id,custom_fields`) as
    { assigned_agent_id: string; custom_fields: Record<string, string> }[];
  ok(v2.length === 1 && v2[0].assigned_agent_id === USER && v2[0].custom_fields?.["Amt Requested"] === "1234.50"
    && v2[0].custom_fields?.["ZIP Code"] === "02134" && Object.keys(v2[0].custom_fields).length === 2,
    `typed values via push: ${JSON.stringify(v2)}`);
  await A.setState(c, { source_id: saved.source_id }, "remove");   // later scenarios own the watch lifecycle; the lead stays
  await settle();
  ok((await q("leads", `organization_id=eq.${ORG}&last_name=eq.PushV2&select=id`)).length === 1, "removing the tab keeps its lead");
}

console.log("   push 7: forged requests are refused and change nothing");
ok(await notify({ token: "f".repeat(43) }) === 401, "wrong token → 401");
ok(await notify({ id: "gs1" + "Z".repeat(40) }) === 404, "unknown / untagged channel id → 404");
ok((await leads("PushA")).length === 1, "nothing imported by forged requests");

console.log("   push 8: Sync now after push imports nothing new (receipts)");
await svc.patch("google_sheets_sources", `id=eq.${t1}`, { last_checked_at: null });
const sn = await A.syncNow(c, { source_id: t1 });
ok(sn.status === "ok" && sn.imported === 0 && (await leads("PushC")).length === 3, `sync now: ${JSON.stringify(sn)}`);

console.log("   push 9: Pause stops monitoring; a row added while paused imports exactly once after Resume (catch-up)");
await A.setState(c, { source_id: t2 }, "pause");
ok(stops.length === 0, "one tab still enabled → watch kept");
await A.setState(c, { source_id: t1 }, "pause");
ok(stops.length === 1 && stops[0] === watches[0].id, `last tab paused → channel stopped: ${JSON.stringify(stops)}`);
tabs.set(1, [...tabs.get(1)!, ["Fay", "PushF", "5551110008"]]);
ok(await notify({ ch: watches[0] }) === 200 && (await leads("PushF")).length === 0, "notification after Pause: acknowledged, nothing imported");
await A.setState(c, { source_id: t1 }, "resume"); await settle();
await A.setState(c, { source_id: t2 }, "resume"); await settle();
ok(watches.length === 2, "Resume registered a new watch");
ok((await leads("PushF")).length === 1, "the row added while paused is imported on Resume");

console.log("   push 10: reconnect → old channel ignored; maintenance re-registers with a catch-up and stops the old one");
await connect();
tabs.set(1, [...tabs.get(1)!, ["Gus", "PushG", "5551110009"]]);
ok(await notify({ ch: watches[1] }) === 200 && (await leads("PushG")).length === 0, "old-generation notification acknowledged, no import");
watchTtlMs = 2 * 3_600_000; // this channel will be inside the 3 h renew window
const m = await runMaintenance({ db: sdb, push: pdb, cfg: CFG, pcfg: PCFG, fetchFn }, 60_000);
watchTtlMs = 86_000_000;
ok(m.registered === 1 && watches.length === 3 && stops.includes(watches[1].id), `maintenance: ${JSON.stringify(m)} stops=${JSON.stringify(stops)}`);
ok((await leads("PushG")).length === 1, "the row from the gap is imported by the catch-up");
ok(await notify({ ch: watches[2] }) === 200, "new channel works");

console.log("   push 10b: renewal overlap → the superseded channel is not stopped at once; a row notified only on it is imported once");
const stopsBefore = stops.length;
const mr = await runMaintenance({ db: sdb, push: pdb, cfg: CFG, pcfg: PCFG, fetchFn }, 60_000);
ok(mr.registered === 1 && watches.length === 4, `renewal registered: ${JSON.stringify(mr)}`);
ok(stops.length === stopsBefore && !stops.includes(watches[2].id), `superseded channel kept for the overlap: ${JSON.stringify(stops)}`);
ok(await monitoring(t1) === "active", "status: Real-time sync active during the overlap");
tabs.set(1, [...tabs.get(1)!, ["Ivy", "PushI", "5551110011"]]);
ok(await notify({ ch: watches[2] }) === 200 && (await leads("PushI")).length === 1, "a change notified only on the superseded channel is imported");
ok(await notify({ ch: watches[3] }) === 200 && (await leads("PushI")).length === 1, "the same change on the new channel imports nothing new");

console.log("   push 11: Disconnect stops the channel first; later notifications import nothing");
await A.disconnect(c);
ok(stops.includes(watches[2].id) && stops.includes(watches[3].id), "both channels (superseded and live) stopped before the refresh token was deleted");
tabs.set(1, [...tabs.get(1)!, ["Hal", "PushH", "5551110010"]]);
ok(await notify({ ch: watches[3] }) === 200 && await notify({ ch: watches[2] }) === 200 && (await leads("PushH")).length === 0,
  "notifications after Disconnect: acknowledged, nothing imported");

console.log("   push 12: zero duplicates overall");
for (const last of ["PushA", "PushB", "PushD", "PushE", "PushF", "PushG", "PushI", "PushV2"]) ok((await leads(last)).length === 1, `exactly one ${last}`);
ok((await leads("PushC")).length === 3 && (await leads("Row")).length === 0, "batch and baseline counts");

console.log(`   OK (${checks} push end-to-end checks)`);
