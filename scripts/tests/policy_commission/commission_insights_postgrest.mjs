// Commissions insights and goals (20261021180000): real PostgREST 12 + @supabase/supabase-js against a DISPOSABLE local
// database prepared by scripts/run_policy_commission_tests.sh (fixture, harness, the three applied migrations, the
// center harness and 20261021180000). Synthetic data only.
//   PGURL=postgres://postgres@127.0.0.1:<port> DB_URL=<PGURL>/<db> POSTGREST_BIN=/path/to/postgrest node <this file>
// Proves the HTTP contract: breakdown and list shapes, drill-down totals equal the bars, named-argument calls (no
// overload ambiguity) next to the released reads, goal set/edit/clear and owner isolation, direct table access limited
// by RLS and column grants, error codes (42501, 22023, 55000), anon/service_role refusal, the helper schema not
// exposed, reads that write nothing, and HTTP timing.
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

const AUTHENTICATOR = 'pc_insights_authenticator';
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

const MARCH = { p_period: 'custom', p_from: '2026-03-01', p_to: '2026-03-31' };
const READS = {
  get_my_commission_breakdown: MARCH,
  get_my_commission_policy_list: { p_setup: 'all', p_carrier: null, p_carrier_unknown: false, p_category: null, p_period: 'all',
    p_from: null, p_to: null, p_limit: 25, p_offset: 0 },
  get_my_commission_receipt_list: { p_period: 'all', p_include_voided: true, p_carrier: null, p_carrier_unknown: false, p_limit: 25, p_offset: 0 },
  get_my_commission_goal: { p_month: '2026-03-01' },
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
  const client = (first, agent, carrier, type = 'Term') => ({ first_name: first, last_name: 'Synthetic', phone: '5555550100', email: '',
    policy_type: type, carrier, policy_number: `SYN-${first}`, premium: 50, face_amount: 100000, sold_date: '2026-03-10',
    effective_date: '2026-11-01', assigned_agent_id: id(agent) });
  const sale = (who, first, carrier, slots, type) => as(who).rpc('create_client_with_sale_handoff', { p_request_id: randomUUID(),
    p_expected_org: id(1), p_client: client(first, who, carrier, type), p_record_sale: true, p_commission: { v: 'policy-commission-v1', slots } });
  const ava = as(11);
  const goals = (who) => as(who).from('policy_commission_goals');

  check('anon and service_role cannot call any new function or read goals', async () => {
    for (const [fn, args] of [...Object.entries(READS), ['set_my_commission_goal', { p_month: '2026-03-01', p_target_cents: 100 }],
      ['clear_my_commission_goal', { p_month: '2026-03-01' }]]) {
      const a = await as('anon').rpc(fn, args);
      assert.equal(a.status, 401, fn); assert.equal(a.error.code, '42501');
      const s = await as('service_role').rpc(fn, args);
      assert.equal(s.status, 403, fn); assert.equal(s.error.code, '42501');
    }
    assert.equal((await goals('anon').select('*')).status, 401);
    assert.equal((await goals('service_role').select('*')).status, 403);
  });
  check('seed through the existing companions (two carriers, one without an estimate; one sale for Ben)', async () => {
    for (const [first, carrier, slots, type] of [['HttpOne', 'Synthetic Life', [slot()]], ['HttpTwo', 'Synthetic Life', [slot()]],
      ['HttpThree', 'Acme Mutual', [], 'Final Expense']]) {
      const r = await sale(11, first, carrier, slots, type);
      assert.equal(r.status, 200, JSON.stringify(r.error));
    }
    assert.equal((await sale(12, 'HttpBen', 'Synthetic Life', [slot(12, 51150, 38363)])).status, 200);
  });
  check('breakdown over HTTP: cohort by Sold Date, carriers and products for the signed-in seller only', async () => {
    const r = await ava.rpc('get_my_commission_breakdown', MARCH);
    assert.equal(r.status, 200, JSON.stringify(r.error));
    assert.deepEqual(Object.keys(r.data).sort(), ['carriers', 'comparison', 'meta', 'months_10_12', 'products', 'received', 'sold']);
    assert.equal(r.data.sold.policies, 3); assert.equal(r.data.sold.with_estimate_count, 2); assert.equal(r.data.sold.estimate_cents, 114600);
    assert.deepEqual(r.data.carriers.map((c) => [c.carrier, c.policies]), [['Acme Mutual', 1], ['Synthetic Life', 2]]);
    assert.deepEqual(r.data.products.map((c) => [c.category, c.policies]), [['term', 2], ['final_expense', 1]]);
    assert.equal(r.data.comparison.basis, 'months');
    const def = await ava.rpc('get_my_commission_breakdown');
    assert.equal(def.status, 200); assert.equal(def.data.meta.period, 'this_month');
  });
  check('drill-down lists over HTTP equal their bars; the released reads still answer alongside', async () => {
    const r = (await ava.rpc('get_my_commission_breakdown', MARCH)).data;
    for (const group of r.carriers) {
      const list = await ava.rpc('get_my_commission_policy_list', { ...READS.get_my_commission_policy_list, p_carrier: group.carrier,
        p_period: 'custom', p_from: '2026-03-01', p_to: '2026-03-31' });
      assert.equal(list.status, 200, JSON.stringify(list.error));
      assert.equal(list.data.totals.policies, group.policies); assert.equal(list.data.totals.estimate_cents, group.estimate_cents);
    }
    const fe = await ava.rpc('get_my_commission_policy_list', { ...READS.get_my_commission_policy_list, p_category: 'final_expense' });
    assert.equal(fe.data.total_count, 1); assert.equal(fe.data.rows[0].category, 'final_expense');
    const page = await ava.rpc('get_my_commission_installments', { p_period: 'all', p_scope: 'any', p_status: 'all', p_limit: 1, p_offset: 0 });
    const receipt = await ava.rpc('record_policy_commission_receipt', { p_request_id: randomUUID(),
      p_installment_id: page.data.rows[0].installment_id, p_amount_cents: 12345, p_received_on: '2026-03-20', p_reference: null });
    assert.equal(receipt.status, 200, JSON.stringify(receipt.error));
    const history = await ava.rpc('get_my_commission_receipt_list', { ...READS.get_my_commission_receipt_list, p_carrier: 'synthetic life' });
    assert.equal(history.status, 200); assert.equal(history.data.totals.received_cents, 12345);
    const after = (await ava.rpc('get_my_commission_breakdown', MARCH)).data;
    assert.equal(after.carriers.find((c) => c.carrier === 'Synthetic Life').received_cents, 12345);
    const released = await ava.rpc('get_my_commission_policies', { p_setup: 'all', p_limit: 25, p_offset: 0 });
    assert.equal(released.status, 200); assert.equal(released.data.total_count, 3);
    const releasedHistory = await ava.rpc('get_my_commission_receipts', { p_period: 'all', p_include_voided: true, p_limit: 25, p_offset: 0 });
    assert.equal(releasedHistory.status, 200); assert.equal(releasedHistory.data.totals.received_cents, 12345);
  });
  check('goals over HTTP: none until set, set and edit one month, clear explicitly, owner isolation', async () => {
    assert.equal((await ava.rpc('get_my_commission_goal', { p_month: '2026-03-01' })).data.target_cents, null);
    assert.equal((await ava.rpc('set_my_commission_goal', { p_month: '2026-03-01', p_target_cents: 500000 })).data.target_cents, 500000);
    assert.equal((await ava.rpc('set_my_commission_goal', { p_month: '2026-04-01', p_target_cents: 700000 })).data.target_cents, 700000);
    assert.equal((await ava.rpc('set_my_commission_goal', { p_month: '2026-03-01', p_target_cents: 600000 })).data.target_cents, 600000);
    assert.equal((await ava.rpc('get_my_commission_goal', { p_month: '2026-04-01' })).data.target_cents, 700000);
    const ben = as(12);
    assert.equal((await ben.rpc('get_my_commission_goal', { p_month: '2026-03-01' })).data.target_cents, null);
    assert.equal((await ben.from('policy_commission_goals').select('*')).data.length, 0);
    assert.equal((await as(13).from('policy_commission_goals').select('*')).data.length, 0);
    const cleared = await ava.rpc('clear_my_commission_goal', { p_month: '2026-04-01' });
    assert.equal(cleared.status, 200); assert.equal(cleared.data.cleared, true);
    assert.equal((await ava.rpc('get_my_commission_goal', { p_month: '2026-03-01' })).data.target_cents, 600000);
    const own = await ava.from('policy_commission_goals').select('month,target_cents');
    assert.deepEqual(own.data, [{ month: '2026-03-01', target_cents: 600000 }]);
  });
  check("direct table writes are limited to the caller's own row and the target column", async () => {
    const other = await ava.from('policy_commission_goals').insert({ organization_id: id(1), owner_id: id(12), month: '2026-05-01', target_cents: 1 });
    assert.equal(other.status, 403); assert.equal(other.error.code, '42501');
    const move = await ava.from('policy_commission_goals').update({ month: '2026-06-01' }).eq('month', '2026-03-01');
    assert.equal(move.status, 403); assert.equal(move.error.code, '42501');
    const zero = await ava.from('policy_commission_goals').insert({ organization_id: id(1), owner_id: id(11), month: '2026-05-01', target_cents: 0 });
    assert.equal(zero.status, 400); assert.equal(zero.error.code, '23514');
  });
  check('invalid input is 400 22023 with a human message; no access 403; unset time zone 55000', async () => {
    const bad = await ava.rpc('set_my_commission_goal', { p_month: '2026-03-15', p_target_cents: 100 });
    assert.equal(bad.status, 400); assert.equal(bad.error.code, '22023'); assert.equal(bad.error.message, 'Choose a calendar month');
    const amount = await ava.rpc('set_my_commission_goal', { p_month: '2026-03-01', p_target_cents: 0 });
    assert.equal(amount.status, 400); assert.equal(amount.error.message, 'Enter a goal above $0.00 (up to $1,000,000.00).');
    const both = await ava.rpc('get_my_commission_policy_list', { ...READS.get_my_commission_policy_list, p_carrier: 'X', p_carrier_unknown: true });
    assert.equal(both.status, 400); assert.equal(both.error.code, '22023');
    await admin`insert into role_permissions(organization_id, role, permissions)
                values (${id(1)}, 'Agent', '{"c":[{"name":"View Own Commission Percentage","agent":false}]}')`;
    try {
      const r = await ava.rpc('get_my_commission_breakdown');
      assert.equal(r.status, 403); assert.equal(r.error.code, '42501');
      const g = await ava.rpc('set_my_commission_goal', { p_month: '2026-03-01', p_target_cents: 100 });
      assert.equal(g.status, 403); assert.equal(g.error.code, '42501');
    } finally {
      await admin`delete from role_permissions where organization_id = ${id(1)} and role = 'Agent'`;
    }
    await admin`update company_settings set timezone = null where organization_id = ${id(1)}`;
    try {
      const r = await ava.rpc('get_my_commission_breakdown');
      assert.equal(r.error.code, '55000');
    } finally {
      await admin`update company_settings set timezone = 'America/Los_Angeles' where organization_id = ${id(1)}`;
    }
  });
  check('helper schema and its functions are not exposed', async () => {
    for (const fn of ['carrier_key', 'category', 'comparison', 'goal_month', 'policy_category', 'policy_carrier']) {
      const r = await ava.rpc(fn, {});
      assert.equal(r.status, 404, fn); assert.equal(r.error.code, 'PGRST202');
    }
    const openapi = await (await fetch(`${base}/`, { headers: { Authorization: `Bearer ${jwt({ role: 'authenticated', sub: id(11) })}` } })).text();
    assert.ok(openapi.includes('/rpc/get_my_commission_breakdown') && !openapi.includes('policy_commission_insights'));
  });
  check('reads write nothing (opening a month creates no goal)', async () => {
    const before = (await admin`select coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0)::bigint n from pg_stat_user_tables
                                 where relname like 'policy_commission_%'`)[0].n;
    for (const [fn, args] of Object.entries({ ...READS, get_my_commission_goal: { p_month: '2026-09-01' } })) {
      assert.equal((await ava.rpc(fn, args)).status, 200, fn);
    }
    await new Promise((r) => setTimeout(r, 1200));
    await admin`select pg_stat_clear_snapshot()`;
    const after = (await admin`select coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0)::bigint n from pg_stat_user_tables
                                where relname like 'policy_commission_%'`)[0].n;
    assert.equal(after, before);
    assert.equal((await admin`select count(*)::int n from policy_commission_goals where month = '2026-09-01'`)[0].n, 0);
  });

  let failed = 0;
  for (const [name, fn] of results) {
    try { await fn(); console.log(`  ok  ${name}`); } catch (e) { failed += 1; console.log(`  FAIL ${name}\n${e.stack}`); }
  }
  if (failed) throw new Error(`${failed} commissions insights PostgREST check(s) failed`);

  const N = Number(process.env.PC_HTTP_SAMPLES ?? 15);
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const rows = [];
  for (const [fn, args] of Object.entries(READS)) {
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
  console.log(`PASS commissions insights PostgREST integration (${results.length} checks)`);
} finally {
  if (child) child.kill('SIGTERM');
  await admin.end();
  await new Promise((r) => setTimeout(r, 200));
  await cluster.unsafe(`DROP ROLE IF EXISTS ${AUTHENTICATOR}`).catch(() => {});
  await cluster.end();
}
