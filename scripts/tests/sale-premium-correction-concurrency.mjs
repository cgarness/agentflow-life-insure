// PKG-B sale premium corrections: two-backend races (D2 §9). Disposable reporting fixture database only (policy mode
// of scripts/reporting_fixture.py, after its correction steps). Synthetic data; the RPCs are granted to authenticated
// only inside this disposable database, the way …21 will grant them, and revoked again at the end.
import postgres from 'postgres';
import assert from 'node:assert/strict';

const url = process.env.REPORTING_TEST_URL;
if (!url || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname) || !new URL(url).pathname.startsWith('/reporting_'))
  throw new Error('Disposable reporting database only');
const db = postgres(url, { max: 6, onnotice: () => {} });
const WRITER = 'public.correct_policy_sale_premium(uuid,uuid,integer,numeric,jsonb,numeric,text,text,text)';
const READER = 'public.get_client_policy_sale_premiums(uuid)';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const as = async (sql, n) => { await sql`select test_actor(${n})`; await sql.unsafe('SET LOCAL ROLE authenticated'); };

// The first operation runs and keeps its transaction open; the second starts and must wait on a lock held by it.
// Returns both outcomes as settled promises.
async function race(name, firstOp, secondOp) {
  const ready = deferred(), release = deferred();
  const first = db.begin(async sql => { const r = await firstOp(sql); ready.resolve(); await release.promise; return r; });
  let second;
  try {
    await Promise.race([ready.promise, first]);
    second = db.begin(async sql => { await sql`select set_config('application_name', ${name}, true)`; return secondOp(sql); });
    const deadline = Date.now() + 4000;
    for (;;) {
      const [r] = await db`select count(*)::int n from pg_stat_activity where application_name = ${name} and wait_event_type = 'Lock'`;
      if (r.n === 1) break;
      if (Date.now() > deadline) throw new Error(name + ' did not contend');
      await new Promise(r => setTimeout(r, 10));
    }
    release.resolve();
    return await Promise.allSettled([first, second]);
  } finally {
    release.resolve();
    await Promise.allSettled([first, second].filter(Boolean));
  }
}
const fix = (req, policy, rev, eff, book, next, mode) => async sql => {
  await as(sql, 13);  // test_id(13): Admin of the home organization
  const [r] = await sql`select public.correct_policy_sale_premium(test_id(${req}), ${policy}::uuid, ${rev}::integer,
    ${eff}::numeric, ${book}::text::jsonb, ${next}::numeric, 'entry_error', 'Concurrency check', ${mode}) as r`;
  return r.r;
};
const rejectedWith = (s, code, detail) => s.status === 'rejected' && s.reason.code === code
  && (detail === undefined || s.reason.message.includes(detail) || String(s.reason.detail ?? '').includes(detail));

try {
  await db.unsafe(`GRANT EXECUTE ON FUNCTION ${WRITER} TO authenticated; GRANT EXECUTE ON FUNCTION ${READER} TO authenticated;`);
  const sale = await db.begin(async sql => {
    await as(sql, 41);
    const [r] = await sql`select create_client_with_sale(test_id(80101), test_id(1), test_client_payload() || jsonb_build_object(
      'first_name', 'Race', 'assigned_agent_id', test_id(41), 'premium', 100, 'sold_date', '2026-04-10'), true) as r`;
    return r.r;
  });
  const [{ policy, client }] = await db`select primary_policy_id::text as policy, id::text as client from clients where id = ${sale.client_id}::uuid`;
  const ledger = async () => (await db`select revision, request_id::text, corrected_monthly::text from private.policy_sale_premium_corrections c
    join wins w on w.id = c.win_id where w.policy_id = ${policy}::uuid order by revision`);
  const fingerprint = async () => (await db`select count(*)::int wins, md5(coalesce(string_agg(md5(to_jsonb(w)::text), ',' order by w.id), '')) h from wins w`)[0];
  const before = await fingerprint();

  // 1. The same request from two backends: one ledger row; the second returns the first result as idempotent.
  const [a, b] = await race('pspc_same_request', fix(90501, policy, 0, 100, '100', 110, 'keep_current'),
    fix(90501, policy, 0, 100, '100', 110, 'keep_current'));
  assert.equal(a.status, 'fulfilled'); assert.equal(b.status, 'fulfilled');
  assert.equal(a.value.idempotent, false); assert.equal(b.value.idempotent, true);
  assert.equal(b.value.revision, a.value.revision);
  assert.deepEqual((await ledger()).map(r => r.revision), [1]);
  console.log('PASS same request from two backends: one revision, the second is idempotent');

  // 2. Two requests at the same expected revision: one success, one PT409 stale_revision.
  const [c, d] = await race('pspc_same_revision', fix(90502, policy, 1, 110, '100', 120, 'keep_current'),
    fix(90503, policy, 1, 110, '100', 125, 'keep_current'));
  assert.equal(c.status, 'fulfilled'); assert.equal(c.value.revision, 2);
  assert.ok(rejectedWith(d, 'PT409', 'stale_revision'), 'second request at the same revision: ' + (d.reason?.message ?? d.status));
  assert.deepEqual((await ledger()).map(r => [r.revision, r.corrected_monthly]), [[1, '110'], [2, '120']]);
  console.log('PASS two requests at one revision: one success, one PT409 stale_revision');

  // 3. A correction racing an Edit Client premium change (update_client_with_policy_sale) serializes on the client
  //    row: holding the edit makes the correction wait, then refuse the changed book (PT409 policy_changed) ...
  const edit = premium => async sql => {
    await as(sql, 41);
    const [r] = await sql`select update_client_with_policy_sale(${client}::uuid, ${JSON.stringify({ premium })}::text::jsonb) as r`;
    return r.r;
  };
  const [e, f] = await race('pspc_edit_then_fix', edit(150), fix(90504, policy, 2, 120, '100', 130, 'match_sale'));
  assert.equal(e.status, 'fulfilled');
  assert.ok(rejectedWith(f, 'PT409', 'policy_changed'), 'correction after a concurrent edit: ' + (f.reason?.message ?? f.status));
  // ... and holding a correction makes the edit wait, then apply on top of it; the sale keeps the corrected amount.
  const [g, h] = await race('pspc_fix_then_edit', fix(90505, policy, 2, 120, '150', 140, 'keep_current'), edit(160));
  assert.equal(g.status, 'fulfilled'); assert.equal(g.value.revision, 3);
  assert.equal(h.status, 'fulfilled', 'edit after a concurrent correction: ' + (h.reason?.message ?? ''));
  const [state] = await db`select c.premium::text as book, private.performance_sale_monthly(w, c.premium)::text as effective
    from wins w join clients c on c.id = w.contact_id where w.policy_id = ${policy}::uuid`;
  assert.deepEqual(state, { book: '160', effective: '140' });
  assert.deepEqual((await ledger()).map(r => r.revision), [1, 2, 3]);
  console.log('PASS correction and Edit Client serialize on the client row in both orders');

  // No sale is inserted or changed by any correction.
  assert.deepEqual(await fingerprint(), before);
  console.log('PASS no sale inserted or changed by the races');
} finally {
  await db.unsafe(`REVOKE EXECUTE ON FUNCTION ${WRITER} FROM authenticated; REVOKE EXECUTE ON FUNCTION ${READER} FROM authenticated;`).catch(() => {});
  await db.end();
}
