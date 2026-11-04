// PKG-C producing-call capture: multi-session failure boundaries (D3 §2.12, §7). Disposable policy commission test
// database only (scripts/run_policy_commission_tests.sh, after 20261104120030/…31). Synthetic data.
//   T-LOCK    a held lock on the link table: the sale commits, the link fails within the 100ms bound and is recorded
//   T-CANCEL  a statement cancelled while the sale waits: the whole call rolls back (no sale, link or failure row)
//   T-REPLAY  the same request afterwards: the handoff and the link step both run
//   T-DOUBLE  the same request from two sessions: one sale, one link
//   T-ASSERT  an assertion failure inside the capture is never caught: the whole call rolls back
//   T-RECOVER a new session reads open_failure through the status read; the retry RPC saves the link
import postgres from 'postgres';
import assert from 'node:assert/strict';

const url = process.env.DB_URL;
if (!url || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('Disposable localhost database only');
const db = postgres(url, { max: 6, onnotice: () => {} });
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const actor = async (sql, n) => { await sql`select pc_login(${n})`; await sql.unsafe('SET LOCAL ROLE authenticated'); };
const policy = premium => JSON.stringify({ policy_type: 'Term', carrier: 'Synthetic Life', premium, sold_date: '2026-10-02' });
const record = (sql, req, client, premium, call) =>
  sql`select record_client_policy_handoff_v2(${id(req)}::uuid, ${client}::uuid, ${policy(premium)}::text::jsonb, false, null, ${call}::uuid) as r`;
const waitForLock = async name => {
  const deadline = Date.now() + 4000;
  for (;;) {
    const [r] = await db`select count(*)::int n from pg_stat_activity where application_name = ${name} and wait_event_type = 'Lock'`;
    if (r.n === 1) return;
    if (Date.now() > deadline) throw new Error(name + ' did not wait on a lock');
    await new Promise(r => setTimeout(r, 10));
  }
};
const counts = async (req) => (await db`select
    (select count(*)::int from wins where idempotency_key = ${'policy:' + id(req)}) wins,
    (select count(*)::int from private.policy_sale_call_links where request_id = ${id(req)}::uuid) links,
    (select count(*)::int from private.policy_sale_call_link_failures where request_id = ${id(req)}::uuid) failures`)[0];

try {
  const [{ client }] = await db`insert into clients(organization_id, first_name, last_name, assigned_agent_id)
    values (${id(1)}, 'Boundary', 'Synthetic', ${id(11)}) returning id::text as client`;
  const call = id(8101);
  await db`insert into calls(id, organization_id, agent_id, contact_id, direction, created_at)
    values (${call}, ${id(1)}, ${id(11)}, ${client}, 'outbound', now() - interval '1 hour')`;

  // T-LOCK
  {
    const ready = deferred(), release = deferred();
    const holder = db.begin(async sql => { await sql`lock table private.policy_sale_call_links in exclusive mode`; ready.resolve(); await release.promise; });
    await ready.promise;
    const started = Date.now();
    const [res] = await db.begin(async sql => { await actor(sql, 11); return record(sql, 8201, client, 41, call); });
    const elapsed = Date.now() - started;
    release.resolve(); await holder;
    assert.deepEqual(res.r.source_call_link, { status: 'capture_failed', recorded: true });
    assert.ok(elapsed < 800, `the link step waited ${elapsed} ms`);
    assert.deepEqual(await counts(8201), { wins: 1, links: 0, failures: 1 });
    const [f] = await db`select sqlstate from private.policy_sale_call_link_failures where request_id = ${id(8201)}::uuid`;
    assert.equal(f.sqlstate, '55P03');
    console.log(`PASS T-LOCK sale saved, link failure recorded as 55P03 in ${elapsed} ms`);
  }

  // T-RECOVER (server half): a new session reads open_failure, then the retry RPC saves the link.
  {
    const [win] = await db`select id::text from wins where idempotency_key = ${'policy:' + id(8201)}`;
    const status = await db.begin(async sql => { await actor(sql, 11);
      return sql`select status from get_policy_sale_call_link_status(${[win.id]}::uuid[])`; });
    assert.deepEqual(status.map(s => s.status), ['open_failure']);
    const [r] = await db.begin(async sql => { await actor(sql, 11); return sql`select retry_policy_sale_call_link(${win.id}::uuid) as r`; });
    assert.equal(r.r.status, 'linked');
    assert.deepEqual(await counts(8201), { wins: 1, links: 1, failures: 1 });
    console.log('PASS T-RECOVER open_failure read in a new session, then linked by the retry RPC');
  }

  // T-CANCEL then T-REPLAY: the sale waits on the client row and the statement is cancelled by its timeout.
  {
    const ready = deferred(), release = deferred();
    const holder = db.begin(async sql => { await sql`select 1 from clients where id = ${client}::uuid for update`; ready.resolve(); await release.promise; });
    await ready.promise;
    await assert.rejects(db.begin(async sql => {
      await sql`select set_config('application_name', 'pscl_cancel', true)`;
      await actor(sql, 11);
      await sql.unsafe("SET LOCAL statement_timeout = '300ms'");
      return record(sql, 8202, client, 42, call);
    }), e => e.code === '57014');
    release.resolve(); await holder;
    assert.deepEqual(await counts(8202), { wins: 0, links: 0, failures: 0 });
    console.log('PASS T-CANCEL a cancelled call leaves no sale, link or failure row');
    const [res] = await db.begin(async sql => { await actor(sql, 11); return record(sql, 8202, client, 42, call); });
    assert.equal(res.r.source_call_link.status, 'linked');
    assert.deepEqual(await counts(8202), { wins: 1, links: 1, failures: 0 });
    console.log('PASS T-REPLAY the same request afterwards saves the sale and its link');
  }

  // T-DOUBLE: the same request from two sessions (the second waits on the sale's request lock).
  {
    const ready = deferred(), release = deferred();
    const first = db.begin(async sql => { await actor(sql, 11); const r = await record(sql, 8203, client, 43, call); ready.resolve(); await release.promise; return r; });
    await Promise.race([ready.promise, first]);
    const second = db.begin(async sql => { await sql`select set_config('application_name', 'pscl_double', true)`; await actor(sql, 11);
      return record(sql, 8203, client, 43, call); });
    await waitForLock('pscl_double');
    release.resolve();
    const [[a], [b]] = await Promise.all([first, second]);
    assert.deepEqual(a.r.win_ids, b.r.win_ids);
    assert.deepEqual([a.r.source_call_link.status, b.r.source_call_link.status], ['linked', 'already_linked']);
    assert.deepEqual(await counts(8203), { wins: 1, links: 1, failures: 0 });
    console.log('PASS T-DOUBLE one sale and one link for a request sent twice');
  }

  // T-ASSERT: an assertion failure raised inside the link step aborts the whole call (test-only trigger).
  {
    await db.unsafe(`CREATE FUNCTION public.pscl_assert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic assertion' USING ERRCODE = 'P0004'; END $$;
      CREATE TRIGGER pscl_assert BEFORE INSERT ON private.policy_sale_call_links FOR EACH ROW EXECUTE FUNCTION public.pscl_assert();`);
    try {
      await assert.rejects(db.begin(async sql => { await actor(sql, 11); return record(sql, 8204, client, 44, call); }), e => e.code === 'P0004');
      assert.deepEqual(await counts(8204), { wins: 0, links: 0, failures: 0 });
    } finally {
      await db.unsafe('DROP TRIGGER pscl_assert ON private.policy_sale_call_links; DROP FUNCTION public.pscl_assert();');
    }
    console.log('PASS T-ASSERT an assertion failure is never caught: no sale, link or failure row');
  }
} finally {
  await db.end();
}
