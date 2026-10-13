// Google Sheets — PostgREST role-access check (LOCAL ONLY; invoked by run_google_sheets_tests.sh).
// Exercises the exact HTTP path the Edge Functions use (supabase-js .rpc → PostgREST /rpc/<name>):
// service_role reaches the public wrappers and completes a worker cycle; authenticated and anon are
// refused; private helpers are not exposed; authenticated reads only its own rows under RLS.
import { createHmac } from "node:crypto";

const [base, secret] = process.argv.slice(2);
if (!base?.startsWith("http://127.0.0.1:")) throw new Error("REFUSING: local PostgREST only");

const ORG = "a0000000-0000-0000-0000-00000000000a";
const A1 = "11111111-0000-0000-0000-000000000001";
const A2 = "11111111-0000-0000-0000-000000000002";

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function jwt(claims) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ exp: Math.floor(Date.now() / 1000) + 600, ...claims });
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}
const SERVICE = jwt({ role: "service_role" });
const AUTHED = jwt({ role: "authenticated", sub: A1, app_metadata: { organization_id: ORG } });

async function call(path, { token, body, method = "POST" } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}
let checks = 0;
function ok(cond, msg) { if (!cond) { console.error(`   FAIL: ${msg}`); process.exit(1); } checks++; }

// 1. service_role reaches a wrapper
let r = await call("/rpc/google_sheets_owner_eligible", { token: SERVICE, body: { p_user: A1, p_org: ORG } });
ok(r.status === 200 && r.json === true, `service_role owner_eligible → ${r.status} ${JSON.stringify(r.json)}`);

// 2. authenticated / anon are refused on every privileged wrapper
for (const fn of ["google_sheets_claim", "google_sheets_get_refresh_token", "google_sheets_ingest",
                  "google_sheets_store_connection", "google_sheets_consume_oauth_state", "google_sheets_owner_eligible"]) {
  const bodyFor = { google_sheets_claim: { p_lease: A1, p_limit: 1 }, google_sheets_get_refresh_token: { p_connection: A1 },
    google_sheets_ingest: { p_source: A1, p_lease: A1, p_version: 1, p_generation: 1, p_rows: [], p_pending: [] },
    google_sheets_store_connection: { p_user: A1, p_org: ORG, p_expected_generation: 0, p_google_sub: "x", p_google_email: "x",
                                      p_scopes: [], p_refresh_token: "x" },
    google_sheets_consume_oauth_state: { p_state_hash: "0".repeat(64) }, google_sheets_owner_eligible: { p_user: A1, p_org: ORG } }[fn];
  const a = await call(`/rpc/${fn}`, { token: AUTHED, body: bodyFor });
  ok(a.status === 401 || a.status === 403, `authenticated ${fn} → ${a.status}`);
  const n = await call(`/rpc/${fn}`, { body: bodyFor });
  ok(n.status === 401 || n.status === 403, `anon ${fn} → ${n.status}`);
}

// 3. private helpers are not exposed over HTTP, even to service_role
r = await call("/rpc/google_sheets_ingest_private_probe", { token: SERVICE, body: {} });
ok(r.status === 404, `unknown rpc → ${r.status}`);
r = await call("/google_sheets_receipts", { token: SERVICE, method: "GET" });
ok(r.status === 404, `private table not exposed → ${r.status}`);

// 4. full worker cycle over PostgREST as the Edge worker does it
const lease = "99999999-0000-0000-0000-000000000001";
await call("/google_sheets_sources?sheet_id=eq.2", { token: SERVICE, method: "PATCH",
  body: { next_sync_at: new Date(Date.now() - 60000).toISOString(), lease_owner: null, lease_expires_at: null } });
r = await call("/rpc/google_sheets_claim", { token: SERVICE, body: { p_lease: lease, p_limit: 10 } });
ok(r.status === 200 && Array.isArray(r.json) && r.json.length >= 1, `claim → ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
const src = r.json[0];
r = await call("/rpc/google_sheets_load_state", { token: SERVICE, body: { p_source: src.source_id, p_lease: lease } });
ok(r.status === 200 && Array.isArray(r.json.rows), `load_state → ${r.status}`);
r = await call("/rpc/google_sheets_ingest", { token: SERVICE, body: {
  p_source: src.source_id, p_lease: lease, p_version: src.config_version, p_generation: src.auth_generation,
  p_rows: [{ k: "pos:2", n: 2, f: "fp-rest", lead: { first_name: "Rest", last_name: "Path", phone: "5550102030" } }],
  p_pending: [] } });
ok(r.status === 200 && r.json.imported === 1, `ingest → ${r.status} ${JSON.stringify(r.json)}`);
r = await call("/rpc/google_sheets_finish", { token: SERVICE, body: {
  p_source: src.source_id, p_lease: lease, p_version: src.config_version, p_trigger: "schedule",
  p_result: { imported: 1, health: "ok" } } });
ok(r.status === 200 && r.json === true, `finish → ${r.status}`);

// 5. authenticated reads only its own rows; cannot write
r = await call(`/google_sheets_sources?select=user_id`, { token: AUTHED, method: "GET" });
ok(r.status === 200 && r.json.length > 0 && r.json.every((x) => x.user_id === A1), `own sources only → ${JSON.stringify(r.json).slice(0, 120)}`);
r = await call(`/google_sheets_connections?select=user_id,status`, { token: AUTHED, method: "GET" });
ok(r.status === 200 && r.json.length === 1 && r.json[0].user_id === A1, "own connection only");
r = await call(`/google_sheets_sources?user_id=eq.${A2}`, { token: AUTHED, method: "PATCH", body: { state: "paused" } });
ok(r.status === 401 || r.status === 403, `authenticated PATCH refused → ${r.status}`);
r = await call(`/google_sheets_sync_runs?select=user_id`, { token: AUTHED, method: "GET" });
ok(r.status === 200 && r.json.every((x) => x.user_id === A1), "own runs only");

console.log(`   OK (${checks} PostgREST checks)`);
