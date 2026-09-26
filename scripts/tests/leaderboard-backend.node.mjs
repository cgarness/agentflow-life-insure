// Destructive synthetic-fixture setup: loopback-only, empty database, PostgreSQL 17.
// Never supply a production connection. No production credentials are used by CI.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import postgres from 'postgres';

const url = new URL(process.env.LEADERBOARD_TEST_DATABASE_URL || 'file:///missing');
assert(['postgres:', 'postgresql:'].includes(url.protocol)
  && url.hostname === '127.0.0.1' && url.port === '55432'
  && url.pathname === '/leaderboard_test' && !url.search && !url.hash,
  'Refusing a non-loopback/non-fixture database');
const db = postgres(url.href, { max: 1, connect_timeout: 5, prepare: false, onnotice() {} });
const other = postgres(url.href, { max: 16, connect_timeout: 5, prepare: false, onnotice() {} });
const A = '00000000-0000-0000-0000-000000000011';
const B = '00000000-0000-0000-0000-000000000012';
const Z = '00000000-0000-0000-0000-000000000014';
const C = '00000000-0000-0000-0000-000000000021';
const O1 = '00000000-0000-0000-0000-000000000001';
const O2 = '00000000-0000-0000-0000-000000000002';
const signature = 'public.get_org_leaderboard_stats(timestamptz,timestamptz)';
const windows = [
  ['2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z'],
  ['2026-06-29T00:00:00Z', '2026-07-06T00:00:00Z'],
  ['2026-07-01T00:00:00Z', '2026-08-01T00:00:00Z'],
];
const query = (tx, range = windows[0]) =>
  tx.unsafe('select * from ' + signature.split('(')[0] + '($1::timestamptz,$2::timestamptz)', range);
const act = async (tx, id, role = 'authenticated', claims = {}) => {
  assert(['authenticated', 'anon', 'service_role'].includes(role));
  await tx.unsafe('SET LOCAL ROLE ' + role);
  await tx.unsafe("select set_config('request.jwt.claim.sub',$1,true)", [id || '']);
  await tx.unsafe("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: id, ...claims })]);
  await tx.unsafe("select set_config('statement_timeout','1500ms',true)");
};
const runAs = (client, id, fn = query, role, claims) => client.begin(async tx => {
  await act(tx, id, role, claims);
  return fn(tx);
});
const definition = async (client = db) => (await client.unsafe(
  'select pg_get_functiondef($1::regprocedure) as d', [signature]))[0].d;
const md5 = text => createHash('md5').update(text).digest('hex');
const fingerprint = async () => md5(await definition());
const metadata = async () => (await db.unsafe(
  "select jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,'definer',prosecdef,'volatility',provolatile,'args',proargtypes::text,'returns',prorettype,'oid',oid) as m from pg_proc where oid=$1::regprocedure",
  [signature]))[0].m;
const policies = async () => (await db.unsafe(
  "select jsonb_agg(to_jsonb(p) order by polname) as p from pg_policy p"))[0].p;
const apply = source => db.begin(tx => tx.unsafe(source));
const errorCode = code => error => error.code === code;
let passed = 0;
let mutations = 0;
const timings = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (error) { console.error('FAIL ' + name); throw error; }
}
const rollback = new Error('synthetic fixture rollback');
async function rolledBack(fn) {
  await assert.rejects(db.begin(async tx => { await fn(tx); throw rollback; }), error => error === rollback);
}
async function refusesDrift(source, change, message) {
  const before = [await definition(), await metadata()];
  await assert.rejects(db.begin(async tx => { await change(tx); await tx.unsafe(source); }), message);
  assert.deepEqual([await definition(), await metadata()], before);
}
let guarded;
async function detectRuntimeMutation(name, changed, probe) {
  assert.notEqual(changed, guarded, 'Mutation must actually change code');
  await db.unsafe(changed);
  try {
    await assert.rejects(probe, error => error instanceof assert.AssertionError,
      'The behavioral probe must detect ' + name);
    mutations++;
    console.log('CAUGHT ' + name);
  } finally {
    await db.unsafe('select pg_advisory_unlock_all()');
    await db.unsafe(guarded);
  }
}

try {
  const server = (await db.unsafe('select version() as v, current_database() as d'))[0];
  assert.match(server.v, /^PostgreSQL 17\./);
  assert.equal(server.d, 'leaderboard_test');
  assert.equal((await db.unsafe("select count(*)::int as n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%' and c.relkind in ('r','p','v','m','f')"))[0].n, 0,
    'Fixture database must be empty; refusing to erase existing objects');
  assert.equal((await db.unsafe("select count(*)::int as n from pg_roles where rolname in ('anon','authenticated','service_role')"))[0].n, 0,
    'Use a dedicated fixture cluster');
  await db.unsafe(await readFile('supabase/tests/fixtures/leaderboard_backend.sql', 'utf8'));
  await db.unsafe(await readFile('supabase/migrations_archive/pre_baseline/20260805090000_get_org_leaderboard_stats_rpc.sql', 'utf8'));
  const pause = await readFile('supabase/migrations/20260923224254_emergency_pause_org_leaderboard_20260923.sql', 'utf8');
  const forward = await readFile('supabase/ops/leaderboard_request_guard.sql', 'utf8');
  const repause = await readFile('supabase/ops/leaderboard_repause.sql', 'utf8');
  const candidates = (await readdir('supabase/migrations')).filter(n => /^\d+_leaderboard_request_guard\.sql$/.test(n));
  assert.equal(candidates.length, 1, 'Exactly one forward migration');
  assert.equal(await readFile('supabase/migrations/' + candidates[0], 'utf8'), forward,
    'Tested SQL must equal the actual migration bytes');
  const original = await definition();
  const initialMetadata = await metadata();
  const initialPolicies = await policies();
  const snapshots = [];
  for (const range of windows) snapshots.push(await runAs(db, A, tx => query(tx, range)));

  await test('canonical original, roster, boundaries and metrics', async () => {
    assert.equal(md5(original), 'd26a38b59de90db91ed777236ee4acc4');
    const [a, b, zero] = snapshots[0];
    assert.deepEqual(snapshots[0].map(r => r.agent_id), [A, B, Z]);
    assert.deepEqual([+a.calls_made, +b.calls_made, +a.talk_time_seconds, +b.talk_time_seconds], [1, 3, 60, 120]);
    assert.deepEqual([+a.appointments_set, +b.appointments_set], [1, 1]);
    assert.deepEqual([+a.policies_sold, +a.annualized_premium, +b.policies_sold, +b.annualized_premium], [2, 840, 3, -24]);
    assert.deepEqual([+a.recent_wins_7d, +b.recent_wins_7d], [1, 1]);
    assert.equal(+zero.calls_made + +zero.policies_sold + +zero.annualized_premium, 0);
    assert.equal(+snapshots[2][0].calls_made, 2);
    assert.equal(+snapshots[2][0].appointments_set, 2);
    assert.equal(+snapshots[2][0].policies_sold, 3);
  });
  await test('forward refuses unpaused original', async () => {
    await refusesDrift(forward, async () => {}, /definition changed/);
  });
  await apply(pause);
  await test('exact production pause and maintenance response', async () => {
    assert.equal(await fingerprint(), '1314cefc781ff326540b83f748d48046');
    await assert.rejects(runAs(db, A), errorCode('PT503'));
    assert.deepEqual(await metadata(), initialMetadata);
  });
  await test('forward refuses missing function and body drift', async () => {
    await refusesDrift(forward, tx => tx.unsafe('drop function ' + signature), /target missing/);
    await refusesDrift(forward, tx => tx.unsafe(original.replace('COUNT(*)::bigint AS calls_made', '1::bigint AS calls_made')), /definition changed/);
  });
  await test('forward refuses owner and grant drift', async () => {
    await refusesDrift(forward, tx => tx.unsafe('grant execute on function ' + signature + ' to anon'), /owner or ACL changed/);
    await refusesDrift(forward, tx => tx.unsafe('alter function ' + signature + ' owner to authenticated'), /owner or ACL changed/);
  });
  await apply(forward);
  guarded = await definition();
  await test('guard changes only the intended body and preserves security/RLS', async () => {
    assert.equal(md5(guarded), '8af04a4deed619788ee803df90d59205');
    assert.deepEqual(await metadata(), initialMetadata);
    assert.deepEqual(await policies(), initialPolicies);
    for (let i = 0; i < windows.length; i++)
      assert.deepEqual(await runAs(db, A, tx => query(tx, windows[i])), snapshots[i]);
    await refusesDrift(forward, async () => {}, /definition changed/);
  });
  await test('anonymous, missing identity and missing organization fail closed', async () => {
    await assert.rejects(runAs(db, A, query, 'anon'), errorCode('42501'));
    await assert.rejects(runAs(db, null), /not authenticated/);
    await assert.rejects(runAs(db, '00000000-0000-0000-0000-000000000099'), /no organization/);
    await assert.rejects(runAs(db, null, query, 'service_role'), /not authenticated/);
  });
  await test('database organization overrides forged claims; raw RLS stays restrictive', async () => {
    const rows = await runAs(db, A, async tx => {
      const raw = await tx.unsafe('select * from calls');
      assert.equal(raw.length, 4);
      assert(raw.every(row => row.agent_id === A));
      return query(tx);
    }, 'authenticated', { organization_id: O2, app_metadata: { organization_id: O2, role: 'Admin' } });
    assert.deepEqual(rows, snapshots[0]);
    assert.deepEqual((await runAs(db, C)).map(r => r.agent_id), [C]);
  });
  await test('date validation remains before the guard', async () => {
    await db.begin(async holder => {
      await holder.unsafe("select pg_advisory_xact_lock(hashtextextended($1,0))", ['agentflow:leaderboard:v1:' + O1]);
      for (const bounds of [[null, windows[0][1]], [windows[0][0], null],
        [windows[0][0], windows[0][0]], [windows[0][1], windows[0][0]],
        ['2026-07-01Z', '2026-08-06Z']])
        await assert.rejects(runAs(other, A, tx => query(tx, bounds)), errorCode('P0001'));
      await assert.rejects(runAs(other, null), /not authenticated/);
    });
    await runAs(db, A, tx => query(tx, ['2026-07-01Z', '2026-08-05Z']));
  });
  await test('STABLE RPC works in a read-only transaction', async () => {
    await db.begin('READ ONLY', async tx => {
      await act(tx, A);
      assert.deepEqual(await query(tx), snapshots[0]);
    });
  });

  const contention = () => db.begin(async holder => {
    await act(holder, A);
    await query(holder); // Acquire the guard through the real RPC, not a synthetic lock.
    const began = performance.now();
    await assert.rejects(runAs(other, B), errorCode('PT429'));
    timings.push(performance.now() - began);
    assert(performance.now() - began < 1500, 'busy returns without queueing');
  });
  const release = async () => {
    await runAs(db, A);
    await assert.doesNotReject(runAs(other, B));
  };
  await test('real same-organization RPC contention fails immediately', contention);
  await test('commit releases the guard', release);
  await test('same-org burst does not wait or leak locks; other org and CRM stay available', async () => {
    await db.begin(async holder => {
      await act(holder, A);
      await query(holder);
      const burst = await Promise.allSettled(Array.from({ length: 16 }, () => runAs(other, B)));
      assert(burst.every(r => r.status === 'rejected' && r.reason.code === 'PT429'));
      assert.deepEqual((await runAs(other, C)).map(r => r.agent_id), [C]);
      await assert.rejects(other.begin(async tx => {
        await act(tx, B);
        assert.equal((await tx.unsafe('select count(*)::int as n from calls'))[0].n, 4);
        await tx.unsafe("insert into calls(agent_id,organization_id,created_at,direction,duration) values ($1,$2,'2026-06-01Z','outbound',0)", [B, O1]);
        assert.equal((await tx.unsafe('select count(*)::int as n from calls'))[0].n, 5);
        throw rollback;
      }), error => error === rollback);
      const locks = await other.unsafe("select count(*)::int as n from pg_locks where locktype='advisory' and not granted");
      assert.equal(locks[0].n, 0);
    });
    assert.equal((await db.unsafe("select count(*)::int as n from pg_locks where locktype='advisory'"))[0].n, 0);
    assert.deepEqual(await runAs(other, B), snapshots[0]);
  });
  await test('rollback releases the guard', async () => {
    await rolledBack(async tx => { await act(tx, A); await query(tx); });
    assert.deepEqual(await runAs(other, B), snapshots[0]);
  });
  await test('cancelling the holder releases the guard', async () => {
    let pid;
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const running = db.begin(async tx => {
      await act(tx, A);
      await query(tx);
      pid = (await tx.unsafe('select pg_backend_pid() as p'))[0].p;
      await tx.unsafe("select set_config('statement_timeout','5s',true)");
      started();
      await tx.unsafe('select pg_sleep(4)');
    });
    const cancelled = assert.rejects(running, errorCode('57014'));
    await Promise.race([ready, running.then(() => assert.fail('Holder ended before cancellation'))]);
    let sleeping = false;
    for (let i = 0; i < 100; i++) {
      sleeping = (await other.unsafe("select wait_event='PgSleep' as s from pg_stat_activity where pid=$1", [pid]))[0]?.s;
      if (sleeping) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert(sleeping, 'Cancellation test must observe the active holder');
    assert.equal((await other.unsafe('select pg_cancel_backend($1) as c', [pid]))[0].c, true);
    await cancelled;
    assert.deepEqual(await runAs(other, B), snapshots[0]);
  });
  await test('busy response does not reach blocked aggregate tables', async () => {
    await db.begin(async holder => {
      await holder.unsafe("select pg_advisory_xact_lock(hashtextextended($1,0))", ['agentflow:leaderboard:v1:' + O1]);
      await holder.unsafe('lock table calls in access exclusive mode');
      await assert.rejects(runAs(other, A), errorCode('PT429'));
    });
  });
  await test('behavioral mutation: missing lock is detected', () =>
    detectRuntimeMutation('missing-lock', guarded.replace('IF NOT pg_catalog.pg_try_advisory_xact_lock(', 'IF false AND NOT pg_catalog.pg_try_advisory_xact_lock('), contention));
  await test('behavioral mutation: per-user key is detected', () =>
    detectRuntimeMutation('per-user-key', guarded.replace("|| v_org::text, 0)", "|| v_uid::text, 0)"), contention));
  await test('behavioral mutation: session lock leakage is detected', () =>
    detectRuntimeMutation('session-lock', guarded.replace('pg_try_advisory_xact_lock', 'pg_try_advisory_lock'), release));

  await test('re-pause refuses definition and permission drift', async () => {
    await refusesDrift(repause, tx => tx.unsafe(guarded.replace("MESSAGE = 'Standings are busy'", "MESSAGE = 'changed'")), /definition changed/);
    await refusesDrift(repause, tx => tx.unsafe('grant execute on function ' + signature + ' to anon'), /owner or ACL changed/);
    await refusesDrift(repause, tx => tx.unsafe('alter function ' + signature + ' owner to authenticated'), /owner or ACL changed/);
    await refusesDrift(repause, tx => tx.unsafe('drop function ' + signature), /target missing/);
  });
  await apply(repause);
  await test('re-pause blocks before business lookups and retains exact security/guard', async () => {
    assert.equal(await fingerprint(), '75eec092f7039c2c8cb0cca93e93d1ae');
    assert.deepEqual(await metadata(), initialMetadata);
    assert.deepEqual(await policies(), initialPolicies);
    await db.begin(async holder => {
      await holder.unsafe('lock table profiles,calls,appointments,wins,clients in access exclusive mode');
      await assert.rejects(runAs(other, A), errorCode('PT503'));
      await assert.rejects(runAs(other, null), /not authenticated/);
    });
    await refusesDrift(repause, async () => {}, /definition changed/);
    await refusesDrift(forward, async () => {}, /definition changed/);
  });
  console.log(JSON.stringify({
    result: 'PASS', database: server.v, tests: passed, behavioralMutationsCaught: mutations,
    busyResponseMs: timings, migration: candidates[0],
    forwardSha256: createHash('sha256').update(forward).digest('hex'),
    repauseSha256: createHash('sha256').update(repause).digest('hex'),
    productionChanged: false,
  }));
} finally {
  await Promise.allSettled([db.end({ timeout: 2 }), other.end({ timeout: 2 })]);
}
