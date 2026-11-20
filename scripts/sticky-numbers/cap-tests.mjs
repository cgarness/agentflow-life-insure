// Native PostgreSQL 17, synthetic data, loopback only. No provider transport.
// Run on a fresh installed candidate before and after the cap migration:
// STICKY_TEST_URL=postgres://postgres@127.0.0.1:55473/sticky_candidate \
// STICKY_CAP_EXPECT=installed|corrected STICKY_RESULTS=/absolute/result.json node scripts/sticky-numbers/cap-tests.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import postgres from 'postgres';

const url = process.env.STICKY_TEST_URL;
if (!url || !['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname)
  || new URL(url).pathname !== '/sticky_candidate') throw Error('Local sticky_candidate required');
const expectation = process.env.STICKY_CAP_EXPECT;
if (!['installed', 'corrected'].includes(expectation)) throw Error('Specify installed or corrected cap expectation');
const corrected = expectation === 'corrected';
const db = postgres(url, { max: 6, onnotice: () => {} });
const org = '10000000-0000-4000-8000-000000000001';
const agent = '20000000-0000-4000-8000-000000000002';
const peer = '20000000-0000-4000-8000-000000000003';
const number = '40000000-0000-4000-8000-000000000001';
const alternate = '40000000-0000-4000-8000-000000000002';
const from = '+12025551111';
const identity = 'sticky_' + agent.replaceAll('-', '');
const helper = 'private.affinity_voice_number(uuid,text,uuid,uuid,boolean,uuid)';
const report = { expectation, started_at: new Date().toISOString(), checks: [] };
let sequence = 100;

async function actor(run) {
  return db.begin(async sql => {
    await sql.unsafe('SET LOCAL ROLE authenticated');
    await sql`select set_config('request.jwt.claims',${JSON.stringify({ sub: agent, role: 'authenticated', app_metadata: { organization_id: org, role: 'Agent' } })},true)`;
    return run(sql);
  });
}
async function service(run) {
  return db.begin(async sql => {
    await sql.unsafe('SET LOCAL ROLE service_role');
    await sql`select set_config('request.jwt.claims','{"role":"service_role"}',true)`;
    return run(sql);
  });
}
async function test(name, run) {
  try {
    const detail = await run();
    report.checks.push({ name, status: 'passed', ...(detail ? { detail } : {}) });
    console.log('PASS', name);
  } catch (error) {
    report.checks.push({ name, status: 'failed', error: error.message, code: error.code, where: error.where });
    console.error('FAIL', name, error.message);
  }
}
async function contact(channel = null) {
  const c = { id: randomUUID(), phone: '+1202554' + String(sequence++).padStart(4, '0') };
  await db`insert into public.leads(id,organization_id,first_name,last_name,phone,user_id,assigned_agent_id,status)
    values(${c.id},${org},'Synthetic','Cap regression',${c.phone},${agent},${agent},'New')`;
  if (channel) await actor(sql => sql`select public.change_contact_number(${c.id},'lead',${channel},${number},0,'Synthetic cap regression')`);
  return c;
}
async function pin(c) {
  return (await db`select * from private.contact_number_affinities where organization_id=${org} and phone_e164=${c.phone}`)[0];
}
async function snapshot(c) {
  return (await db`select jsonb_build_object(
    'assignment',(select to_jsonb(a) from private.contact_number_affinities a where organization_id=${org} and phone_e164=${c.phone}),
    'events',(select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]'::jsonb) from private.contact_number_events e where organization_id=${org} and phone_e164=${c.phone}),
    'usage',(select jsonb_agg(jsonb_build_object('id',id,'count',daily_call_count,'limit',daily_call_limit) order by id) from public.phone_numbers where organization_id=${org})
  ) as v`)[0].v;
}
async function cap(run, count = 100, target = number) {
  const before = (await db`select daily_call_count,daily_call_limit from public.phone_numbers where id=${target}`)[0];
  await db`update public.phone_numbers set daily_call_count=${count},daily_call_limit=100 where id=${target}`;
  try { return await run(); }
  finally { await db`update public.phone_numbers set daily_call_count=${before.daily_call_count},daily_call_limit=${before.daily_call_limit} where id=${target}`; }
}
async function authorize(c, { id = randomUUID(), candidate = from, override = null, campaign = null, member = null } = {}) {
  const result = (await actor(sql => sql`select public.authorize_contact_call(${id},${c.id},'lead',${c.phone},${candidate},${campaign},${member},${override},false) as v`))[0].v;
  assert.equal(result.enabled, true);
  return { id, result, c, campaign, member };
}
async function row(call) {
  await actor(sql => sql`insert into public.calls(id,attempt_id,organization_id,agent_id,contact_id,contact_type,contact_phone,caller_id_used,campaign_id,campaign_lead_id,direction,status)
    values(${call.id},${call.id},${org},${agent},${call.c.id},'lead',${call.c.phone},${call.result.number},${call.campaign},${call.member},'outbound','ringing')`);
  return call;
}
async function admit(call) {
  return (await service(sql => sql`select public.admit_twilio_outbound(${call.id},${identity},${call.c.phone},${call.result.number},${'CA' + randomUUID().replaceAll('-', '')}) as v`))[0].v;
}
async function deniedAuthorization(c, options = {}, match = /affinity_sender_unavailable/) {
  const id = randomUUID();
  await assert.rejects(authorize(c, { ...options, id }), match);
  assert.equal((await db`select count(*)::int n from private.contact_number_call_bindings where call_id=${id}`)[0].n, 0);
}
async function continuity(c, options = {}) {
  if (!corrected) {
    await deniedAuthorization(c, options);
    return { installed_defect_reproduced: 'affinity_sender_unavailable', desired_result: 'authorized_and_admitted' };
  }
  const before = await pin(c);
  const call = await row(await authorize(c, options));
  assert.equal(call.result.number_id, number);
  assert.equal(call.result.number, from);
  assert.equal((await admit(call)).admitted, true);
  const after = await pin(c);
  for (const key of ['generation', 'voice_version', 'sms_version', 'voice_number_id', 'sms_number_id', 'voice_state', 'sms_state'])
    assert.equal(after[key], before[key], key + ' must not change');
  return { bound_number: call.result.number, admitted: true };
}
async function dnc(c) {
  await db`insert into public.dnc_list(organization_id,phone_number,added_by,reason) values(${org},${c.phone},${agent},'Synthetic cap guard')`;
}
async function metadata() {
  return db`select n.nspname as schema,p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
    p.proowner::regrole::text as owner,p.prosecdef,p.provolatile,p.proconfig,p.proacl::text as acl,
    pg_get_functiondef(p.oid) as definition,md5(pg_get_functiondef(p.oid)) as definition_md5
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='private' and p.proname in ('affinity_voice_number','affinity_number','affinity_default','affinity_view','affinity_admit_original'))
       or (n.nspname='public' and p.proname in ('authorize_contact_call','admit_twilio_outbound'))
    order by n.nspname,p.proname,arguments`;
}

try {
  report.runtime = (await db`select version(),current_user,session_user,rolsuper,rolbypassrls from pg_roles where rolname=current_user`)[0];
  assert.equal(report.runtime.current_user, 'postgres');
  assert.equal(report.runtime.session_user, 'postgres');
  assert.equal(report.runtime.rolsuper, false);
  assert.match(report.runtime.version, /^PostgreSQL 17\./);
  assert.equal((await db`select count(*)::int n from public.organizations where id=${org}`)[0].n, 0, 'Fresh synthetic candidate required');
  report.functions_before = await metadata();
  await db.unsafe(await fs.readFile(new URL('fixtures.sql', import.meta.url), 'utf8'));

  await test('Pinned preview at cap is read-only and reports continuity readiness', async () => {
    const c = await contact('voice');
    return cap(async () => {
      const before = await snapshot(c);
      const value = (await actor(sql => sql`select public.preview_contact_numbers(${c.id},'lead') as v`))[0].v;
      assert.equal(value.voice.id, number);
      assert.equal(value.voice.readiness, corrected ? 'ready' : 'daily_limit');
      assert.deepEqual(await snapshot(c), before);
      return { readiness: value.voice.readiness, installed_defect_reproduced: !corrected };
    });
  });
  for (const count of [100, 125]) await test(`Established voice pin authorizes and admits at usage ${count}/100`, async () => {
    const c = await contact('voice');
    return cap(() => continuity(c), count);
  });
  await test('Established SMS fallback remains usable at cap while voice is unassigned', async () => {
    const c = await contact('sms');
    assert.equal((await pin(c)).voice_state, 'unassigned');
    return cap(() => continuity(c));
  });
  await test('Cap crossing after authorization cannot reject an established pinned admission', async () => {
    const c = await contact('voice');
    const call = await row(await authorize(c));
    return cap(async () => {
      if (!corrected) {
        await assert.rejects(admit(call), /affinity_admission_changed/);
        assert.equal((await db`select dialer_provider_admitted from public.calls where id=${call.id}`)[0].dialer_provider_admitted, false);
        return { installed_defect_reproduced: 'affinity_admission_changed', desired_result: 'admitted' };
      }
      assert.equal((await admit(call)).admitted, true);
      return { admitted: true };
    });
  });
  await test('Guard-only preserves established pinned continuity at cap', async () => {
    const c = await contact('voice');
    await service(sql => sql`select public.set_contact_number_modes(${org},'guard_only','enforced')`);
    try { return await cap(() => continuity(c)); }
    finally { await service(sql => sql`select public.set_contact_number_modes(${org},'enforced','enforced')`); }
  });
  await test('Unassigned rotation candidate remains blocked at cap', async () => {
    const c = await contact();
    await cap(() => deniedAuthorization(c));
  });
  await test('Unassigned rotation binding is rechecked when usage reaches cap before admission', async () => {
    const c = await contact();
    const call = await row(await authorize(c));
    await cap(async () => {
      await assert.rejects(admit(call), /affinity_admission_changed/);
      assert.equal((await db`select dialer_provider_admitted from public.calls where id=${call.id}`)[0].dialer_provider_admitted, false);
    });
  });
  await test('Explicit one-call override never inherits a pin cap exception', async () => {
    const c = await contact('voice');
    await cap(() => deniedAuthorization(c, { override: number }));
  });
  await test('Reserved SMS sender is not an established pin exception', async () => {
    const c = await contact();
    const key = `manual:${agent}:${randomUUID()}`;
    await service(sql => sql`select public.sms_prepare_bound_dispatch(${org},${key},${c.phone},${from},'Synthetic cap reservation','manual','synthetic-cap-hash',array[]::uuid[],${agent},${c.id},'lead',null,${number},null)`);
    assert.equal((await pin(c)).sms_state, 'reserved');
    try { await cap(() => deniedAuthorization(c)); }
    finally { await service(sql => sql`select public.sms_cancel_prepared_dispatch(${org},${key})`); }
  });
  for (const state of ['history', 'voice', 'sms']) await test(`Review in ${state} cannot obtain cap exception`, async () => {
    const c = await contact(state === 'sms' ? 'sms' : 'voice');
    if (state === 'history') await db`update private.contact_number_affinities set history_state='needs_review' where organization_id=${org} and phone_e164=${c.phone}`;
    if (state === 'voice') await db`update private.contact_number_affinities set voice_state='needs_review' where organization_id=${org} and phone_e164=${c.phone}`;
    if (state === 'sms') await db`update private.contact_number_affinities set sms_state='needs_review' where organization_id=${org} and phone_e164=${c.phone}`;
    await cap(() => deniedAuthorization(c, {}, /affinity_history_review|affinity_sender_unavailable/));
  });
  await test('Campaign group mismatch still blocks a pinned number at cap', async () => {
    const c = await contact('voice'), campaign = randomUUID(), member = randomUUID(), group = randomUUID();
    await db`insert into public.number_groups(id,organization_id,name) values(${group},${org},'Synthetic cap group')`;
    await db`insert into public.number_group_members(number_group_id,phone_number_id) values(${group},${alternate})`;
    await db`insert into public.campaigns(id,organization_id,name,type,status,user_id,number_group_id) values(${campaign},${org},'Synthetic cap campaign','Open Pool','Active',${agent},${group})`;
    await db`insert into public.campaign_leads(id,organization_id,campaign_id,lead_id,phone,user_id) values(${member},${org},${campaign},${c.id},${c.phone},${agent})`;
    await db`insert into public.dialer_lead_locks(campaign_lead_id,campaign_id,organization_id,locked_by,expires_at,queue_issued_at) values(${member},${campaign},${org},${agent},now()+interval '10 minutes',now())`;
    await cap(() => deniedAuthorization(c, { campaign, member }));
  });
  await test('Inactive pinned sender remains unavailable at cap', async () => {
    const c = await contact('voice');
    await db`update public.phone_numbers set status='released' where id=${number}`;
    try { await cap(() => deniedAuthorization(c)); }
    finally { await db`update public.phone_numbers set status='active' where id=${number}`; }
  });
  await test('Personal ownership and one-off rules remain restrictive at cap', async () => {
    const c = await contact(), personal = randomUUID(), candidate = '+12025553333';
    await db`insert into public.phone_numbers(id,organization_id,phone_number,status,assignment_type,assigned_to,daily_call_limit,daily_call_count)
      values(${personal},${org},${candidate},'active','personal',${agent},100,100)`;
    await deniedAuthorization(c, { candidate });
    await deniedAuthorization(c, { override: personal });
    await db`update public.phone_numbers set daily_call_count=0,assigned_to=${peer} where id=${personal}`;
    await deniedAuthorization(c, { override: personal });
  });
  await test('DNC rejects new authorization for the same pinned number', async () => {
    const c = await contact('voice');
    await dnc(c);
    await deniedAuthorization(c, {}, /affinity_dnc/);
    await cap(() => deniedAuthorization(c, {}, corrected ? /affinity_dnc/ : /affinity_sender_unavailable/));
  });
  await test('DNC committed after binding still refuses final admission at cap', async () => {
    const c = await contact('voice');
    const call = await row(await authorize(c));
    await dnc(c);
    await cap(async () => {
      if (!corrected) await assert.rejects(admit(call), /affinity_admission_changed/);
      else {
        const result = await admit(call);
        assert.equal(result.admitted, false);
        assert.equal(result.reason, 'dnc');
      }
      assert.equal((await db`select dialer_provider_admitted from public.calls where id=${call.id}`)[0].dialer_provider_admitted, false);
    });
  });
  await test('Assignment change after binding refuses the stale caller at admission', async () => {
    const c = await contact('voice');
    const call = await row(await authorize(c));
    const generation = (await pin(c)).generation;
    await actor(sql => sql`select public.change_contact_number(${c.id},'lead','voice',${alternate},${generation},'Synthetic stale binding')`);
    await cap(() => assert.rejects(admit(call), /affinity_admission_changed/));
    assert.equal((await db`select dialer_provider_admitted from public.calls where id=${call.id}`)[0].dialer_provider_admitted, false);
  });
  await test('Private cap exception helper grants no application entry point', async () => {
    const exists = (await db`select to_regprocedure(${helper}) is not null as present`)[0].present;
    assert.equal(exists, corrected);
    if (!corrected) return;
    const grants = await db`select r.role,has_function_privilege(r.role,${helper},'EXECUTE') as execute from (values('anon'),('authenticated'),('service_role')) r(role)`;
    for (const grant of grants) assert.equal(grant.execute, false, grant.role + ' helper execution');
    await assert.rejects(actor(sql => sql`select private.affinity_voice_number(${org},'+12025550101',${number},${agent},false,null)`), /permission denied/);
  });
  report.functions_after = await metadata();
  assert.deepEqual(report.functions_after, report.functions_before, 'Tests do not alter any function definition/security metadata');
  report.status = report.checks.every(x => x.status === 'passed') ? 'passed' : 'failed';
  report.passed = report.checks.filter(x => x.status === 'passed').length;
  report.total = report.checks.length;
  report.installed_defects_reproduced = report.checks.filter(x => x.detail?.installed_defect_reproduced).length;
  if (report.status !== 'passed') process.exitCode = 1;
} catch (error) {
  report.status = 'failed';
  report.error = { message: error.message, code: error.code, where: error.where };
  process.exitCode = 1;
} finally {
  report.finished_at = new Date().toISOString();
  await fs.writeFile(process.env.STICKY_RESULTS || '/tmp/sticky-cap-results.json', JSON.stringify(report, null, 2) + '\n');
  await db.end();
  console.log(JSON.stringify({ status: report.status, expectation, passed: report.passed, total: report.total, installed_defects_reproduced: report.installed_defects_reproduced, error: report.error }));
}
