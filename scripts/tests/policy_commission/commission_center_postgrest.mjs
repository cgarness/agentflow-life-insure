// Commissions center reads (20261020180000): real PostgREST 12 + @supabase/supabase-js against a DISPOSABLE local
// database prepared by scripts/run_policy_commission_tests.sh (fixture, harness, both applied migrations, the center
// harness and 20261020180000). Synthetic data only.
//   PGURL=postgres://postgres@127.0.0.1:<port> DB_URL=<PGURL>/<db> POSTGREST_BIN=/path/to/postgrest node <this file>
// Proves the HTTP contract of the five reads: shapes, My-commissions scope, drawer parity with the contact read, error
// codes and statuses (42501, 22023, PT404, 55000), anon/service_role refusal, the helper schema not exposed, no
// writes, and HTTP timing.
import { spawn } from 'node:child_process';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';

const { PGURL, DB_URL, POSTGREST_BIN } = process.env;
for (const url of [PGURL, DB_URL]) {
  if (!url || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('Disposable localhost database only');
}
if (!new URL(DB_URL).pathname.startsWith('/pc_test_')) throw new Error('Refusing a database not created by the policy commission runner');
if (!POSTGREST_BIN) throw new Error('POSTGREST_BIN is required');

const AUTHENTICATOR = 'pc_center_authenticator';
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const admin = postgres(DB_URL, { max: 2, onnotice: () => {} });
const cluster = postgres(new URL('/postgres', PGURL).toString(), { max: 1, onnotice: () => {} });
const secret = randomBytes(32).toString('hex');
const authenticatorPassword = randomBytes(18).toString('hex');
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
function jwt(claims) {
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ exp: Math.floor(Date.now() / 1000) + 3600, ...claims })}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
async function freePort() {
  return new Promise((resolve) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const READS = {
  get_my_commission_overview: { p_period: 'this_month' },
  get_my_commission_installments: { p_period: 'all', p_scope: 'any', p_status: 'all', p_limit: 25, p_offset: 0 },
  get_my_commission_receipts: { p_period: 'all', p_include_voided: true, p_limit: 25, p_offset: 0 },
  get_my_commission_policies: { p_setup: 'all', p_limit: 25, p_offset: 0 },
};

let child;
const results = [];
const check = (name, fn) => results.push([name, fn]);
try {
  await cluster.unsafe(`DROP ROLE IF EXISTS ${AUTHENTICATOR}`);
  await cluster.unsafe(`CREATE ROLE ${AUTHENTICATOR} LOGIN NOINHERIT PASSWORD '${authenticatorPassword}'`);
  await cluster.unsafe(`GRANT anon, authenticated, service_role TO ${AUTHENTICATOR}`);
  const port = await freePort();
  const dbUri = new URL(DB_URL);
  dbUri.username = AUTHENTICATOR;
  dbUri.password = authenticatorPassword;
  child = spawn(POSTGREST_BIN, [], {
    env: {
      PATH: process.env.PATH, PGRST_DB_URI: dbUri.toString(), PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon',
      PGRST_JWT_SECRET: secret, PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: String(port), PGRST_DB_POOL: '6',
      PGRST_LOG_LEVEL: 'error',
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; ; attempt += 1) {
    try {
      if ((await fetch(`${base}/`)).ok) break;
    } catch { /* not listening yet */ }
    if (attempt > 100) throw new Error('PostgREST did not start');
    await new Promise((r) => setTimeout(r, 100));
  }
  const version = (await fetch(`${base}/`)).headers.get('server');
  const profiles = Object.fromEntries((await admin`select id, organization_id, role, is_super_admin from profiles`).map((p) => [p.id, p]));
  const restFetch = (input, init) => fetch(String(input).replace(`${base}/rest/v1`, base), init);
  function as(n) {
    const headers = {};
    if (n === 'service_role' || n === 'anon') headers.Authorization = `Bearer ${jwt({ role: n })}`;
    else {
      const p = profiles[id(n)];
      headers.Authorization = `Bearer ${jwt({ sub: p.id, role: 'authenticated', is_super_admin: p.is_super_admin,
        app_metadata: { organization_id: p.organization_id, role: p.role } })}`;
    }
    return createClient(base, 'pc-test-anon-key', { global: { fetch: restFetch, headers }, auth: { persistSession: false, autoRefreshToken: false } });
  }
  const grid = (await admin`select revision from comp_grids where id = ${id(500)}`)[0].revision;
  const slot = (agent = 11, firstYear = 57300, advance = 42975) => ({ slot: 'primary', credited_agent_id: id(agent), grid_id: id(500),
    grid_revision: Number(grid), product_id: id(501), variant_id: id(511), insured_age: 35, term_years: 20,
    contract_level: agent === 12 ? 90 : 100, rate_percent: agent === 12 ? '85.25' : '95.50', monthly_premium: '50.00',
    first_year_cents: firstYear, advance_cents: advance });
  const client = (first, agent = 11) => ({ first_name: first, last_name: 'Synthetic', phone: '5555550100', email: '', policy_type: 'Term',
    carrier: 'Synthetic Life', policy_number: `SYN-${first}`, premium: 50, face_amount: 100000, sold_date: '2026-10-01',
    effective_date: '2026-11-01', assigned_agent_id: id(agent) });
  const sale = (who, first, slots) => as(who).rpc('create_client_with_sale_handoff', { p_request_id: randomUUID(), p_expected_org: id(1),
    p_client: client(first, who), p_record_sale: true, p_commission: { v: 'policy-commission-v1', slots } });
  const ava = as(11);

  check('anon and service_role cannot call any read (401 / 403, 42501)', async () => {
    for (const [fn, args] of [...Object.entries(READS), ['get_my_policy_commission', { p_policy_id: id(1) }]]) {
      const a = await as('anon').rpc(fn, args);
      assert.equal(a.status, 401, fn); assert.equal(a.error.code, '42501');
      const s = await as('service_role').rpc(fn, args);
      assert.equal(s.status, 403, fn); assert.equal(s.error.code, '42501');
    }
  });
  let estimated;
  let missing;
  check('seed through the existing companions (one estimate, one without, one needing review; one for Ben)', async () => {
    estimated = await sale(11, 'HttpEstimated', [slot()]);
    assert.equal(estimated.status, 200, JSON.stringify(estimated.error));
    assert.equal(estimated.data.commission.slots[0].status, 'recorded');
    missing = await sale(11, 'HttpMissing', []);
    assert.equal(missing.status, 200, JSON.stringify(missing.error));
    const review = await sale(11, 'HttpReview', [slot(11, 57301, 42976)]);
    assert.equal(review.data.commission.slots[0].status, 'needs_attention');
    const ben = await sale(12, 'HttpBen', [slot(12, 51150, 38363)]);
    assert.equal(ben.status, 200, JSON.stringify(ben.error));
  });
  check('overview over HTTP: agency date, cards, review and setup for the signed-in seller only', async () => {
    const r = await ava.rpc('get_my_commission_overview', { p_period: 'custom', p_from: '2026-01-01', p_to: '2027-12-31' });
    assert.equal(r.status, 200, JSON.stringify(r.error));
    assert.equal(r.data.meta.time_zone, 'America/Los_Angeles');
    assert.deepEqual(Object.keys(r.data).sort(), ['meta', 'next_90', 'review', 'setup', 'summary', 'timeline', 'upcoming']);
    assert.equal(r.data.summary.expected_cents, 57300);
    assert.equal(r.data.timeline.length, 24);
    assert.deepEqual(r.data.setup, { eligible_count: 3, with_estimate_count: 1 });
    assert.equal(r.data.review.missing_estimate.count, 1); assert.equal(r.data.review.needs_review.count, 1);
    const def = await ava.rpc('get_my_commission_overview');
    assert.equal(def.status, 200); assert.equal(def.data.meta.period, 'this_month');
  });
  check('Scheduled, History and Policies pages with totals over the whole filter', async () => {
    const page = await ava.rpc('get_my_commission_installments', { ...READS.get_my_commission_installments, p_limit: 3 });
    assert.equal(page.status, 200, JSON.stringify(page.error));
    assert.equal(page.data.total_count, 4); assert.equal(page.data.rows.length, 3);
    assert.equal(page.data.totals.expected_cents, 57300);
    const next = await ava.rpc('get_my_commission_installments', { ...READS.get_my_commission_installments, p_limit: 3, p_offset: 3 });
    assert.equal(next.data.rows.length, 1);
    assert.equal(new Set([...page.data.rows, ...next.data.rows].map((x) => x.installment_id)).size, 4);
    const receipt = await ava.rpc('record_policy_commission_receipt', { p_request_id: randomUUID(),
      p_installment_id: page.data.rows[0].installment_id, p_amount_cents: 12345, p_received_on: '2026-10-19', p_reference: 'Statement 9' });
    assert.equal(receipt.status, 200, JSON.stringify(receipt.error));
    const history = await ava.rpc('get_my_commission_receipts', READS.get_my_commission_receipts);
    assert.equal(history.status, 200); assert.equal(history.data.total_count, 1);
    assert.equal(history.data.totals.received_cents, 12345); assert.equal(history.data.rows[0].reference, undefined);
    const policies = await ava.rpc('get_my_commission_policies', READS.get_my_commission_policies);
    assert.equal(policies.status, 200); assert.equal(policies.data.total_count, 3);
    const onlyMissing = await ava.rpc('get_my_commission_policies', { ...READS.get_my_commission_policies, p_setup: 'missing' });
    assert.equal(onlyMissing.data.rows.length, 1); assert.equal(onlyMissing.data.rows[0].estimate_cents, null);
  });
  check('drawer equals the contact read for a visible client; another seller or an unknown policy is 404 PT404', async () => {
    const contact = await ava.rpc('get_client_policy_commissions', { p_client_id: estimated.data.client_id });
    const policy = contact.data.policies[0];
    const drawer = await ava.rpc('get_my_policy_commission', { p_policy_id: policy.policy_id });
    assert.equal(drawer.status, 200, JSON.stringify(drawer.error));
    assert.deepEqual(drawer.data.policy, policy);
    assert.equal(drawer.data.contact.client_id, estimated.data.client_id);
    const unknown = await ava.rpc('get_my_policy_commission', { p_policy_id: randomUUID() });
    assert.equal(unknown.status, 404); assert.equal(unknown.error.code, 'PT404');
    const ben = await as(12).rpc('get_my_policy_commission', { p_policy_id: policy.policy_id });
    assert.equal(ben.status, 404); assert.equal(ben.error.code, 'PT404');
    const benPolicies = await as(12).rpc('get_my_commission_policies', READS.get_my_commission_policies);
    assert.equal(benPolicies.data.total_count, 1);
  });
  check('invalid input is 400 22023 with a human message', async () => {
    const r = await ava.rpc('get_my_commission_overview', { p_period: 'custom', p_from: '2026-10-10', p_to: '2026-10-01' });
    assert.equal(r.status, 400); assert.equal(r.error.code, '22023');
    assert.equal(r.error.message, 'Choose a start date on or before the end date, between 2000 and 2100.');
    const s = await ava.rpc('get_my_commission_installments', { ...READS.get_my_commission_installments, p_status: 'overdue' });
    assert.equal(s.status, 400); assert.equal(s.error.code, '22023');
  });
  check('helper schema and its functions are not exposed', async () => {
    for (const fn of ['viewer', 'installments', 'policies', 'period', 'installment_json', 'contact_json']) {
      const r = await ava.rpc(fn, {});
      assert.equal(r.status, 404, fn); assert.equal(r.error.code, 'PGRST202');
    }
    const profile = await fetch(`${base}/rpc/viewer`, { method: 'POST', headers: { 'Content-Profile': 'policy_commission_reporting',
      'Content-Type': 'application/json', Authorization: `Bearer ${jwt({ role: 'authenticated', sub: id(11) })}` }, body: '{}' });
    assert.equal(profile.status, 406);
    const openapi = await (await fetch(`${base}/`, { headers: { Authorization: `Bearer ${jwt({ role: 'authenticated', sub: id(11) })}` } })).text();
    assert.ok(openapi.includes('/rpc/get_my_commission_overview') && !openapi.includes('policy_commission_reporting'));
  });
  check('without own access: 403 42501; unset agency time zone: 55000', async () => {
    await admin`insert into role_permissions(organization_id, role, permissions)
                values (${id(1)}, 'Agent', '{"c":[{"name":"View Own Commission Percentage","agent":false}]}')`;
    try {
      const r = await ava.rpc('get_my_commission_overview');
      assert.equal(r.status, 403); assert.equal(r.error.code, '42501'); assert.equal(r.error.message, 'Commission access is unavailable');
    } finally {
      await admin`delete from role_permissions where organization_id = ${id(1)} and role = 'Agent'`;
    }
    await admin`update company_settings set timezone = null where organization_id = ${id(1)}`;
    try {
      const r = await ava.rpc('get_my_commission_policies', READS.get_my_commission_policies);
      assert.equal(r.error.code, '55000'); assert.equal(r.error.message, 'The agency time zone is not set');
    } finally {
      await admin`update company_settings set timezone = 'America/Los_Angeles' where organization_id = ${id(1)}`;
    }
  });
  check('reads write nothing', async () => {
    const before = (await admin`select coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0)::bigint n from pg_stat_user_tables
                                 where relname like 'policy_commission_%'`)[0].n;
    for (const [fn, args] of Object.entries(READS)) assert.equal((await ava.rpc(fn, args)).status, 200, fn);
    await new Promise((r) => setTimeout(r, 1200));
    await admin`select pg_stat_clear_snapshot()`;
    const after = (await admin`select coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0)::bigint n from pg_stat_user_tables
                                where relname like 'policy_commission_%'`)[0].n;
    assert.equal(after, before);
  });

  let failed = 0;
  for (const [name, fn] of results) {
    try { await fn(); console.log(`  ok  ${name}`); } catch (e) { failed += 1; console.log(`  FAIL ${name}\n${e.stack}`); }
  }
  if (failed) throw new Error(`${failed} commissions center PostgREST check(s) failed`);

  const N = Number(process.env.PC_HTTP_SAMPLES ?? 15);
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const rows = [];
  for (const [fn, args] of [...Object.entries(READS), ['get_my_policy_commission', { p_policy_id: (await ava.rpc('get_my_commission_policies',
    READS.get_my_commission_policies)).data.rows[0].policy_id }]]) {
    for (let i = 0; i < 3; i += 1) await ava.rpc(fn, args);
    const xs = [];
    for (let i = 0; i < N; i += 1) {
      const t = performance.now();
      const r = await ava.rpc(fn, args);
      assert.equal(r.status, 200, JSON.stringify(r.error));
      xs.push(performance.now() - t);
    }
    rows.push({ read: fn, http_median_ms: median(xs).toFixed(1) });
  }
  console.log(`PostgREST ${version}; HTTP median of ${N} (small synthetic book, warm, sequential):`);
  console.table(rows);
  console.log(`PASS commissions center PostgREST integration (${results.length} checks)`);
} finally {
  if (child) child.kill('SIGTERM');
  await admin.end();
  await new Promise((r) => setTimeout(r, 200));
  await cluster.unsafe(`DROP ROLE IF EXISTS ${AUTHENTICATOR}`).catch(() => {});
  await cluster.end();
}
