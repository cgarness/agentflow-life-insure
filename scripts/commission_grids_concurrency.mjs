#!/usr/bin/env node
// =====================================================================================================
// Commission grids — deterministic concurrency proofs (scripts/run_commission_grids_tests.sh).
// DISPOSABLE LOCAL PostgreSQL ONLY (AGENT_RULES invariant #28). Synthetic data only.
//
// Every scenario uses independent sessions. A session that must block is PROVEN to be waiting on a
// lock through pg_stat_activity (wait_event_type = 'Lock') before the session it waits on finishes —
// no sleep stands in for a lock. Client operations run as the real non-bypass `authenticated` role with
// JWT claims; privileged writers run as the table owner (as the reviewed import/migrations would).
// Production isolation level (READ COMMITTED) is used throughout.
// =====================================================================================================
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

const url = process.env.COMP_DB_URL;
if (!url) { console.error('COMP_DB_URL is required'); process.exit(2); }
const host = new URL(url).hostname;
if (host !== '127.0.0.1' && host !== 'localhost') {
  console.error(`REFUSING: host must be 127.0.0.1 or localhost, got ${host} (AGENT_RULES invariant #28)`);
  process.exit(2);
}

const owner = postgres(url, { max: 1, onnotice: () => {} });
// Separate connection for claim lookups and lock polling, so neither waits behind an owner transaction.
const meta = postgres(url, { max: 1, onnotice: () => {} });
const opened = [];
const session = (name) => {
  const s = postgres(url, { max: 1, onnotice: () => {}, connection: { application_name: name } });
  opened.push(s);
  return s;
};

let failures = 0;
const ok = (label) => console.log(`   ok   ${label}`);
const fail = (label, detail) => { failures += 1; console.log(`   FAIL ${label}: ${detail}`); };
const expect = (label, condition, detail = '') => (condition ? ok(label) : fail(label, detail));

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

async function waitForLock(appName) {
  for (let i = 0; i < 400; i += 1) {
    const [r] = await meta`
      SELECT count(*)::int AS n FROM pg_stat_activity
       WHERE application_name = ${appName} AND wait_event_type = 'Lock'`;
    if (r.n > 0) return true;
    await new Promise((res) => setTimeout(res, 25));
  }
  return false;
}

async function claimsFor(profileId) {
  const [p] = await meta`SELECT id, organization_id, role, coalesce(is_super_admin, false) AS sup FROM public.profiles WHERE id = ${profileId}`;
  return JSON.stringify({
    sub: p.id, role: 'authenticated', is_super_admin: p.sup,
    app_metadata: { organization_id: p.organization_id, role: p.role },
  });
}

async function asUser(tx, profileId) {
  const claims = await claimsFor(profileId);
  await tx.unsafe('SET LOCAL ROLE authenticated');
  await tx`SELECT set_config('request.jwt.claims', ${claims}, true)`;
}

// Run `work` in a transaction on its own session; the transaction stays open (locks held) until the
// returned release() is called. `started` resolves once `work` has returned inside the open transaction.
function hold(name, work) {
  const sql = session(name);
  const started = deferred();
  const gate = deferred();
  const done = sql.begin(async (tx) => {
    const value = await work(tx);
    started.resolve(value);
    await gate.promise;
    return value;
  });
  done.catch((e) => started.resolve({ error: e }));
  return { started: started.promise, release: () => gate.resolve(), done };
}

// Run `work` in a transaction that is expected to block; resolves to { value } or { error }.
function attempt(name, work) {
  const sql = session(name);
  return sql.begin(async (tx) => work(tx)).then((value) => ({ value }), (error) => ({ error }));
}

// ── Fixtures ──────────────────────────────────────────────────────────────────────────────────────────
async function agency(label, roles = ['Admin', 'Admin', 'Agent']) {
  const org = randomUUID();
  await owner`INSERT INTO public.organizations (id, name) VALUES (${org}, ${'Synthetic ' + label + ' ' + org.slice(0, 8)})`;
  const people = [];
  for (const role of roles) {
    const id = randomUUID();
    await owner`INSERT INTO public.profiles (id, organization_id, role, status, commission_level)
                VALUES (${id}, ${org}, ${role}, 'Active', '100')`;
    people.push(id);
  }
  return { org, people };
}

// A shared grid written as the owner (the way the reviewed import writes it): one product, one variant,
// rates at 120 and 100 (100 is an explicit zero).
async function sharedGrid(name) {
  const grid = randomUUID(); const product = randomUUID(); const variant = randomUUID();
  await owner.begin(async (tx) => {
    await tx`INSERT INTO public.comp_grids (id, organization_id, name, effective_date, contract_levels, origin)
             VALUES (${grid}, NULL, ${name}, '2025-01-01', ${[120, 110, 100, 90, 80, 70]}, 'agentflow_reference')`;
    await tx`INSERT INTO public.comp_products (id, grid_id, organization_id, category, carrier, product_name)
             VALUES (${product}, ${grid}, NULL, 'whole_life', 'Synthetic Carrier', 'Synthetic Product')`;
    await tx`INSERT INTO public.comp_product_variants (id, grid_id, product_id, organization_id, label, min_age, max_age)
             VALUES (${variant}, ${grid}, ${product}, NULL, '0-75', 0, 75)`;
    await tx`INSERT INTO public.comp_rates (grid_id, variant_id, organization_id, contract_level, rate_percent)
             VALUES (${grid}, ${variant}, NULL, 120, 95.5), (${grid}, ${variant}, NULL, 100, 0)`;
  });
  return { grid, product, variant };
}

async function op(profileId, query) {
  return owner.begin(async (tx) => { await asUser(tx, profileId); return query(tx); });
}

const settingsOf = async (org) => (await owner`SELECT calculator_grid_id FROM public.organization_comp_settings WHERE organization_id = ${org}`)[0]?.calculator_grid_id ?? null;
const accessOf = async (org) => (await owner`SELECT grid_id FROM public.organization_comp_grids WHERE organization_id = ${org} ORDER BY grid_id`).map((r) => r.grid_id);

// ── Scenarios ─────────────────────────────────────────────────────────────────────────────────────────
async function firstUseEnableRace() {
  console.log('\n-- 1. first-time enable/select with no settings row (two admins of one agency)');
  const g = await sharedGrid('S1 G'); const h = await sharedGrid('S1 H');
  const c = await agency('S1');
  const t1 = hold('cc_s1_t1', async (tx) => { await asUser(tx, c.people[0]); return (await tx`SELECT public.comp_enable_shared_grid(${g.grid}) AS r`)[0].r; });
  await t1.started;
  const t2 = attempt('cc_s1_t2', async (tx) => { await asUser(tx, c.people[1]); return (await tx`SELECT public.comp_enable_shared_grid(${h.grid}) AS r`)[0].r; });
  expect('second admin waits for the first-use settings row', await waitForLock('cc_s1_t2'));
  t1.release(); await t1.done;
  const r2 = await t2;
  expect('second enable succeeds', !r2.error, r2.error?.message);
  expect('second enable keeps the first selection', r2.value?.kept_existing_selection === true && r2.value?.calculator_grid_id === g.grid, JSON.stringify(r2.value));
  expect('agency selects the first grid', (await settingsOf(c.org)) === g.grid);
  expect('both grids enabled', JSON.stringify(await accessOf(c.org)) === JSON.stringify([g.grid, h.grid].sort()));
}

async function privateGrid(adminId) {
  return op(adminId, async (tx) => (await tx`SELECT public.comp_create_private_grid('blank', 'Private', '2025-03-01') AS r`)[0].r.grid_id);
}

async function overlappingVariants() {
  console.log('\n-- 2. two overlapping variants written concurrently (table level, privileged writers)');
  const a = await agency('S2');
  const grid = await privateGrid(a.people[0]);
  const product = randomUUID();
  await owner`INSERT INTO public.comp_products (id, grid_id, organization_id, category, carrier, product_name)
              VALUES (${product}, ${grid}, ${a.org}, 'whole_life', 'Synthetic Carrier', 'Overlap Product')`;
  const t1 = hold('cc_s2_t1', async (tx) => {
    await tx`INSERT INTO public.comp_product_variants (grid_id, product_id, organization_id, label, min_age, max_age)
             VALUES (${grid}, ${product}, ${a.org}, '0-50', 0, 50)`;
    await tx.unsafe('SET CONSTRAINTS ALL IMMEDIATE');
  });
  await t1.started;
  const t2 = attempt('cc_s2_t2', async (tx) => {
    await tx`INSERT INTO public.comp_product_variants (grid_id, product_id, organization_id, label, min_age, max_age)
             VALUES (${grid}, ${product}, ${a.org}, '40-60', 40, 60)`;
  });
  expect('second writer waits on the product lock at commit', await waitForLock('cc_s2_t2'));
  t1.release(); await t1.done;
  const r2 = await t2;
  expect('second (overlapping) writer is refused', r2.error?.code === '23P01', r2.error?.message ?? 'committed');
  const [n] = await owner`SELECT count(*)::int AS n FROM public.comp_product_variants WHERE product_id = ${product}`;
  expect('only the first variant persists', n.n === 1, `count ${n.n}`);

  // Control: non-overlapping concurrent writers both commit.
  const t3 = hold('cc_s2_t3', async (tx) => {
    await tx`INSERT INTO public.comp_product_variants (grid_id, product_id, organization_id, label, min_age, max_age)
             VALUES (${grid}, ${product}, ${a.org}, '51-60', 51, 60)`;
    await tx.unsafe('SET CONSTRAINTS ALL IMMEDIATE');
  });
  await t3.started;
  const t4 = attempt('cc_s2_t4', async (tx) => {
    await tx`INSERT INTO public.comp_product_variants (grid_id, product_id, organization_id, label, min_age, max_age)
             VALUES (${grid}, ${product}, ${a.org}, '61-70', 61, 70)`;
  });
  expect('control writer also waits on the product lock', await waitForLock('cc_s2_t4'));
  t3.release(); await t3.done;
  const r4 = await t4;
  expect('non-overlapping concurrent writers both commit', !r4.error, r4.error?.message);
}

async function rateVersusLevelRemoval() {
  console.log('\n-- 3. rate write racing contract-level removal');
  const a = await agency('S3');
  const grid = await privateGrid(a.people[0]);
  const product = randomUUID(); const variant = randomUUID();
  await owner`INSERT INTO public.comp_products (id, grid_id, organization_id, category, carrier, product_name)
              VALUES (${product}, ${grid}, ${a.org}, 'iul', 'Synthetic Carrier', 'Level Product')`;
  await owner`INSERT INTO public.comp_product_variants (id, grid_id, product_id, organization_id, label)
              VALUES (${variant}, ${grid}, ${product}, ${a.org}, '')`;
  const without70 = [145, 140, 135, 130, 125, 120, 115, 110, 105, 100, 95, 90, 85, 80, 75, 65];

  // 3a: rate first, level removal second.
  const t1 = hold('cc_s3_t1', async (tx) => {
    await tx`INSERT INTO public.comp_rates (grid_id, variant_id, organization_id, contract_level, rate_percent)
             VALUES (${grid}, ${variant}, ${a.org}, 70, 12.5)`;
  });
  await t1.started;
  const t2 = attempt('cc_s3_t2', async (tx) => tx`UPDATE public.comp_grids SET contract_levels = ${without70} WHERE id = ${grid}`);
  expect('level removal waits on the grid row', await waitForLock('cc_s3_t2'));
  t1.release(); await t1.done;
  const r2 = await t2;
  expect('level removal refused once the rate committed', r2.error?.code === '23514', r2.error?.message ?? 'committed');

  // 3b: level removal first, rate second.
  await owner`DELETE FROM public.comp_rates WHERE grid_id = ${grid}`;
  const t3 = hold('cc_s3_t3', async (tx) => tx`UPDATE public.comp_grids SET contract_levels = ${without70} WHERE id = ${grid}`);
  await t3.started;
  const t4 = attempt('cc_s3_t4', async (tx) => tx`
    INSERT INTO public.comp_rates (grid_id, variant_id, organization_id, contract_level, rate_percent)
    VALUES (${grid}, ${variant}, ${a.org}, 70, 12.5)`);
  expect('rate write waits on the grid row', await waitForLock('cc_s3_t4'));
  t3.release(); await t3.done;
  const r4 = await t4;
  expect('rate at the removed level refused', r4.error?.code === '23514', r4.error?.message ?? 'committed');

  // 3c: two agency admins through operations: serialized, the stale one gets PT409.
  const [g] = await owner`SELECT revision FROM public.comp_grids WHERE id = ${grid}`;
  const t5 = hold('cc_s3_t5', async (tx) => {
    await asUser(tx, a.people[0]);
    return (await tx`SELECT public.comp_save_grid_changes(${grid}, ${g.revision},
      ${tx.json({ rates: [{ variant_id: variant, contract_level: 80, rate_percent: '10' }] })}) AS r`)[0].r;
  });
  await t5.started;
  const t6 = attempt('cc_s3_t6', async (tx) => {
    await asUser(tx, a.people[1]);
    return tx`SELECT public.comp_save_grid_changes(${grid}, ${g.revision},
      ${tx.json({ grid: { name: 'Private', effective_date: '2025-03-01', is_active: true, contract_levels: [145, 140, 135, 130, 125, 120, 115, 110, 105, 100, 95, 90, 85, 75, 65] } })})`;
  });
  expect('second admin waits on the agency mutex', await waitForLock('cc_s3_t6'));
  t5.release(); await t5.done;
  const r6 = await t6;
  expect('stale level change refused (PT409)', r6.error?.code === 'PT409', r6.error?.message ?? 'committed');
}

async function selectionVersusDeactivation() {
  console.log('\n-- 4. selection racing shared-grid deactivation');
  const g1 = await sharedGrid('S4 G1'); const g2 = await sharedGrid('S4 G2');
  const a = await agency('S4');
  await op(a.people[0], (tx) => tx`SELECT public.comp_enable_shared_grid(${g1.grid})`);
  await op(a.people[0], (tx) => tx`SELECT public.comp_enable_shared_grid(${g2.grid})`);

  // 4a: selection first, deactivation second.
  const t1 = hold('cc_s4_t1', async (tx) => { await asUser(tx, a.people[0]); return tx`SELECT public.comp_select_calculator_grid(${g2.grid}, ${g1.grid})`; });
  await t1.started;
  const t2 = attempt('cc_s4_t2', async (tx) => (await tx`SELECT private.comp_set_reference_grid_active(${g2.grid}, false) AS r`)[0].r);
  expect('deactivation waits for the selection', await waitForLock('cc_s4_t2'));
  t1.release(); await t1.done;
  const r2 = await t2;
  expect('deactivation completes and clears that selection', !r2.error && r2.value.cleared_selections === 1, r2.error?.message ?? JSON.stringify(r2.value));
  expect('agency has no selection (no replacement chosen)', (await settingsOf(a.org)) === null);

  // 4b: deactivation first, selection second.
  await owner`SELECT private.comp_set_reference_grid_active(${g2.grid}, true)`;
  await op(a.people[0], (tx) => tx`SELECT public.comp_select_calculator_grid(${g1.grid}, NULL)`);
  const t3 = hold('cc_s4_t3', async (tx) => tx`SELECT private.comp_set_reference_grid_active(${g2.grid}, false)`);
  await t3.started;
  const t4 = attempt('cc_s4_t4', async (tx) => { await asUser(tx, a.people[1]); return tx`SELECT public.comp_select_calculator_grid(${g2.grid}, ${g1.grid})`; });
  expect('selection waits for the deactivation', await waitForLock('cc_s4_t4'));
  t3.release(); await t3.done;
  const r4 = await t4;
  expect('selection of the now-inactive grid refused', r4.error?.code === 'PT404', r4.error?.message ?? 'committed');
  expect('previous selection kept', (await settingsOf(a.org)) === g1.grid);
}

async function copyVersusDisableAndDelete() {
  console.log('\n-- 5. copy racing disable (same agency) and shared-grid deletion');
  const g = await sharedGrid('S5 G');
  const a = await agency('S5');
  await op(a.people[0], (tx) => tx`SELECT public.comp_enable_shared_grid(${g.grid})`);

  const t1 = hold('cc_s5_t1', async (tx) => { await asUser(tx, a.people[0]); return (await tx`SELECT public.comp_create_private_grid('full', 'Copy', '2025-04-01', ${g.grid}) AS r`)[0].r; });
  const copy = await t1.started;
  const t2 = attempt('cc_s5_t2', async (tx) => { await asUser(tx, a.people[1]); return (await tx`SELECT public.comp_disable_shared_grid(${g.grid}) AS r`)[0].r; });
  expect('disable waits for the copy', await waitForLock('cc_s5_t2'));
  t1.release(); await t1.done;
  const r2 = await t2;
  expect('disable then completes and clears its own selection', !r2.error && r2.value.cleared_selection === true, r2.error?.message ?? JSON.stringify(r2.value));
  const [c] = await owner`SELECT (SELECT count(*)::int FROM public.comp_rates WHERE grid_id = ${copy.grid_id}) AS rates`;
  expect('the copy keeps every rate (incl. explicit zero)', c.rates === 2, `rates ${c.rates}`);

  // Re-enable, then a copy racing deletion of the shared source.
  await op(a.people[0], (tx) => tx`SELECT public.comp_enable_shared_grid(${g.grid})`);
  const t3 = hold('cc_s5_t3', async (tx) => { await asUser(tx, a.people[0]); return (await tx`SELECT public.comp_create_private_grid('structure', 'Structure', '2025-04-01', ${g.grid}) AS r`)[0].r; });
  const copy2 = await t3.started;
  const t4 = attempt('cc_s5_t4', async (tx) => tx`DELETE FROM public.comp_grids WHERE id = ${g.grid}`);
  expect('source deletion waits for the copy', await waitForLock('cc_s5_t4'));
  t3.release(); await t3.done;
  const r4 = await t4;
  expect('source deletion then completes', !r4.error, r4.error?.message);
  const [c2] = await owner`SELECT copied_from_grid_id, (SELECT count(*)::int FROM public.comp_product_variants WHERE grid_id = ${copy2.grid_id}) AS variants FROM public.comp_grids WHERE id = ${copy2.grid_id}`;
  expect('structure copy survives with zero-rate structure, provenance cleared', c2.variants === 1 && c2.copied_from_grid_id === null, JSON.stringify(c2));
  expect('agency selection cleared with the deleted grid', (await settingsOf(a.org)) === null);
}

async function sourceEditVersusCopy() {
  console.log('\n-- 6. source edit racing a copy');
  const g = await sharedGrid('S6 G');
  const a = await agency('S6');
  await op(a.people[0], (tx) => tx`SELECT public.comp_enable_shared_grid(${g.grid})`);

  // 6a: edit first (commits 77.25), copy second sees the edit.
  const t1 = hold('cc_s6_t1', async (tx) => tx`UPDATE public.comp_rates SET rate_percent = 77.25 WHERE variant_id = ${g.variant} AND contract_level = 100`);
  await t1.started;
  const t2 = attempt('cc_s6_t2', async (tx) => { await asUser(tx, a.people[0]); return (await tx`SELECT public.comp_create_private_grid('full', 'After edit', '2025-05-01', ${g.grid}) AS r`)[0].r; });
  expect('copy waits for the in-flight source edit', await waitForLock('cc_s6_t2'));
  t1.release(); await t1.done;
  const r2 = await t2;
  const [v2] = await owner`SELECT r.rate_percent::text AS rate FROM public.comp_rates r JOIN public.comp_product_variants v ON v.id = r.variant_id WHERE v.grid_id = ${r2.value?.grid_id} AND r.contract_level = 100`;
  expect('copy reflects the committed edit (consistent source)', v2?.rate === '77.25', JSON.stringify(v2 ?? r2.error?.message));

  // 6b: copy first, edit second waits; the copy keeps the pre-edit value.
  const t3 = hold('cc_s6_t3', async (tx) => { await asUser(tx, a.people[0]); return (await tx`SELECT public.comp_create_private_grid('full', 'Before edit', '2025-05-01', ${g.grid}) AS r`)[0].r; });
  const copy = await t3.started;
  const t4 = attempt('cc_s6_t4', async (tx) => tx`UPDATE public.comp_rates SET rate_percent = 66.5 WHERE variant_id = ${g.variant} AND contract_level = 100`);
  expect('source edit waits for the copy', await waitForLock('cc_s6_t4'));
  t3.release(); await t3.done;
  const r4 = await t4;
  expect('source edit then commits', !r4.error, r4.error?.message);
  const [v4] = await owner`SELECT r.rate_percent::text AS rate FROM public.comp_rates r JOIN public.comp_product_variants v ON v.id = r.variant_id WHERE v.grid_id = ${copy.grid_id} AND r.contract_level = 100`;
  expect('copy keeps the value it copied (independent of later source edits)', v4?.rate === '77.25', JSON.stringify(v4));
}

async function multiAgencyDeactivation() {
  console.log('\n-- 7. shared-grid deactivation affecting several agencies, with a racing selection');
  const g = await sharedGrid('S7 G');
  const agencies = [await agency('S7 A'), await agency('S7 B'), await agency('S7 D')];
  for (const x of agencies) await op(x.people[0], (tx) => tx`SELECT public.comp_enable_shared_grid(${g.grid})`);
  const e = await agency('S7 E');
  const t1 = hold('cc_s7_t1', async (tx) => { await asUser(tx, e.people[0]); return tx`SELECT public.comp_enable_shared_grid(${g.grid})`; });
  await t1.started;
  const t2 = attempt('cc_s7_t2', async (tx) => (await tx`SELECT private.comp_set_reference_grid_active(${g.grid}, false) AS r`)[0].r);
  expect('deactivation waits for the racing enable/select', await waitForLock('cc_s7_t2'));
  t1.release(); await t1.done;
  const r2 = await t2;
  expect('deactivation clears all four selections', !r2.error && r2.value.cleared_selections === 4, r2.error?.message ?? JSON.stringify(r2.value));
  const left = await owner`SELECT count(*)::int AS n FROM public.organization_comp_settings WHERE calculator_grid_id = ${g.grid}`;
  expect('no agency still selects the inactive grid', left[0].n === 0, `left ${left[0].n}`);
  const access = await owner`SELECT count(*)::int AS n FROM public.organization_comp_grids WHERE grid_id = ${g.grid}`;
  expect('access rows are kept (agencies may disable them; no silent removal)', access[0].n === 4, `access ${access[0].n}`);
}

async function privateSelectionVersusDelete() {
  console.log('\n-- 8. selecting a private grid racing its deletion (same agency)');
  const a = await agency('S8');
  const grid = await privateGrid(a.people[0]);
  const [g] = await owner`SELECT revision FROM public.comp_grids WHERE id = ${grid}`;
  const t1 = hold('cc_s8_t1', async (tx) => { await asUser(tx, a.people[0]); return tx`SELECT public.comp_select_calculator_grid(${grid}, NULL)`; });
  await t1.started;
  const t2 = attempt('cc_s8_t2', async (tx) => { await asUser(tx, a.people[1]); return (await tx`SELECT public.comp_delete_private_grid(${grid}, ${g.revision}) AS r`)[0].r; });
  expect('deletion waits on the agency mutex', await waitForLock('cc_s8_t2'));
  t1.release(); await t1.done;
  const r2 = await t2;
  expect('deletion completes and clears the selection', !r2.error && r2.value.cleared_selection === true, r2.error?.message ?? JSON.stringify(r2.value));
  expect('agency has no selection', (await settingsOf(a.org)) === null);
}

try {
  await firstUseEnableRace();
  await overlappingVariants();
  await rateVersusLevelRemoval();
  await selectionVersusDeactivation();
  await copyVersusDisableAndDelete();
  await sourceEditVersusCopy();
  await multiAgencyDeactivation();
  await privateSelectionVersusDelete();
} catch (e) {
  failures += 1;
  console.log(`   FAIL unexpected error: ${e.message}`);
} finally {
  await Promise.all(opened.map((s) => s.end({ timeout: 1 })));
  await owner.end({ timeout: 1 });
  await meta.end({ timeout: 1 });
}
if (failures > 0) { console.log(`\nCONCURRENCY: ${failures} FAILED`); process.exit(1); }
console.log('\nCONCURRENCY: ALL PASSED');
