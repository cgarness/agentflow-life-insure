// Native PostgreSQL 17, managed NOSUPERUSER, synthetic data and loopback only.
// Revision 2: includes the unsaved conversation -> pin -> repeat-call lifecycle.
// Run from the isolated repository with STICKY_MANUAL_EXPECT=installed|revision1|corrected.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import postgres from 'postgres';

const url = process.env.STICKY_TEST_URL;
if (!url || !['127.0.0.1','localhost','::1'].includes(new URL(url).hostname)
  || new URL(url).pathname !== '/sticky_candidate') throw Error('Local sticky_candidate required');
const expectation = process.env.STICKY_MANUAL_EXPECT;
if (!['installed','revision1','corrected'].includes(expectation)) throw Error('Specify installed, revision1 or corrected expectation');
const corrected = expectation === 'corrected';
const emptyCorrected = expectation !== 'installed';
const db = postgres(url, { max: 6, onnotice: () => {} });
const org = '10000000-0000-4000-8000-000000000001';
const otherOrg = '10000000-0000-4000-8000-000000000002';
const agent = '20000000-0000-4000-8000-000000000002';
const peer = '20000000-0000-4000-8000-000000000003';
const number = '40000000-0000-4000-8000-000000000001';
const alternate = '40000000-0000-4000-8000-000000000002';
const from = '+12025551111';
const alternateFrom = '+12025552222';
const identity = 'sticky_' + agent.replaceAll('-','');
const scope = 'private.affinity_voice_scope(uuid,uuid,uuid,text,text,uuid,uuid,boolean)';
const report = { expectation, started_at: new Date().toISOString(), checks: [] };
let sequence = 110;

async function actor(run, who = agent, organization = org) {
  return db.begin(async sql => {
    await sql.unsafe('SET LOCAL ROLE authenticated');
    await sql`select set_config('request.jwt.claims',${JSON.stringify({ sub: who, role:'authenticated', app_metadata:{ organization_id:organization, role:'Agent' } })},true)`;
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
  try { const detail = await run(); report.checks.push({name,status:'passed',...(detail ? {detail} : {})}); console.log('PASS',name); }
  catch(error) { report.checks.push({name,status:'failed',error:error.message,code:error.code,where:error.where}); console.error('FAIL',name,error.message); }
}
async function endpoint(history = 'new') {
  const c = { phone: '+12025550' + String(sequence++).padStart(3,'0') };
  if (history) await db`insert into private.contact_number_affinities(organization_id,phone_e164,history_state) values(${org},${c.phone},${history})`;
  return c;
}
async function saveContact(c,type='lead',owner=agent) {
  const id = randomUUID();
  if(type==='lead') await db`insert into public.leads(id,organization_id,first_name,last_name,phone,user_id,assigned_agent_id,status) values(${id},${org},'Synthetic','Manual dial',${c.phone},${owner},${owner},'New')`;
  else if(type==='client') await db`insert into public.clients(id,organization_id,first_name,last_name,phone,assigned_agent_id) values(${id},${org},'Synthetic','Manual dial',${c.phone},${owner})`;
  else await db`insert into public.recruits(id,organization_id,first_name,last_name,phone,assigned_agent_id) values(${id},${org},'Synthetic','Manual dial',${c.phone},${owner})`;
  return id;
}
async function affinity(c) { return (await db`select * from private.contact_number_affinities where organization_id=${org} and phone_e164=${c.phone}`)[0]; }
async function authorize(c,{id=randomUUID(),candidate=from,override=null,campaign=null,member=null,who=agent,organization=org}={}) {
  const result = (await actor(sql=>sql`select public.authorize_contact_call(${id},null,null,${c.phone},${candidate},${campaign},${member},${override},true) as v`,who,organization))[0].v;
  assert.equal(result.enabled,true);
  return {id,result,c};
}
async function row(call) {
  await actor(sql=>sql`insert into public.calls(id,attempt_id,organization_id,agent_id,contact_id,contact_type,contact_phone,caller_id_used,direction,status) values(${call.id},${call.id},${org},${agent},null,null,${call.c.phone},${call.result.number},'outbound','ringing')`);
  return call;
}
async function admit(call,parent='CA'+randomUUID().replaceAll('-','')) {
  return (await service(sql=>sql`select public.admit_twilio_outbound(${call.id},${identity},${call.c.phone},${call.result.number},${parent}) as v`))[0].v;
}
async function rejectAuthorize(c,match=/affinity_select_contact/,options={}) {
  const id=randomUUID();
  await assert.rejects(authorize(c,{...options,id}),match);
  assert.equal((await db`select count(*)::int n from private.contact_number_call_bindings where call_id=${id}`)[0].n,0);
}
async function rejectAdmission(call,match) {
  await assert.rejects(admit(call),match);
  assert.equal((await db`select dialer_provider_admitted from public.calls where id=${call.id}`)[0].dialer_provider_admitted,false);
  assert.equal((await db`select parent_sid from private.contact_number_call_bindings where call_id=${call.id}`)[0].parent_sid,null);
}
async function success(c) {
  const before = await affinity(c);
  const call = await row(await authorize(c));
  assert.equal(call.result.number,from);
  assert.equal(call.result.number_id,number);
  const receipt=await admit(call);
  assert.equal(receipt.admitted,true);
  const after=await affinity(c);
  assert.equal(after.voice_state,'unassigned'); assert.equal(after.sms_state,'unassigned');
  assert.equal(after.voice_number_id,null); assert.equal(after.sms_number_id,null);
  if(before) for(const key of ['generation','voice_version','sms_version','history_state']) assert.equal(after[key],before[key]);
  return {authenticated_authorization:true,service_admission:true,permanent_assignment_unchanged:true};
}
async function dnc(c) { await db`insert into public.dnc_list(organization_id,phone_number,added_by,reason) values(${org},${c.phone},${agent},'Synthetic manual dial guard')`; }
async function callbackEvidence(call) {
  const parent='CA'+randomUUID().replaceAll('-',''),child='CA'+randomUUID().replaceAll('-','');
  assert.equal((await admit(call,parent)).admitted,true);
  await service(sql=>sql`select public.record_call_duration_evidence(${call.id},'AC00000000000000000000000000000001',${parent},${child},${parent},47,'provider',1,now())`);
  await service(sql=>sql`update public.calls set status='completed',disposition_id='60000000-0000-4000-8000-000000000002',amd_result='human' where id=${call.id}`);
  const evidence=(await service(sql=>sql`select public.record_outbound_dial_evidence('AC00000000000000000000000000000001','AC00000000000000000000000000000001',${parent},${child},'completed',${'client:'+identity},${call.c.phone},'AC00000000000000000000000000000001',${'client:'+identity},'AC00000000000000000000000000000001',${parent},${call.c.phone},${call.result.number},'completed',now()) as v`))[0].v;
  assert.equal(evidence.recorded,true);
  return {parent,child};
}
async function unchangedPinCall(c, options={}) {
  const before=await affinity(c);
  const selected=before.voice_number_id || before.sms_number_id;
  if(!corrected) {await rejectAuthorize(c);return {installed_or_r1_pin_defect_reproduced:true};}
  const call=await row(await authorize(c,{candidate:alternateFrom,...options}));
  assert.equal(call.result.number_id,selected);assert.equal((await admit(call)).admitted,true);
  const after=await affinity(c);
  for(const key of ['generation','voice_version','sms_version','voice_number_id','sms_number_id','voice_state','sms_state'])assert.equal(after[key],before[key]);
  return {bound_number:call.result.number,admitted:true,assignment_unchanged:true};
}

try {
  report.runtime=(await db`select version(),current_user,session_user,rolsuper,rolbypassrls from pg_roles where rolname=current_user`)[0];
  assert.equal(report.runtime.current_user,'postgres'); assert.equal(report.runtime.rolsuper,false); assert.match(report.runtime.version,/^PostgreSQL 17\./);
  assert.equal((await db`select count(*)::int n from public.organizations where id=${org}`)[0].n,0,'Fresh synthetic candidate required');
  await db.unsafe(await fs.readFile('scripts/sticky-numbers/fixtures.sql','utf8'));

  await test('Reconciled empty endpoint reproduces installed denial and corrected authorize plus admission',async()=>{
    const c=await endpoint('reconciled');
    if(!emptyCorrected) { await rejectAuthorize(c); return {installed_defect_reproduced:'affinity_select_contact',desired_result:'authorized_and_admitted'}; }
    return success(c);
  });
  await test('Genuinely new unsaved number without any affinity still authorizes and admits',()=>endpoint(null).then(success));
  await test('Existing empty new-history endpoint still authorizes and admits',()=>endpoint('new').then(success));
  await test('Guard-only allows reconciled empty manual call without creating a pin',async()=>{
    const c=await endpoint('reconciled');
    await service(sql=>sql`select public.set_contact_number_modes(${org},'guard_only','enforced')`);
    try { if(!emptyCorrected) {await rejectAuthorize(c); return {installed_defect_reproduced:true};} return await success(c); }
    finally {await service(sql=>sql`select public.set_contact_number_modes(${org},'enforced','enforced')`);}
  });
  for(const type of ['lead','client','recruit']) for(const owner of [agent,peer]) await test(`Saved ${owner===agent?'owned':'hidden'} ${type} cannot use unsaved mode`,async()=>{
    const c=await endpoint('new'); await saveContact(c,type,owner); await rejectAuthorize(c);
  });
  await test('Unsaved Call Back plus provider evidence recovers a pin and repeat admission honors it',async()=>{
    const c=await endpoint('new');const first=await row(await authorize(c));
    const evidence=await callbackEvidence(first);
    assert.equal((await affinity(c)).voice_state,'unassigned','Late dial evidence waits for authorized recovery');
    const repeat=await row(await authorize(c,{candidate:alternateFrom}));
    const established=await affinity(c);assert.equal(established.voice_state,'established');assert.equal(established.voice_number_id,number);
    assert.equal(established.voice_event,first.id);assert.equal(repeat.result.number,from,'Wrong candidate cannot replace recovered pin');
    if(corrected) {assert.equal((await admit(repeat)).admitted,true);await unchangedPinCall(c);}
    else await rejectAdmission(repeat,/affinity_select_contact/);
    return {provider_evidence:evidence,qualified_call:first.id,pinned_number:from,repeat_admitted:corrected,installed_or_r1_admission_defect_reproduced:!corrected};
  });
  for(const channel of ['voice','sms']) await test(`No-contact established ${channel} relationship reuses its pin despite a different candidate`,async()=>{
    const c=await endpoint('new');
    await db.unsafe(`update private.contact_number_affinities set ${channel}_number_id=$1,${channel}_number=$2,${channel}_state='established' where organization_id=$3 and phone_e164=$4`,[number,from,org,c.phone]);
    return unchangedPinCall(c);
  });
  await test('Reconciled no-contact dual-channel identities retain voice priority without changing SMS',async()=>{
    const c=await endpoint('reconciled');await db`update private.contact_number_affinities set voice_number_id=${number},voice_number=${from},voice_state='established',sms_number_id=${alternate},sms_number=${alternateFrom},sms_state='established' where organization_id=${org} and phone_e164=${c.phone}`;
    return unchangedPinCall(c);
  });
  await test('One-call override plus qualifying conversation stays nonpermanent for an unsaved endpoint',async()=>{
    const c=await endpoint('new'),first=await row(await authorize(c,{override:alternate}));assert.equal(first.result.number_id,alternate);
    await callbackEvidence(first);
    const repeat=await row(await authorize(c));assert.equal(repeat.result.number_id,number);
    assert.equal((await affinity(c)).voice_state,'unassigned');assert.equal((await affinity(c)).sms_state,'unassigned');
    assert.equal((await admit(repeat)).admitted,true);
  });
  if(corrected) await test('Guard-only reuses an existing no-contact pin without rotation',async()=>{
    const c=await endpoint('reconciled');await db`update private.contact_number_affinities set voice_number_id=${number},voice_number=${from},voice_state='established' where organization_id=${org} and phone_e164=${c.phone}`;
    await service(sql=>sql`select public.set_contact_number_modes(${org},'guard_only','enforced')`);
    try{return await unchangedPinCall(c);}finally{await service(sql=>sql`select public.set_contact_number_modes(${org},'enforced','enforced')`);}
  });
  await test('Reserved SMS sender cannot be bypassed through unsaved mode',async()=>{
    const c=await endpoint('new');
    await db`update private.contact_number_affinities set sms_number_id=${number},sms_number=${from},sms_state='reserved' where organization_id=${org} and phone_e164=${c.phone}`;
    await rejectAuthorize(c);
  });
  for(const field of ['history_state','voice_state','sms_state']) await test(`Reconciled endpoint with ${field} review remains refused`,async()=>{
    const c=await endpoint('reconciled');
    await db.unsafe(`update private.contact_number_affinities set ${field}='needs_review' where organization_id=$1 and phone_e164=$2`,[org,c.phone]);
    await rejectAuthorize(c);
  });
  if(corrected) for(const channel of ['voice','sms']) await test(`New-history empty ${channel} review is explicitly refused before binding`,async()=>{
    const c=await endpoint('new');
    await db.unsafe(`update private.contact_number_affinities set ${channel}_state='needs_review' where organization_id=$1 and phone_e164=$2`,[org,c.phone]);
    await rejectAuthorize(c);
  });
  await test('Deleted number retained identity cannot be treated as an empty endpoint',async()=>{
    const c=await endpoint('new'), n=randomUUID();
    await db`insert into public.phone_numbers(id,organization_id,phone_number,status,assignment_type) values(${n},${org},'+12025553333','active','agency')`;
    await db`update private.contact_number_affinities set voice_number_id=${n},voice_number='+12025553333',voice_state='established' where organization_id=${org} and phone_e164=${c.phone}`;
    await db`delete from public.phone_numbers where id=${n}`;
    assert.equal((await affinity(c)).voice_number,'+12025553333'); await rejectAuthorize(c,corrected?/affinity_sender_unavailable/:/affinity_select_contact/);
  });
  await test('An unsaved personal-number pin is unavailable for automatic reuse even to its owner',async()=>{
    const c=await endpoint('new'),n=randomUUID();await db`insert into public.phone_numbers(id,organization_id,phone_number,status,assignment_type,assigned_to,daily_call_limit) values(${n},${org},'+12025556666','active','personal',${agent},100000)`;
    await db`update private.contact_number_affinities set voice_number_id=${n},voice_number='+12025556666',voice_state='established' where organization_id=${org} and phone_e164=${c.phone}`;
    await rejectAuthorize(c,corrected?/affinity_sender_unavailable/:/affinity_select_contact/);
  });
  await test('DNC still rejects unsaved authorization',async()=>{const c=await endpoint('new');await dnc(c);await rejectAuthorize(c,/affinity_dnc/);});
  await test('DNC committed after binding still refuses admission',async()=>{
    const c=await endpoint('new'), call=await row(await authorize(c)); await dnc(c);
    const result=await admit(call); assert.equal(result.admitted,false);assert.equal(result.reason,'dnc');
    assert.equal((await db`select dialer_provider_admitted from public.calls where id=${call.id}`)[0].dialer_provider_admitted,false);
  });
  await test('Inactive caller number remains unavailable',async()=>{
    const c=await endpoint('new');await db`update public.phone_numbers set status='released' where id=${number}`;
    try {await rejectAuthorize(c,/affinity_sender_unavailable/);} finally {await db`update public.phone_numbers set status='active' where id=${number}`;}
  });
  await test('Personal number ownership and explicit override remain enforced',async()=>{
    const c=await endpoint('new'), n=randomUUID(), phone='+12025554444';
    await db`insert into public.phone_numbers(id,organization_id,phone_number,status,assignment_type,assigned_to,daily_call_limit) values(${n},${org},${phone},'active','personal',${peer},100000)`;
    await rejectAuthorize(c,/affinity_sender_unavailable/,{candidate:phone});
    await rejectAuthorize(c,/affinity_sender_unavailable/,{override:n});
    const known=await endpoint('new');await saveContact(known);await rejectAuthorize(known,/affinity_select_contact/,{override:number});
  });
  await test('Inactive actor and mismatched organization cannot authorize',async()=>{
    const c=await endpoint('new');
    await rejectAuthorize(c,/affinity_actor/,{organization:otherOrg});
    await db`update public.profiles set status='Inactive' where id=${agent}`;
    try {await rejectAuthorize(c,/affinity_actor/);} finally {await db`update public.profiles set status='Active' where id=${agent}`;}
  });
  await test('Unsaved campaign and omitted active queue context remain refused',async()=>{
    const c=await endpoint('new'), campaign=randomUUID(),member=randomUUID(),group=randomUUID();
    await db`insert into public.number_groups(id,organization_id,name) values(${group},${org},'Synthetic manual guard')`;
    await db`insert into public.campaigns(id,organization_id,name,type,status,user_id,number_group_id) values(${campaign},${org},'Synthetic manual campaign','Open Pool','Active',${agent},${group})`;
    await db`insert into public.campaign_leads(id,organization_id,campaign_id,phone,user_id) values(${member},${org},${campaign},${c.phone},${agent})`;
    await rejectAuthorize(c,/affinity_campaign_scope/,{campaign,member});
    await db`insert into public.dialer_lead_locks(campaign_lead_id,campaign_id,organization_id,locked_by,expires_at,queue_issued_at) values(${member},${campaign},${org},${agent},now()+interval '10 minutes',now())`;
    await rejectAuthorize(c,/affinity_campaign_required/);
  });
  for(const type of ['lead','client','recruit']) await test(`Admission refuses ${type} saved after unsaved authorization`,async()=>{
    const c=await endpoint('new'),call=await row(await authorize(c));await saveContact(c,type,peer);await rejectAdmission(call,/affinity_select_contact/);
  });
  await test('Admission rechecks review appearing after authorization',async()=>{
    const c=await endpoint('new'),call=await row(await authorize(c));
    await db`update private.contact_number_affinities set history_state='needs_review' where organization_id=${org} and phone_e164=${c.phone}`;
    await rejectAdmission(call,/affinity_select_contact/);
  });
  if(corrected) for(const state of ['reserved','needs_review']) await test(`Admission refuses SMS ${state} introduced after an unsaved binding`,async()=>{
    const c=await endpoint('new'),call=await row(await authorize(c));
    await db`update private.contact_number_affinities set sms_number_id=${number},sms_number=${from},sms_state=${state} where organization_id=${org} and phone_e164=${c.phone}`;
    await rejectAdmission(call,/affinity_select_contact/);
  });
  await test('Admission rechecks expired binding and prevents another parent SID reuse',async()=>{
    const c=await endpoint('new'),call=await row(await authorize(c));
    await db`update private.contact_number_call_bindings set expires_at=now()-interval '1 second' where call_id=${call.id}`;
    await rejectAdmission(call,/affinity_admission_mismatch/);
    const live=await row(await authorize(await endpoint('new'))),parent='CA'+randomUUID().replaceAll('-','');
    assert.equal((await admit(live,parent)).admitted,true);
    await assert.rejects(admit(live),/affinity_admission_mismatch|call_parent_sid_mismatch|Outbound call identity mismatch/);
  });
  await test('Private scope helper has no application grants',async()=>{
    const roles=await db`select r.role,has_function_privilege(r.role,${scope},'EXECUTE') as execute from (values('anon'),('authenticated'),('service_role')) r(role)`;
    for(const grant of roles) assert.equal(grant.execute,false,grant.role);
    await assert.rejects(actor(sql=>sql`select private.affinity_voice_scope(${org},${agent},null,null,'+12025550101',null,null,true)`),/permission denied/);
  });
  report.scope=(await db`select pg_get_functiondef(p.oid) as definition,md5(pg_get_functiondef(p.oid)) as md5,pg_get_userbyid(p.proowner) as owner,p.prosecdef as security_definer,p.provolatile as volatility,p.proconfig as config,p.proacl::text as acl from pg_proc p where p.oid=to_regprocedure(${scope})`)[0];
  report.passed=report.checks.filter(x=>x.status==='passed').length;
  report.failed=report.checks.filter(x=>x.status==='failed').length;
  report.status=report.failed?'failed':'passed';
  if(report.failed)process.exitCode=1;
}catch(error){report.status='failed';report.fatal={message:error.message,code:error.code,where:error.where};process.exitCode=1;}
finally{report.finished_at=new Date().toISOString();await fs.writeFile(process.env.STICKY_RESULTS,JSON.stringify(report,null,2)+'\n');await db.end();console.log(JSON.stringify({status:report.status,passed:report.passed,failed:report.failed,fatal:report.fatal}));}
