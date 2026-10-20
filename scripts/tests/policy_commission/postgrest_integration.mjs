// Phase 2A policy commission tracking: real PostgREST 12 + @supabase/supabase-js against a DISPOSABLE local database
// prepared by scripts/run_policy_commission_tests.sh (fixture, harness and migration). Synthetic data only.
//   PGURL=postgres://postgres@127.0.0.1:<port> DB_URL=<PGURL>/<db> POSTGREST_BIN=/path/to/postgrest node <this file>
// Proves the HTTP contract: companion responses, PT409 → HTTP 409, error codes, permission denials, no direct table
// writes, private helpers not exposed, status reads, expected windows and Edit dates (20261020040000), and HTTP save
// timing (legacy writer vs companion).
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

const AUTHENTICATOR = 'pc_test_authenticator';
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
      PATH: process.env.PATH,
      PGRST_DB_URI: dbUri.toString(),
      PGRST_DB_SCHEMAS: 'public',
      PGRST_DB_ANON_ROLE: 'anon',
      PGRST_JWT_SECRET: secret,
      PGRST_SERVER_HOST: '127.0.0.1',
      PGRST_SERVER_PORT: String(port),
      PGRST_DB_POOL: '6',
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
  // supabase-js addresses <url>/rest/v1; PostgREST serves at its root.
  const restFetch = (input, init) => fetch(String(input).replace(`${base}/rest/v1`, base), init);
  function as(n) {
    const headers = {};
    // Like Supabase's anon key, an unauthenticated caller still presents a JWT with role anon.
    if (n === 'service_role' || n === 'anon') headers.Authorization = `Bearer ${jwt({ role: n })}`;
    else {
      const p = profiles[id(n)];
      headers.Authorization = `Bearer ${jwt({ sub: p.id, role: 'authenticated', is_super_admin: p.is_super_admin,
        app_metadata: { organization_id: p.organization_id, role: p.role } })}`;
    }
    return createClient(base, 'pc-test-anon-key', { global: { fetch: restFetch, headers }, auth: { persistSession: false, autoRefreshToken: false } });
  }
  const payload = (...slots) => ({ v: 'policy-commission-v1', slots });
  const grid = (await admin`select revision from comp_grids where id = ${id(500)}`)[0].revision;
  const termSlot = (slot = 'primary', agent = 11) => ({ slot, credited_agent_id: id(agent), grid_id: id(500), grid_revision: Number(grid),
    product_id: id(501), variant_id: id(511), insured_age: 35, term_years: 20, contract_level: 100, rate_percent: '95.50',
    monthly_premium: '50.00', first_year_cents: 57300, advance_cents: 42975 });
  const feSlot = (slot) => ({ slot, credited_agent_id: id(11), grid_id: id(500), grid_revision: Number(grid), product_id: id(502),
    variant_id: id(512), insured_age: 62, term_years: null, contract_level: 100, rate_percent: '120.00', monthly_premium: '30.00',
    first_year_cents: 43200, advance_cents: 32400 });
  const client = (first, agent = 11) => ({ first_name: first, last_name: 'Synthetic', phone: '5555550100', email: '', policy_type: 'Term',
    carrier: 'Synthetic Life', policy_number: `SYN-${first}`, premium: 50, face_amount: 100000, sold_date: '2026-10-01',
    effective_date: '2026-11-01', assigned_agent_id: id(agent) });
  const ava = as(11);
  const createArgs = { p_request_id: randomUUID(), p_expected_org: id(1), p_client: client('Http'), p_record_sale: true,
    p_commission: payload(termSlot()) };

  check('anon cannot call a companion (401, 42501)', async () => {
    const r = await as('anon').rpc('create_client_with_sale_handoff', createArgs);
    assert.equal(r.status, 401); assert.equal(r.error.code, '42501');
  });
  check('service_role cannot call a companion or read commission rows', async () => {
    const r = await as('service_role').rpc('create_client_with_sale_handoff', createArgs);
    assert.equal(r.status, 403); assert.equal(r.error.code, '42501');
    const t = await as('service_role').from('policy_commission_estimates').select('id');
    assert.equal(t.status, 403); assert.equal(t.error.code, '42501');
  });
  let saved;
  check('companion saves the sale and records the estimate', async () => {
    const r = await ava.rpc('create_client_with_sale_handoff', createArgs);
    assert.equal(r.status, 200, JSON.stringify(r.error)); saved = r.data;
    assert.equal(r.data.idempotent, false);
    assert.equal(r.data.win_ids.length, 1);
    assert.deepEqual(r.data.commission.slots.map((s) => s.status), ['recorded']);
  });
  check('a byte-identical replay returns the stored sale and commission outcome', async () => {
    const r = await ava.rpc('create_client_with_sale_handoff', createArgs);
    assert.equal(r.status, 200); assert.equal(r.data.idempotent, true);
    assert.deepEqual(r.data.win_ids, saved.win_ids); assert.deepEqual(r.data.commission, saved.commission);
  });
  check('a committed-operation conflict is HTTP 409 PT409', async () => {
    const r = await ava.rpc('create_client_with_sale_handoff', { ...createArgs, p_client: client('HttpChanged') });
    assert.equal(r.status, 409); assert.equal(r.error.code, 'PT409');
    assert.equal(r.error.message, 'This request already saved different details; refresh the client before editing');
    assert.equal(r.error.details, 'sale_operation_conflict');
  });
  check('other writer errors are unchanged', async () => {
    const r = await ava.rpc('create_client_with_sale_handoff', { ...createArgs, p_request_id: randomUUID(), p_expected_org: id(2) });
    assert.equal(r.status, 403); assert.equal(r.error.code, '42501');
    assert.equal(r.error.message, 'Client organization or owner changed; refresh before saving');
    const bad = await ava.rpc('create_client_with_sale_handoff', { ...createArgs, p_request_id: randomUUID(), p_client: { ...client('X'), first_name: '' } });
    assert.equal(bad.status, 400); assert.equal(bad.error.code, '22023');
  });
  check('legacy writer remains callable unchanged', async () => {
    const r = await ava.rpc('create_client_with_sale', { p_request_id: randomUUID(), p_expected_org: id(1), p_client: client('Legacy'), p_record_sale: true });
    assert.equal(r.status, 200); assert.equal(r.data.commission, undefined);
  });
  check('no direct table writes; private helpers are not exposed', async () => {
    for (const table of ['policy_commission_handoffs', 'policy_commission_captures', 'policy_commission_estimates',
      'policy_commission_installments', 'policy_commission_receipts', 'policy_commission_events']) {
      const ins = await ava.from(table).insert({ organization_id: id(1) });
      assert.equal(ins.status, 403, table); assert.equal(ins.error.code, '42501');
      const upd = await ava.from(table).update({ organization_id: id(1) }).eq('organization_id', id(1));
      assert.equal(upd.status, 403, table);
      const del = await ava.from(table).delete().eq('organization_id', id(1));
      assert.equal(del.status, 403, table);
    }
    for (const fn of ['policy_commission_handoff', 'policy_sale_commission_step', 'policy_commission_grid_facts', 'policy_commission_toggle',
      'policy_commission_expected_schedule', 'policy_commission_business_day_after']) {
      const r = await ava.rpc(fn, {});
      assert.equal(r.status, 404, fn); assert.equal(r.error.code, 'PGRST202');
    }
    const openapi = await (await fetch(`${base}/`, { headers: { Authorization: `Bearer ${jwt({ role: 'authenticated', sub: id(11) })}` } })).text();
    assert.ok(!openapi.includes('/rpc/policy_commission_') && !openapi.includes('/rpc/policy_sale_commission_step'));
    assert.ok(openapi.includes('/rpc/create_client_with_sale_handoff'));
  });
  let estimate;
  check('contact read: estimate, schedule and access for the seller; hidden from other agents', async () => {
    const r = await ava.rpc('get_client_policy_commissions', { p_client_id: saved.client_id });
    assert.equal(r.status, 200);
    const [policy] = r.data.policies;
    assert.equal(policy.state, 'recorded'); assert.equal(policy.access, 'write'); estimate = policy.estimate;
    assert.deepEqual(estimate.installments.map((i) => i.expected_cents), [42975, 4775, 4775, 4775]);
    // Assumed from the effective date (Sunday 2026-11-01): 1st–3rd Federal Reserve business day after each premium date.
    assert.deepEqual([estimate.schedule_start_on, estimate.schedule_start_source, estimate.schedule_assumed, estimate.schedule_frequency,
      estimate.schedule_convention], ['2026-11-01', 'effective_date', true, null, 'premium_plus_1_3_fed_business_days_v1']);
    assert.deepEqual(estimate.installments.map((i) => [i.timing_precision, i.expected_on, i.expected_until, i.timing_source]), [
      ['date', '2026-11-02', '2026-11-04', 'schedule_basis'], ['date', '2027-08-02', '2027-08-04', 'schedule_basis'],
      ['date', '2027-09-02', '2027-09-07', 'schedule_basis'], ['date', '2027-10-04', '2027-10-06', 'schedule_basis']]);
    assert.equal(policy.basis.payment_frequency, null);
    const other = await as(12).rpc('get_client_policy_commissions', { p_client_id: saved.client_id });
    assert.equal(other.status, 404); assert.equal(other.error.code, 'PT404');
    const rows = await as(12).from('policy_commission_estimates').select('id');
    assert.equal(rows.status, 200); assert.deepEqual(rows.data, []);
    const own = await ava.from('policy_commission_estimates').select('id');
    assert.equal(own.data.length, 1);
  });
  check('receipts, voids and stale revisions over HTTP', async () => {
    const receiptArgs = { p_request_id: randomUUID(), p_installment_id: estimate.installments[0].id, p_amount_cents: 42975,
      p_received_on: '2026-10-19', p_reference: 'Statement 7' };
    const r = await ava.rpc('record_policy_commission_receipt', receiptArgs);
    assert.equal(r.status, 200, JSON.stringify(r.error)); assert.equal(r.data.idempotent, false);
    const again = await ava.rpc('record_policy_commission_receipt', receiptArgs);
    assert.equal(again.data.receipt_id, r.data.receipt_id); assert.equal(again.data.idempotent, true);
    const invalid = await ava.rpc('record_policy_commission_receipt', { ...receiptArgs, p_request_id: randomUUID(), p_amount_cents: 0 });
    assert.equal(invalid.status, 400); assert.equal(invalid.error.code, '22023');
    const stale = await ava.rpc('void_policy_commission_receipt', { p_request_id: randomUUID(), p_receipt_id: r.data.receipt_id,
      p_expected_revision: 1, p_reason: 'Stale tab', p_replacement: null });
    assert.equal(stale.status, 409); assert.equal(stale.error.code, 'PT409');
    const tl = await as(14).rpc('set_policy_commission_hold', { p_request_id: randomUUID(), p_estimate_id: estimate.id,
      p_expected_revision: 2, p_on_hold: true, p_reason: 'Leader' });
    assert.equal(tl.status, 403); assert.equal(tl.error.code, '42501');
  });
  check('Edit dates and per-payment dates over HTTP', async () => {
    const read = async () => (await ava.rpc('get_client_policy_commissions', { p_client_id: saved.client_id })).data.policies[0].estimate;
    let current = await read();
    const basis = await ava.rpc('set_policy_commission_schedule_basis', { p_request_id: randomUUID(), p_estimate_id: current.id,
      p_expected_revision: current.state_revision, p_start_on: '2026-11-15', p_source: 'manual' });
    assert.equal(basis.status, 200, JSON.stringify(basis.error));
    current = await read();
    assert.deepEqual([current.schedule_start_on, current.schedule_start_source, current.schedule_assumed], ['2026-11-15', 'manual', false]);
    assert.deepEqual(current.installments.map((i) => `${i.expected_on}..${i.expected_until}`),
      ['2026-11-16..2026-11-18', '2027-08-16..2027-08-18', '2027-09-16..2027-09-20', '2027-10-18..2027-10-20']);
    const manual = await ava.rpc('set_policy_commission_installment_timing', { p_request_id: randomUUID(), p_installment_id: current.installments[1].id,
      p_expected_revision: current.state_revision, p_precision: 'unknown', p_expected_on: null });
    assert.equal(manual.status, 200, JSON.stringify(manual.error));
    current = await read();
    assert.deepEqual([current.installments[1].timing_precision, current.installments[1].timing_source], ['unknown', 'manual']);
    const automatic = await ava.rpc('set_policy_commission_installment_timing', { p_request_id: randomUUID(),
      p_installment_id: current.installments[1].id, p_expected_revision: current.state_revision, p_precision: 'automatic', p_expected_on: null });
    assert.equal(automatic.status, 200, JSON.stringify(automatic.error));
    current = await read();
    assert.deepEqual([current.installments[1].expected_on, current.installments[1].expected_until], ['2027-08-16', '2027-08-18']);
    const invalid = await ava.rpc('set_policy_commission_installment_timing', { p_request_id: randomUUID(),
      p_installment_id: current.installments[1].id, p_expected_revision: current.state_revision, p_precision: 'window', p_expected_on: null });
    assert.equal(invalid.status, 400); assert.equal(invalid.error.code, '22023');
    const leader = await as(14).rpc('set_policy_commission_schedule_basis', { p_request_id: randomUUID(), p_estimate_id: current.id,
      p_expected_revision: current.state_revision, p_start_on: null, p_source: null });
    assert.equal(leader.status, 403); assert.equal(leader.error.code, '42501');
  });
  check('operation status read', async () => {
    const r = await ava.rpc('get_policy_sale_operation_status', { p_kind: 'create', p_request_id: createArgs.p_request_id, p_lead_id: null,
      p_sale_args: { p_client: createArgs.p_client, p_record_sale: true } });
    assert.equal(r.status, 200);
    assert.deepEqual({ state: r.data.state, same: r.data.same_payload, mine: r.data.this_request }, { state: 'committed', same: true, mine: true });
    const none = await ava.rpc('get_policy_sale_operation_status', { p_kind: 'record', p_request_id: randomUUID(), p_lead_id: null, p_sale_args: null });
    assert.deepEqual(none.data, { state: 'not_found' });
  });
  check('conversion with additional rows and a conversion conflict', async () => {
    const [lead] = await admin`insert into leads(organization_id, user_id, assigned_agent_id, first_name, last_name)
      values (${id(1)}, ${id(11)}, ${id(11)}, 'HttpLead', 'Synthetic') returning id`;
    const row = randomUUID();
    const args = { p_request_id: randomUUID(), p_lead_id: lead.id, p_expected_org: id(1), p_campaign_id: null,
      p_client: { ...client('HttpLead'), custom_fields: { additional_policies: [{ policyId: row, policyType: 'Final Expense',
        carrier: 'Synthetic Life', premiumAmount: '30.00', soldDate: '2026-10-01' }] } },
      p_commission: payload(termSlot(), feSlot(row)) };
    const r = await ava.rpc('convert_lead_to_client_with_sales_handoff', args);
    assert.equal(r.status, 200, JSON.stringify(r.error));
    assert.deepEqual(r.data.commission.slots.map((s) => s.status), ['recorded', 'recorded']);
    const other = await as(13).rpc('convert_lead_to_client_with_sales_handoff', { ...args, p_request_id: randomUUID() });
    assert.equal(other.status, 409); assert.equal(other.error.code, 'PT409');
    const otherRequest = await ava.rpc('convert_lead_to_client_with_sales_handoff', { ...args, p_request_id: randomUUID() });
    assert.equal(otherRequest.data.commission.status, 'other_operation');
  });

  let failed = 0;
  for (const [name, fn] of results) {
    try { await fn(); console.log(`  ok  ${name}`); } catch (e) { failed += 1; console.log(`  FAIL ${name}\n${e.stack}`); }
  }
  if (failed) throw new Error(`${failed} PostgREST integration check(s) failed`);

  // HTTP save timing: the unchanged writer vs the companion, fresh request each time (median of N).
  const N = Number(process.env.PC_HTTP_SAMPLES ?? 15);
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  async function time(fn) { const t = performance.now(); const r = await fn(); assert.equal(r.status, 200, JSON.stringify(r.error)); return performance.now() - t; }
  const rows = [];
  for (const [label, legacy, companion] of [
    ['create, 1 policy', (i) => ava.rpc('create_client_with_sale', { p_request_id: randomUUID(), p_expected_org: id(1), p_client: client(`L${i}`), p_record_sale: true }),
      (i) => ava.rpc('create_client_with_sale_handoff', { p_request_id: randomUUID(), p_expected_org: id(1), p_client: client(`C${i}`), p_record_sale: true, p_commission: payload(termSlot()) })],
  ]) {
    for (let i = 0; i < 3; i += 1) { await legacy(`w${i}`); await companion(`w${i}`); }
    const a = [], b = [];
    for (let i = 0; i < N; i += 1) { a.push(await time(() => legacy(i))); b.push(await time(() => companion(i))); }
    rows.push({ label, legacy_ms: median(a).toFixed(1), companion_ms: median(b).toFixed(1), delta_ms: (median(b) - median(a)).toFixed(1) });
  }
  for (const n of [1, 5, 25]) {
    const leads = await admin`insert into leads(organization_id, user_id, assigned_agent_id, first_name, last_name)
      select ${id(1)}, ${id(11)}, ${id(11)}, 'Timing', 'Synthetic' from generate_series(1, ${2 * (N + 3)}) returning id`;
    const convertClient = (rowsIds) => ({ ...client('Timing'), custom_fields: { additional_policies: rowsIds.map((policyId) => ({ policyId,
      policyType: 'Final Expense', carrier: 'Synthetic Life', premiumAmount: '30.00', soldDate: '2026-10-01' })) } });
    const legacy = (lead) => ava.rpc('convert_lead_to_client_with_sales', { p_lead_id: lead, p_expected_org: id(1),
      p_client: convertClient(Array.from({ length: n - 1 }, () => randomUUID())), p_campaign_id: null });
    const companion = (lead) => {
      const ids = Array.from({ length: n - 1 }, () => randomUUID());
      return ava.rpc('convert_lead_to_client_with_sales_handoff', { p_request_id: randomUUID(), p_lead_id: lead, p_expected_org: id(1),
        p_client: convertClient(ids), p_campaign_id: null, p_commission: payload(termSlot(), ...ids.map(feSlot)) });
    };
    const a = [], b = [];
    for (let i = 0; i < 3; i += 1) { await legacy(leads[2 * i].id); await companion(leads[2 * i + 1].id); }
    for (let i = 3; i < N + 3; i += 1) { a.push(await time(() => legacy(leads[2 * i].id))); b.push(await time(() => companion(leads[2 * i + 1].id))); }
    rows.push({ label: `convert, ${n} polic${n === 1 ? 'y' : 'ies'}`, legacy_ms: median(a).toFixed(1), companion_ms: median(b).toFixed(1),
      delta_ms: (median(b) - median(a)).toFixed(1) });
  }
  const recorded = (await admin`select count(*)::int n from policy_commission_captures where status <> 'recorded'`)[0].n;
  console.log(`PostgREST ${version}; HTTP median of ${N} (warm, sequential):`);
  console.table(rows);
  assert.equal(recorded, 0, 'every timed capture was recorded within the budget');
  console.log(`PASS PostgREST integration (${results.length} checks)`);
} finally {
  if (child) child.kill('SIGTERM');
  await admin.end();
  await new Promise((r) => setTimeout(r, 200));
  await cluster.unsafe(`DROP ROLE IF EXISTS ${AUTHENTICATOR}`).catch(() => {});
  await cluster.end();
}
