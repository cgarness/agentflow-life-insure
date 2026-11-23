/** Run on a fresh database cloned from the installed schema, before this migration or fixtures. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

const url = new URL(process.env.STICKY_TEST_URL || 'about:blank');
if (url.hostname !== '127.0.0.1' || url.pathname !== '/sticky_first_sms_candidate') {
  throw new Error('A disposable, unseeded loopback sticky_first_sms_candidate database is required.');
}
const db = postgres(url.toString(), {max: 12, onnotice() {}});
const org = '10000000-0000-4000-8000-000000000001';
const actor = '20000000-0000-4000-8000-000000000002';
const orgDefault = '40000000-0000-4000-8000-000000000001';
const chosen = '40000000-0000-4000-8000-000000000002';
const numbers = new Map([[orgDefault, '+12025551111'], [chosen, '+12025552222']]);
const prepareSignature = 'public.sms_prepare_first_contact_dispatch(uuid,text,text,text,text,text,text,uuid[],uuid,uuid,text,uuid,uuid,bigint)';
const startSignature = 'public.sms_start_first_contact_dispatch(uuid,text)';
const rollback = await readFile(new URL('../../supabase/ops/contact_first_sms_sender_rollback.sql', import.meta.url),'utf8');
const migration = await readFile(new URL('../../supabase/migrations/20261123170000_contact_first_sms_sender.sql', import.meta.url),'utf8');
const successful = [];
let suffix = 300;

async function test(name, run) {
  await run();
  successful.push(name);
  console.log('PASS', name);
}
async function contact(owner = actor) {
  const id = randomUUID(), phone = `+1202555${String(suffix++).padStart(4,'0')}`;
  await db`insert into public.leads(id,organization_id,first_name,last_name,phone,user_id,assigned_agent_id,status)
    values(${id},${org},'Synthetic','First SMS',${phone},${owner},${owner},'New')`;
  return {id, phone};
}
const request = (c, sender = chosen) => ({...c, sender, from:numbers.get(sender), body:'Synthetic first text',
  key:`manual:${actor}:${randomUUID()}`, generation:0});
function service(run) {
  return db.begin(async sql => {
    await sql`set local role service_role`;
    await sql`select set_config('request.jwt.claims','{"role":"service_role"}',true)`;
    return run(sql);
  });
}
async function prepare(r) {
  return (await service(sql => sql`select public.sms_prepare_first_contact_dispatch(${org},${r.key},${r.phone},${r.from},${r.body},'manual','hash',array[]::uuid[],${actor},${r.id},'lead',null,${r.sender},${r.generation}) as v`))[0].v;
}
async function ordinary(r, override = null) {
  return (await service(sql => sql`select public.sms_prepare_bound_dispatch(${org},${r.key},${r.phone},${r.from},${r.body},'manual','hash',array[]::uuid[],${actor},${r.id},'lead',null,${r.sender},${override}) as v`))[0].v;
}
async function start(r) {
  return (await service(sql => sql`select public.sms_start_first_contact_dispatch(${org},${r.key}) as ok`))[0].ok;
}
async function cancel(r) {
  return (await service(sql => sql`select public.sms_cancel_prepared_dispatch(${org},${r.key}) as ok`))[0].ok;
}
async function finish(r, state, sid = null) {
  const status = sid ? 'queued' : null;
  return (await service(sql => sql`select public.sms_finish_dispatch(${org},${r.key},${state},${sid},${status}) as v`))[0].v;
}
async function assignment(r) {
  return (await db`select * from private.contact_number_affinities where organization_id=${org} and phone_e164=${r.phone}`)[0];
}
async function setModes(voice, sms) {
  await db`select public.set_contact_number_modes(${org}, ${voice}, ${sms})`;
}
async function rollbackAttempt() {
  // The rollback file owns its transaction. On refusal, clear that exact session before releasing it.
  const connection = await db.reserve();
  try { await connection.unsafe(rollback); } finally { await connection.unsafe('rollback'); connection.release(); }
}
async function routineCatalog() {
  return db`select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as signature,
       md5(pg_get_functiondef(p.oid)) as definition,p.proacl,pg_get_userbyid(p.proowner) as owner
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname in ('public','private') and p.proname in ('affinity_prepare_original','affinity_prepare',
       'affinity_start_original','affinity_finish_original','affinity_accept_sms','sms_prepare_bound_dispatch',
       'sms_prepare_dispatch','sms_start_dispatch','sms_finish_dispatch','sms_cancel_prepared_dispatch',
       'require_first_contact_sms_mode','release_failed_first_contact_sms','preserve_first_contact_sms_receipt',
       'sms_prepare_first_contact_dispatch','sms_start_first_contact_dispatch')
     order by 1,2,3`;
}
async function dispatchTriggers() {
  return db`select tgname,pg_get_triggerdef(oid) as definition from pg_trigger
    where tgrelid='public.sms_dispatches'::regclass and not tgisinternal order by tgname`;
}
try {
  assert.equal((await db`select to_regprocedure(${prepareSignature}) as fn`)[0].fn,null,'template already migrated');
  await db.unsafe(await readFile(new URL('fixtures.sql', import.meta.url),'utf8'));
  const originalFunctions = await routineCatalog();
  const originalTriggers = await dispatchTriggers();
  const old = request(await contact(), orgDefault);
  await ordinary(old);
  await db.begin(sql => sql.unsafe(migration));

  await test('permission boundary on both new service RPCs and authenticated contact access', async () => {
    for (const signature of [prepareSignature,startSignature]) {
      const [acl] = await db`select has_function_privilege('anon',${signature},'execute') as anon,
        has_function_privilege('authenticated',${signature},'execute') as agent,
        has_function_privilege('service_role',${signature},'execute') as service`;
      assert.deepEqual({...acl},{anon:false,agent:false,service:true});
    }
    for (const signature of ['private.require_first_contact_sms_mode(uuid)','private.release_failed_first_contact_sms()','private.preserve_first_contact_sms_receipt()']) {
      for (const role of ['anon','authenticated','service_role']) {
        assert.equal((await db`select has_function_privilege(${role},${signature},'execute') as ok`)[0].ok,false);
      }
    }
    const hidden = await contact('20000000-0000-4000-8000-000000000003');
    await assert.rejects(prepare(request(hidden)),/affinity_scope/);
  });
  await test('old request retains its original intent after migration', async () => {
    assert.equal((await ordinary(old)).request_key, old.key);
    await assert.rejects(prepare(old), /sms_request_conflict/);
    assert.equal(await cancel(old), true);
  });
  await test('concurrent same-key prepare/start dispatches once and establishes the actual agency sender on acceptance', async () => {
    const r = request(await contact());
    const rows = await Promise.all([prepare(r),prepare(r)]);
    for(const row of rows) {
      assert.equal(row.affinity_number_id,chosen); assert.equal(row.affinity_override,false); assert.equal(row.state,'prepared');
    }
    const bound = await assignment(r);
    assert.equal(bound.sms_state,'reserved'); assert.equal(bound.voice_state,'unassigned');
    for(const changed of [{sender:orgDefault,from:numbers.get(orgDefault)},{body:'different'},{generation:1}]) {
      await assert.rejects(prepare({...r,...changed}),/sms_request_conflict/);
    }
    await assert.rejects(ordinary(r), /sms_request_conflict/);
    await assert.rejects(ordinary(r,chosen), /sms_request_conflict/);
    const starts = await Promise.all([start(r),start(r)]);
    assert.equal(starts.filter(Boolean).length,1);
    const accepted = await finish(r,'accepted',`SM${randomUUID().replaceAll('-','')}`);
    assert.equal(accepted.state,'accepted'); assert.equal((await prepare(r)).message_id,accepted.message_id);
    const saved = await assignment(r);
    assert.equal(saved.sms_state,'established'); assert.equal(saved.voice_state,'established');
    assert.equal(saved.sms_number_id,chosen); assert.equal(saved.voice_number_id,chosen);
    await assert.rejects(prepare(request(r,orgDefault)),/affinity_first_contact_changed/);
    const [message] = await db`select from_number from public.messages where id=${accepted.message_id}`;
    assert.equal(message.from_number,r.from);
  });
  await test('different concurrent first requests cannot reserve conflicting senders', async () => {
    const c=await contact(), a=request(c,orgDefault), b=request(c,chosen);
    const results=await Promise.allSettled([prepare(a),prepare(b)]);
    const successes=results.filter(r=>r.status==='fulfilled'), failures=results.filter(r=>r.status==='rejected');
    assert.equal(successes.length,1); assert.equal(failures.length,1);
    assert.match(failures[0].reason.message,/affinity_first_contact_changed/);
    assert.equal((await assignment(c)).sms_number_id,successes[0].value.affinity_number_id);
    const winner=successes[0].value.request_key===a.key?a:b;
    assert.equal(await cancel(winner),true);
    assert.equal((await assignment(c)).sms_state,'unassigned');
  });
  await test('same request key on different contacts cannot acquire two reservations', async () => {
    const a = request(await contact()), b = {...request(await contact()), key:a.key};
    const results = await Promise.allSettled([prepare(a),prepare(b)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length,1);
    const rejected = results.find(r => r.status === 'rejected');
    assert.match(rejected.reason.message,/sms_request_conflict/);
    const [row] = await db`select phone_e164, affinity_number_id from public.sms_dispatches where organization_id=${org} and request_key=${a.key}`;
    const loser = row.phone_e164 === a.phone ? b : a;
    assert.equal((await assignment(loser))?.sms_number_id ?? null,null);
    assert.equal(await cancel(a),true);
  });
  await test('authoritative reassignment and a competing first text cannot both apply', async () => {
    const r = request(await contact());
    const admin = '20000000-0000-4000-8000-000000000001';
    const reassignment = db.begin(async sql => {
      await sql`set local role authenticated`;
      await sql`select set_config('request.jwt.claims',${JSON.stringify({sub:admin,role:'authenticated',app_metadata:{organization_id:org,role:'Admin'}})},true)`;
      return sql`select public.change_contact_number(${r.id},'lead','both',${orgDefault},0,'Synthetic agent reassignment')`;
    });
    const [saved,prepared] = await Promise.allSettled([reassignment,prepare(r)]);
    assert.notEqual(saved.status,prepared.status);
    const pin = await assignment(r);
    if (saved.status === 'fulfilled') {
      assert.match(prepared.reason.message,/affinity_first_contact_changed/);
      assert.equal(pin.sms_number_id,orgDefault); assert.equal(pin.sms_state,'established');
    } else {
      assert.match(saved.reason.message,/affinity_send_unresolved/);
      assert.equal(pin.sms_number_id,chosen); assert.equal(pin.sms_state,'reserved');
      await cancel(r);
    }
  });
  await test('post-handoff definite failure releases its reservation and permits an eligible replacement', async () => {
    const r=request(await contact()); await prepare(r); assert.equal(await start(r),true);
    assert.equal((await finish(r,'failed')).state,'failed');
    assert.equal((await assignment(r)).sms_number_id,null);
    const replacement=request(r,orgDefault);
    assert.equal((await prepare(replacement)).affinity_number_id,orgDefault);
    await cancel(replacement);
  });
  await test('uncertain send prevents a competing reservation and rollback; explicit receipt recovers it without resending', async () => {
    const r=request(await contact()); await prepare(r); await start(r); await finish(r,'uncertain');
    assert.equal((await prepare(r)).state,'uncertain'); assert.equal(await start(r),false);
    assert.equal((await assignment(r)).sms_state,'reserved');
    await assert.rejects(prepare(request(r,orgDefault)),/affinity_first_contact_changed/);
    await assert.rejects(rollbackAttempt(),/first_contact_sms_rollback_requires_drain/);
    assert.equal((await finish(r,'accepted',`SM${randomUUID().replaceAll('-','')}`)).state,'accepted');
    assert.equal((await assignment(r)).sms_state,'established');
  });
  await test('a contradictory failure and a failed dependent cannot erase known provider acceptance evidence', async () => {
    const r = request(await contact()); await prepare(r);
    const dependent = request(r); await ordinary(dependent);
    await start(r);
    const sid = `SM${randomUUID().replaceAll('-', '')}`;
    assert.equal((await finish(r,'uncertain',sid)).provider_sid,sid);
    // Both ignoring and explicitly refusing the stale failure preserve recoverable evidence.
    await finish(r,'failed').catch(error => assert.match(error.message, /receipt_state|evidence|uncertain|first_receipt_conflict/));
    await cancel(dependent);
    const replay = await prepare(r);
    assert.equal(replay.provider_sid,sid); assert.equal(replay.state,'uncertain');
    assert.equal((await assignment(r)).sms_number_id,chosen);
    assert.equal(await start(r),false);
    assert.equal((await finish(r,'accepted',sid)).state,'accepted');
    assert.equal((await assignment(r)).sms_state,'established');
  });
  await test('ordinary dependent acceptance evidence survives conflicts and can establish the original reservation', async () => {
    const first = request(await contact()); await prepare(first);
    const pending = request(first); await ordinary(pending);
    const [started] = await service(sql => sql`select public.sms_start_dispatch(${org},${pending.key}) as ok`);
    assert.equal(started.ok,true);
    const sid = `SM${randomUUID().replaceAll('-', '')}`;
    await finish(pending,'uncertain',sid);
    await cancel(first);
    await assert.rejects(finish(pending,'failed'),/affinity_first_receipt_conflict/);
    await assert.rejects(finish(pending,'accepted',`SM${randomUUID().replaceAll('-', '')}`),/affinity_first_receipt_conflict/);
    assert.equal((await ordinary(pending)).provider_sid,sid);
    assert.equal((await finish(pending,'accepted',sid)).state,'accepted');
    assert.equal((await assignment(first)).sms_number_id,chosen);
    assert.equal((await assignment(first)).sms_state,'established');
  });
  await test('STOP or lost SMS readiness after prepare prevents provider handoff', async () => {
    const paused = request(await contact()); await prepare(paused);
    await db`update public.a2p_numbers set pool_member=false where phone_number_id=${chosen}`;
    try { await assert.rejects(start(paused),/affinity_sender_unready/); }
    finally { await db`update public.a2p_numbers set pool_member=true where phone_number_id=${chosen}`; }
    assert.equal(await cancel(paused),true);
    const reassigned=request(await contact()); await prepare(reassigned);
    await db`update public.phone_numbers set assignment_type='personal',assigned_to=${actor} where id=${chosen}`;
    try { await assert.rejects(start(reassigned),/affinity_sender_unready/); }
    finally { await db`update public.phone_numbers set assignment_type='agency',assigned_to=null where id=${chosen}`; }
    await cancel(reassigned);
    const stopped = request(await contact()); await prepare(stopped);
    await service(sql => sql`select public.sms_record_suppression(${org},${stopped.phone},'stop','test-keyword')`);
    const didStart = await start(stopped).catch(error => {assert.match(error.message,/suppressed/); return false;});
    assert.equal(didStart,false); await cancel(stopped);
    assert.equal((await assignment(stopped)).sms_number_id,null);
  });
  await test('failed owner retains reservation for another pending ordinary send and releases after its last failure', async () => {
    const r=request(await contact()); await prepare(r);
    const second=request(r); assert.equal((await ordinary(second)).affinity_number_id,chosen);
    await cancel(r); assert.equal((await assignment(r)).sms_state,'reserved');
    await assert.rejects(rollbackAttempt(),/first_contact_sms_rollback_requires_drain/);
    await cancel(second); assert.equal((await assignment(r)).sms_state,'unassigned');
  });
  await test('mode change before dispatch and stale generation refuse the send', async () => {
    const r=request(await contact()); await assert.rejects(prepare({...r,generation:1}),/affinity_first_contact_changed/);
    await prepare(r); await setModes('enforced','guard_only');
    try { await assert.rejects(start(r),/affinity_first_contact_changed/); }
    finally { await setModes('enforced','enforced'); }
    await cancel(r);
  });
  await test('sender role, eligibility, real number and recipient suppression apply to selected first sends', async () => {
    const r=request(await contact());
    await assert.rejects(prepare({...r,from:numbers.get(orgDefault)}),/affinity_sender_unready/);
    await db`update public.phone_numbers set assignment_type='personal',assigned_to=${actor} where id=${chosen}`;
    try { await assert.rejects(prepare(r),/affinity_sender_unready/); }
    finally { await db`update public.phone_numbers set assignment_type='agency',assigned_to=null where id=${chosen}`; }
    await db`update public.a2p_numbers set pool_member=false where phone_number_id=${chosen}`;
    try { await assert.rejects(prepare(r),/affinity_sender_unready/); }
    finally { await db`update public.a2p_numbers set pool_member=true where phone_number_id=${chosen}`; }
    await db`select public.sms_record_suppression(${org},${r.phone},'stop','inbound')`;
    await assert.rejects(prepare(r),/suppressed/);
    assert.equal((await db`select count(*)::int as n from public.sms_dispatches where request_key=${r.key}`)[0].n,0);
  });
  await test('drained rollback preserves saved numbers, communication records and the original RPC', async () => {
    const snapshot=async()=> (await db`select (select jsonb_agg(to_jsonb(d) order by request_key) from public.sms_dispatches d) as dispatches,
      (select jsonb_agg(to_jsonb(a) order by phone_e164) from private.contact_number_affinities a) as assignments,
      (select jsonb_agg(to_jsonb(m) order by id) from public.messages m) as messages,
      (select jsonb_agg(to_jsonb(e) order by id) from private.contact_number_events e) as events`)[0];
    const before=await snapshot(); await rollbackAttempt();
    assert.deepEqual(await snapshot(),before);
    assert.equal((await db`select to_regprocedure(${prepareSignature}) as fn`)[0].fn,null);
    assert.equal((await ordinary(old)).state,'failed');
    assert.deepEqual(await routineCatalog(),originalFunctions);
    assert.deepEqual(await dispatchTriggers(),originalTriggers);
    await db.begin(sql => sql.unsafe(migration));
    const again = request(await contact()); await prepare(again); await cancel(again);
    await rollbackAttempt(); assert.deepEqual(await routineCatalog(),originalFunctions);
  });
  console.log(`${successful.length} first-SMS native database scenarios passed.`);
} finally { await db.end(); }
