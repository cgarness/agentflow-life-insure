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
                  "google_sheets_store_connection", "google_sheets_consume_oauth_state", "google_sheets_owner_eligible",
                  "google_sheets_finish", "google_sheets_review_state", "google_sheets_resolve_identity",
                  "google_sheets_connection_current"]) {
  const bodyFor = { google_sheets_claim: { p_lease: A1, p_limit: 1 }, google_sheets_get_refresh_token: { p_connection: A1 },
    google_sheets_ingest: { p_source: A1, p_lease: A1, p_version: 1, p_generation: 1, p_rows: [], p_pending: [] },
    google_sheets_store_connection: { p_user: A1, p_org: ORG, p_expected_generation: 0, p_google_sub: "x", p_google_email: "x",
                                      p_scopes: [], p_refresh_token: "x" },
    google_sheets_consume_oauth_state: { p_state_hash: "0".repeat(64) }, google_sheets_owner_eligible: { p_user: A1, p_org: ORG },
    google_sheets_finish: { p_source: A1, p_lease: A1, p_version: 1, p_generation: 1, p_trigger: "schedule", p_result: {} },
    google_sheets_review_state: { p_user: A1, p_org: ORG, p_source: A1 },
    google_sheets_resolve_identity: { p_user: A1, p_org: ORG, p_source: A1, p_expected_version: 1, p_generation: 1,
                                      p_review: {}, p_snapshot: null, p_decisions: null, p_dry_run: true },
    google_sheets_connection_current: { p_user: A1, p_org: ORG, p_connection: A1, p_generation: 1 } }[fn];
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
  p_source: src.source_id, p_lease: lease, p_version: src.config_version, p_generation: src.auth_generation - 1,
  p_trigger: "schedule", p_result: { imported: 1, health: "access_lost" } } });
ok(r.status === 200 && r.json === "released", `finish with a stale generation → ${r.status} ${JSON.stringify(r.json)}`);
r = await call("/rpc/google_sheets_claim", { token: SERVICE, body: { p_lease: lease, p_limit: 1, p_source: src.source_id,
  p_user: src.user_id, p_org: src.organization_id } });
r = await call("/rpc/google_sheets_finish", { token: SERVICE, body: {
  p_source: src.source_id, p_lease: lease, p_version: src.config_version, p_generation: src.auth_generation,
  p_trigger: "schedule", p_result: { imported: 1, health: "ok" } } });
ok(r.status === 200 && r.json === "completed", `finish → ${r.status} ${JSON.stringify(r.json)}`);
r = await call("/rpc/google_sheets_review_state", { token: SERVICE, body: { p_user: src.user_id, p_org: src.organization_id, p_source: src.source_id } });
ok(r.status === 200 && Array.isArray(r.json.rows) && typeof r.json.config_version === "number", `review_state → ${r.status}`);

// 5. authenticated reads only its own rows; cannot write
r = await call(`/google_sheets_sources?select=user_id`, { token: AUTHED, method: "GET" });
ok(r.status === 200 && r.json.length > 0 && r.json.every((x) => x.user_id === A1), `own sources only → ${JSON.stringify(r.json).slice(0, 120)}`);
r = await call(`/google_sheets_connections?select=user_id,status`, { token: AUTHED, method: "GET" });
ok(r.status === 200 && r.json.length === 1 && r.json[0].user_id === A1, "own connection only");
r = await call(`/google_sheets_sources?user_id=eq.${A2}`, { token: AUTHED, method: "PATCH", body: { state: "paused" } });
ok(r.status === 401 || r.status === 403, `authenticated PATCH refused → ${r.status}`);
r = await call(`/google_sheets_sync_runs?select=user_id`, { token: AUTHED, method: "GET" });
ok(r.status === 200 && r.json.every((x) => x.user_id === A1), "own runs only");

// 6. push sync wrappers (20261025120000): service_role only; private push tables never exposed
const DIG = "0".repeat(64), CH = "gs1" + "A".repeat(40);
const pushBodies = {
  google_sheets_push_accept: { p_channel_id: CH, p_token_digest: DIG, p_resource_id: "R", p_state: "update", p_message_number: 1, p_changed: "", p_received_at: new Date().toISOString() },
  google_sheets_push_claim: { p_lease: A1, p_target: null, p_lease_s: 60, p_worker: "receiver" },
  google_sheets_push_claim_source: { p_target: A1, p_target_lease: A1, p_source: A1, p_lease: A1 },
  google_sheets_push_complete: { p_target: A1, p_lease: A1, p_result: { outcome: "done" } },
  google_sheets_push_kick: { p_user: A1, p_org: ORG, p_source: A1, p_reason: "save" },
  google_sheets_watch_begin: { p_connection: A1, p_generation: 1, p_spreadsheet: "SPREADSHEET_CONCURRENT", p_channel_id: CH, p_token_digest: DIG, p_key_id: "abcd1234", p_reason: "activate" },
  google_sheets_watch_result: { p_channel_row: A1, p_action: "stopped", p_resource_id: null, p_expiration: null, p_code: null },
  google_sheets_watch_release: { p_user: A1, p_org: ORG, p_spreadsheet: null, p_force: false },
  google_sheets_push_maintenance_claim: { p_lease: A1, p_limit: 5, p_key_id: "abcd1234" },
  google_sheets_push_status: { p_user: A1, p_org: ORG },
};
for (const [fn, bodyFor] of Object.entries(pushBodies)) {
  const a = await call(`/rpc/${fn}`, { token: AUTHED, body: bodyFor });
  ok(a.status === 401 || a.status === 403, `authenticated ${fn} → ${a.status}`);
  const n = await call(`/rpc/${fn}`, { body: bodyFor });
  ok(n.status === 401 || n.status === 403, `anon ${fn} → ${n.status}`);
}
r = await call("/rpc/google_sheets_push_accept", { token: SERVICE, body: pushBodies.google_sheets_push_accept });
ok(r.status === 200 && r.json?.[0]?.outcome === "unknown_channel" && r.json[0].process === false, `service_role push_accept → ${r.status} ${JSON.stringify(r.json)}`);
r = await call("/rpc/google_sheets_push_status", { token: SERVICE, body: pushBodies.google_sheets_push_status });
ok(r.status === 200 && r.json?.mode === "off" && JSON.stringify(r.json.sources) === "{}", `service_role push_status → ${r.status} ${JSON.stringify(r.json)}`);
r = await call("/rpc/google_sheets_push_maintenance_claim", { token: SERVICE, body: pushBodies.google_sheets_push_maintenance_claim });
ok(r.status === 200 && r.json?.mode === "off" && Array.isArray(r.json.items), `service_role maintenance_claim → ${r.status}`);
for (const t of ["google_sheets_watch_targets", "google_sheets_watch_channels", "google_sheets_push_events", "google_sheets_push_attempts", "google_sheets_push_config"]) {
  r = await call(`/${t}`, { token: SERVICE, method: "GET" });
  ok(r.status === 404, `private ${t} not exposed → ${r.status}`);
}
r = await call("/rpc/google_sheets_push_maintenance_due", { token: SERVICE, body: {} });
ok(r.status === 404, `cron guard is not an HTTP endpoint → ${r.status}`);

// Mapping v2 typed catalog (M1) and standard lead fields (M2): the HTTP path the app and Edge use.
r = await call("/rpc/google_sheets_context", { token: SERVICE, body: { p_user: A1, p_org: ORG } });
ok(r.status === 200 && r.json?.catalog_version === 2 && r.json.custom_fields.length === 3
  && r.json.custom_fields.every((f) => f.scope === "agency" && f.type === "Text" && f.own === false),
  `typed catalog with the seeded standard fields → ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
const ADMIN = "11111111-0000-0000-0000-000000000009";
const asUser = (sub, role, sa = false) => jwt({ role: "authenticated", sub, is_super_admin: sa, app_metadata: { organization_id: ORG, role } });
for (const [label, token] of [["anon", undefined], ["service_role", SERVICE], ["agent", asUser(A1, "Agent")], ["agent with a forged role", asUser(A1, "Admin")]]) {
  r = await call("/rpc/provision_standard_lead_fields", { token, body: { p_dry_run: false } });
  ok(r.status === 401 || r.status === 403, `${label} provision_standard_lead_fields refused → ${r.status} ${JSON.stringify(r.json)}`);
  r = await call("/rpc/custom_field_make_agency_wide", { token, body: { p_field: "f0000000-0000-0000-0000-000000000001", p_dry_run: true } });
  ok(r.status === 401 || r.status === 403, `${label} custom_field_make_agency_wide refused → ${r.status}`);
}
r = await call("/rpc/provision_standard_lead_fields", { token: asUser(ADMIN, "Admin"), body: { p_dry_run: true } });
ok(r.status === 200 && r.json?.status === "complete" && r.json.fields.map((f) => f.state).join() === "exists_agency,exists_agency,exists_agency"
  && r.json.last_attempt?.status === "complete", `admin standard-field status → ${r.status} ${JSON.stringify(r.json)}`);
for (const t of ["standard_lead_field_provisioning", "custom_field_scope_changes", "rpc/standard_lead_fields_authority",
                 "rpc/custom_field_convert_to_agency"]) {
  r = await call(`/${t}`, { token: SERVICE, method: t.startsWith("rpc/") ? "POST" : "GET", body: t.startsWith("rpc/") ? {} : undefined });
  ok(r.status === 404, `private ${t} not exposed → ${r.status}`);
}

console.log(`   OK (${checks} PostgREST checks)`);
