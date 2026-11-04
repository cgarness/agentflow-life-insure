// PKG-D appointment evidence failure boundaries (D4 §2.12, §7), multi-session, on the disposable reporting fixture's
// appointments database (scripts/reporting_fixture.py appointments). Synthetic data only.
//   T-LOCK    another session holds the per-appointment advisory lock: the capture's 200 ms lock bound fires (55P03),
//             is caught, the write commits and one gap row names it.
//   T-OUTCOME the outcome RPC under the same held lock fails closed (55P03) and the status is unchanged.
//   T-CANCEL  a statement timeout during a (harness-slowed) capture aborts the whole write: no change, no evidence.
//   T-ASSERT  an assertion failure in the capture aborts the whole write.
//   T-DOUBLE  the capture and the gap write both fail: the write still commits, with no gap row (E10b, cross-session).
import postgres from 'postgres';
import assert from 'node:assert/strict';

const url = process.env.REPORTING_TEST_URL;
if (!url || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname) || !new URL(url).pathname.startsWith('/reporting_'))
  throw new Error('Disposable reporting database only');
const db = postgres(url, { max: 4, onnotice: () => {} });
const APPLY = 'private.appointment_evidence_apply(text,public.appointments,public.appointments)';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const as = async (sql, n) => { await sql`select test_actor(${n})`; await sql.unsafe('SET LOCAL ROLE authenticated'); };

try {
  const [appt] = await db`select a.id::text, a.organization_id::text as org, a.start_time from appointments a
    where a.booking_request_id = test_uuid(41001)`;
  assert.ok(appt, 'fixture appointment 41001');
  const gaps = async () => (await db`select count(*)::int n, max(sqlstate) s from private.appointment_evidence_capture_gaps
    where appointment_id = ${appt.id}::uuid`)[0];
  const observations = async () => (await db`select count(*)::int n from private.appointment_evidence_observations
    where appointment_id = ${appt.id}::uuid`)[0].n;
  const lockKey = `${appt.org}:appointment-evidence:${appt.id}`;

  // T-LOCK and T-OUTCOME: hold the per-appointment lock in another session.
  const held = deferred(), release = deferred();
  const holder = db.begin(async sql => { await sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`; held.resolve(); await release.promise; });
  await held.promise;
  try {
    const before = await gaps();
    const started = Date.now();
    await db.begin(async sql => { await as(sql, 11); await sql`update appointments set notes = 'T-LOCK' where id = ${appt.id}::uuid`; });
    const elapsed = Date.now() - started;
    const after = await gaps();
    assert.equal(after.n, before.n + 1); assert.equal(after.s, '55P03');
    assert.equal((await db`select notes from appointments where id = ${appt.id}::uuid`)[0].notes, 'T-LOCK');
    assert.ok(elapsed < 2000, `the capture's lock bound took ${elapsed} ms`);
    console.log(`PASS T-LOCK: 55P03 caught in ${elapsed} ms; the write committed with one gap row`);
    await db`update appointments set start_time = date_trunc('second', now()) - interval '1 minute' where id = ${appt.id}::uuid`;  // whole seconds: a JS Date has no microseconds
    const [{ start }] = await db`select start_time as start from appointments where id = ${appt.id}::uuid`;
    await assert.rejects(db.begin(async sql => {
      await as(sql, 12);
      await sql`select record_appointment_outcome(test_uuid(41901), ${appt.id}::uuid, ${start}, 'held')`;
    }), e => e.code === '55P03');
    assert.equal((await db`select status from appointments where id = ${appt.id}::uuid`)[0].status, 'Scheduled');
    console.log('PASS T-OUTCOME: the outcome RPC fails closed under the held lock; status unchanged');
  } finally { release.resolve(); await holder; }

  // T-CANCEL and T-ASSERT: harness-only capture bodies, replaced inside the failing transaction (rolled back with it).
  for (const [name, body, code] of [
    ['T-CANCEL', 'BEGIN PERFORM pg_sleep(1); END', '57014'],
    ['T-ASSERT', "BEGIN ASSERT false, 'harness assertion'; END", 'P0004']]) {
    const obs = await observations();
    await assert.rejects(db.begin(async sql => {
      await sql.unsafe(`CREATE OR REPLACE FUNCTION ${APPLY.replace('(text,public.appointments,public.appointments)', '(p_op text, p_old public.appointments, p_new public.appointments)')}
        RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$ ${body} $f$`);
      await sql.unsafe("SET LOCAL statement_timeout = '200ms'");
      await sql`update appointments set notes = ${name} where id = ${appt.id}::uuid`;
    }), e => e.code === code);
    assert.notEqual((await db`select notes from appointments where id = ${appt.id}::uuid`)[0].notes, name);
    assert.equal(await observations(), obs);
    console.log(`PASS ${name}: ${code} aborts the whole write; no change and no evidence`);
  }

  // T-DOUBLE: both the capture and the gap write fail in one session while another session reads; the write commits.
  const before = await gaps();
  await db.begin(async sql => {
    await sql.unsafe(`CREATE OR REPLACE FUNCTION private.appointment_evidence_apply(p_op text, p_old public.appointments, p_new public.appointments)
      RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$ BEGIN RAISE EXCEPTION 'forced' USING ERRCODE = 'XX000'; END $f$`);
    await sql.unsafe('ALTER TABLE private.appointment_evidence_capture_gaps ADD CONSTRAINT harness_gap_failure CHECK (false) NOT VALID');
    await sql`update appointments set notes = 'T-DOUBLE' where id = ${appt.id}::uuid`;
    const [{ notes }] = await sql`select notes from appointments where id = ${appt.id}::uuid`;
    assert.equal(notes, 'T-DOUBLE');
    throw Object.assign(new Error('rollback-harness'), { code: 'HARNESS' });
  }).catch(e => { if (e.code !== 'HARNESS') throw e; });
  assert.deepEqual(await gaps(), before);
  console.log('PASS T-DOUBLE: with capture and gap logging both failing the write commits (WARNING only, no gap row)');
} finally {
  await db.end();
}
