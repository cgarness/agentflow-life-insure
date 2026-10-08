import assert from 'node:assert/strict';

// Imported by the paired disposable SQL harness; never connects to production.
export async function testStartLifecycle({af,uv,org,agent,sender,query,submit,prepare,id}) {
 let checks=0,serial=100;
 const ok=(value,label)=>{assert.ok(value,label);checks++;};
 const rejects=async(fn,pattern)=>{await assert.rejects(fn,pattern);checks++;};
 const sid=()=>`SM${(++serial).toString(16).padStart(32,'0')}`;
 const base=Math.ceil(Date.now()/1000)*1000+2000;
 const at=n=>new Date(base+n*1000).toISOString();
 await af.query("update sms_agency_policies set start_enabled=true,start_active_from=now()-interval '1 hour' where organization_id=$1",[org]);
 await uv.query("update agentflow_consent_links set start_enabled=true,start_active_from=now()-interval '1 hour' where organization_id=$1",[org]);
 const state=async v=>(await query(af,'select * from sms_recipient_lifecycle where organization_id=$1 and phone_e164=$2',[org,v.phone]))[0];
 const blocked=async v=>(await query(af,'select sms_recipient_blocked($1,$2) b',[org,v.phone]))[0].b;
 const decision=async(v,purpose='informational')=>(await query(uv,'select agentflow_consent_check($1,$2,$3,$4) c',[org,agent,v.phone,purpose]))[0].c;
 const confirm=async v=>af.query('update sms_enrollments set informational_confirmed=informational_event is not null,marketing_confirmed=marketing_event is not null where organization_id=$1 and phone_e164=$2',[org,v.phone]);
 const proof=async(v,message,kind,time)=>af.query('select sms_verify_keyword($1,$2,$3,$4,$5,$6)',[org,message,v.phone,'+19095550100',kind,time]);
 const stop=async(v,time=at(0),verify=true)=>{
  const message=sid();await af.query("select sms_record_suppression($1,$2,'stop',$3)",[org,v.phone,`inbound:${message}`]);
  if(verify)await proof(v,message,'STOP',time);return message;
 };
 const start=async(v,time=at(2))=>{
  const message=sid();await af.query('select sms_receive_start($1,$2,$3)',[org,v.phone,message]);
  await proof(v,message,'START',time);return message;
 };
 const deliver=async(v,s)=>{
  const r=(await query(uv,'select agentflow_consent_lifecycle($1,$2,$3,$4,$5,$6,$7,$8,$9) r',
   [org,agent,v.phone,s.revision,s.informational_restored,s.start_event_id,s.prior_consent_event,s.first_stop_at,s.start_at]))[0].r;
  return r;
 };
 const sync=async v=>{
  const s=await state(v);const r=await deliver(v,s);
  assert.equal(Number(r.revision),Number(s.revision));
  await af.query('select sms_ack_lifecycle($1,$2,$3,$4)',[org,v.phone,s.revision,s.informational_restored]);
  return s;
 };
 await af.exec('set role service_role');await uv.exec('set role service_role');
 const info=await submit(2001,true,false);await confirm(info);
 await prepare(info,'before-stop-start','informational');
 const stopSid=await stop(info);await sync(info);
 ok(await blocked(info),'STOP blocks before re-enrollment');
 const startSid=await start(info);const candidate=await state(info);
 ok(candidate.informational_restored,'verified START proposes informational restoration');
 ok(await blocked(info),'AF blocked until cross-project acknowledgment');
 ok(!(await decision(info)).allowed,'UV still blocked until lifecycle delivery');
 await sync(info);
 ok(!await blocked(info),'AF restored after matching UV acknowledgment');
 const restored=await decision(info);
 ok(restored.allowed&&restored.evidence.some(e=>e.source==='verified_start'),'UV returns original plus new immutable re-enrollment evidence');
 ok(!(await decision(info,'marketing')).allowed,'START never grants marketing');
 await rejects(()=>af.query('select sms_start_dispatch($1,$2)',[org,'before-stop-start']),/consent_changed/);
 await prepare(info,'fresh-after-start','informational');
 ok((await query(af,'select sms_start_dispatch($1,$2) b',[org,'fresh-after-start']))[0].b,'new informational dispatch permitted');
 const oldWorkflow=id(9901),newWorkflow=id(9902);
 await af.query('insert into workflow_executions values($1,$2,$3),($4,$2,$5)',[oldWorkflow,org,at(-1),newWorkflow,at(3)]);
 await rejects(()=>prepare(info,`workflow:${oldWorkflow}:n1`,'informational'),/workflow_reenrollment/);
 await prepare(info,`workflow:${newWorkflow}:n1`,'informational');checks++;
 const revision=(await state(info)).revision;
 await af.query('select sms_receive_start($1,$2,$3)',[org,info.phone,startSid]);
 await proof(info,startSid,'START',at(2));
 ok(Number((await state(info)).revision)===Number(revision),'duplicate START does not create another revision');
 await rejects(()=>proof(info,startSid,'START',at(3)),/event_conflict/);
 await stop(info,at(4));const later=await state(info);
 ok(await blocked(info),'new STOP wins immediately while relay pending');
 ok(!(await query(af,'select sms_ack_lifecycle($1,$2,$3,true) b',[org,info.phone,candidate.revision]))[0].b,'stale acknowledgment cannot reopen AF');
 await sync(info);await deliver(info,candidate);
 ok(!(await decision(info)).allowed,'out-of-order old START snapshot cannot overwrite newer STOP');
 await start(info,at(3));await sync(info);
 ok(await blocked(info),'late START older than STOP stays blocked');
 await start(info,at(4));await sync(info);
 ok(await blocked(info),'same-second STOP/START ambiguity stays blocked');
 await start(info,at(6));await sync(info);
 ok(!await blocked(info),'newer verified START resumes informational permission');
 await proof(info,stopSid,'STOP',at(0));
 ok(!await blocked(info),'duplicate historical STOP cannot regress current state');
 const delayed=await stop(info,at(1),false);
 ok(await blocked(info),'unverified delayed STOP blocks until provenance resolved');
 await proof(info,delayed,'STOP',at(1));await sync(info);
 ok(!await blocked(info),'verified older STOP respects provider event order');
 await rejects(()=>af.query('update sms_keyword_events set occurred_at=now()'),/immutable/);
 await rejects(()=>uv.query('delete from sms_lifecycle_receipts'),/permission|immutable/);

 for(const [n,i,m] of [[2002,false,false],[2003,false,true],[2004,true,true]]) {
  const v=await submit(n,i,m);await confirm(v);await stop(v);await start(v);await sync(v);
  ok((await decision(v)).allowed===i,`START preserves informational scope ${n}`);
  ok(!(await decision(v,'marketing')).allowed,`START cannot restore marketing ${n}`);
  if(m&&i)await rejects(()=>prepare(v,'dual-marketing','marketing'),/suppressed/);
 }
 const unknown={phone:'+19095552999'};
 await af.query('select sms_receive_start($1,$2,$3)',[org,unknown.phone,sid()]);
 ok((await query(af,'select count(*)::int n from sms_keyword_jobs where phone_e164=$1',[unknown.phone]))[0].n===0,'unknown START does not enroll or create suppression');
 const hard=await submit(2005,true,false);await confirm(hard);await stop(hard);
 await af.query("select sms_record_suppression($1,$2,'provider_block','dispatch:independent')",[org,hard.phone]);
 await start(hard);await sync(hard);ok(await blocked(hard),'START cannot erase independent provider block');
 const operator=await submit(2006,true,false);await confirm(operator);await stop(operator);
 await af.query("select sms_record_suppression($1,$2,'stop','operator:revocation')",[org,operator.phone]);
 await start(operator);await sync(operator);ok(await blocked(operator),'START cannot erase operator revocation');
 const dnc=await submit(2007,true,false);await confirm(dnc);await stop(dnc);await start(dnc);await sync(dnc);
 await af.query('insert into dnc_list values($1,$2)',[org,dnc.phone]);
 ok(await blocked(dnc),'independent agency DNC remains enforced');
 const independent=await submit(2008,true,false);await confirm(independent);await stop(independent);await start(independent);await sync(independent);
 await uv.query("select record_sms_suppression($1,$2,'stop','direct_support')",[agent,independent.phone]);
 ok(!(await decision(independent)).allowed,'independent UV revocation wins over acknowledged START');
 const deniedAck=await deliver(independent,await state(independent));
 ok(deniedAck.restored&&!deniedAck.informational_allowed,'UV acknowledgment exposes independent denial so worker cannot reopen AF');
 const oldStart=sid();await af.query('select sms_receive_start($1,$2,$3)',[org,info.phone,oldStart]);
 await rejects(()=>proof(info,oldStart,'START','2020-01-01T00:00:00Z'),/keyword_scope/);
 await rejects(()=>proof(info,sid(),'START',at(6)),/no rows/);
 await rejects(()=>af.query('select sms_verify_keyword($1,$2,$3,$4,$5,$6)',[org,startSid,info.phone,'+19095550199','START',at(2)]),/keyword_scope/);
 await rejects(()=>deliver(info,{...later,informational_restored:true,start_event_id:id(9950),prior_consent_event:info.e.events.find(e=>e.choice==='granted').id,first_stop_at:at(0),start_at:at(2)}),/conflict/);
 await rejects(()=>deliver(info,{...later,start_event_id:id(9950)}),/lifecycle_input/);
 const originalGrant=info.e.events.find(e=>e.purpose==='informational'&&e.choice==='granted');
 await rejects(()=>deliver(info,{...later,revision:999,informational_restored:true,start_event_id:id(9950),prior_consent_event:originalGrant.id,first_stop_at:'2020-01-01T00:00:00Z',start_at:at(2)}),/grant_scope/);
 await af.query("update phone_numbers set assignment_type='personal' where id=$1",[sender]);
 await rejects(()=>proof(info,startSid,'START',at(2)),/keyword_scope/);
 await af.query("update phone_numbers set assignment_type='agency' where id=$1",[sender]);
 const senderIds=[sender];let pauseTarget=info;
 for(let n=1;n<5;n++) {
  const numberId=id(9800+n);senderIds.push(numberId);
  await af.query("insert into phone_numbers(id,organization_id,phone_number,status) values($1,$2,$3,'active')",[numberId,org,`+1909555010${n}`]);
 }
 await af.query('update sms_agency_policies set selected_phone_ids=$2::uuid[] where organization_id=$1',[org,senderIds]);
 for(let n=0;n<5;n++) {
  const v=await submit(2010+n,true,false);await confirm(v);await stop(v);
  const message=sid();await af.query('select sms_receive_start($1,$2,$3)',[org,v.phone,message]);
  await af.query('select sms_verify_keyword($1,$2,$3,$4,$5,$6)',[org,message,v.phone,`+1909555010${n}`,'START',at(2)]);
  await sync(v);ok(!await blocked(v),`consistent selected sender ${n+1}`);
  if(n===0)pauseTarget=v;
 }
 if(af.url) {
  const {default:postgres}=await import('postgres');const clients=[0,1,2,3].map(()=>postgres(af.url,{max:1}));
  const [x,y,z,observer]=clients;let release,ready;
  const hold=new Promise(r=>release=r),locked=new Promise(r=>ready=r);const tasks=[];
  const newStop=sid(),racingStart=sid();
  await prepare(info,'stop-start-send-race','informational');
  await af.query('select sms_receive_start($1,$2,$3)',[org,info.phone,racingStart]);
  try {
   tasks.push(x.begin(async tx=>{
    await tx.unsafe('set local role service_role');
    await tx`select sms_record_suppression(${org},${info.phone},'stop',${`inbound:${newStop}`})`;
    await tx`select sms_verify_keyword(${org},${newStop},${info.phone},'+19095550100','STOP',${at(20)})`;
    ready();await hold;
   }));
   await Promise.race([locked,tasks[0]]);
   tasks.push(y.begin(async tx=>{
    await tx.unsafe('set local role service_role');
    await tx`select set_config('application_name','sms_start_racing_proof',true)`;
    await tx`select sms_verify_keyword(${org},${racingStart},${info.phone},'+19095550100','START',${at(19)})`;
   }));
   const send=z.begin(async tx=>{
    await tx.unsafe('set local role service_role');
    await tx`select set_config('application_name','sms_start_racing_send',true)`;
    await tx`select sms_start_dispatch(${org},'stop-start-send-race')`;
   }).then(()=>null,e=>e.message);tasks.push(send);
   const deadline=Date.now()+3000;
   for(;;) {
    const [r]=await observer`select count(*)::int n from pg_stat_activity where application_name in ('sms_start_racing_proof','sms_start_racing_send') and wait_event='advisory'`;
    if(r.n===2)break;
    if(Date.now()>deadline)throw Error('START proof and dispatch did not reach shared recipient lock');
    await new Promise(r=>setTimeout(r,10));
   }
   ok(true,'real START and final dispatch both wait behind the STOP transaction');
   release();await Promise.all(tasks);
   ok(/suppressed/.test(await send),'in-flight final dispatch sees the newly committed STOP');
   ok(await blocked(info),'concurrent older START cannot supersede newer STOP');
  } finally {release();await Promise.allSettled(tasks);await Promise.all(clients.map(c=>c.end({timeout:2})));}
 }
 for(const [db,tables] of [[af,['sms_keyword_jobs','sms_keyword_events','sms_recipient_lifecycle']],[uv,['sms_lifecycle_receipts','sms_independent_revocations']]]) {
  for(const t of tables)ok((await query(db,"select relrowsecurity and not has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') and not has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') b from pg_class where oid=$1::regclass",[`public.${t}`]))[0].b,`server-only RLS ${t}`);
 }
 for(const [db,names] of [[af,['sms_lifecycle_refresh','sms_receive_start','sms_verify_keyword','sms_ack_lifecycle','sms_effectively_suppressed']],[uv,['agentflow_consent_lifecycle']]]) {
  ok((await query(db,"select count(*)::int n,bool_and(not prosecdef and not has_function_privilege('anon',oid,'EXECUTE') and not has_function_privilege('authenticated',oid,'EXECUTE') and has_function_privilege('service_role',oid,'EXECUTE')) b from pg_proc where pronamespace='public'::regnamespace and proname=any($1::text[])",[names]))[0].b,'new lifecycle RPCs are service-only SECURITY INVOKER');
 }
 await af.query('update sms_agency_policies set start_enabled=false where organization_id=$1',[org]);
 ok(await blocked(pauseTarget),'feature pause fails closed without deleting evidence');
 await uv.query('update agentflow_consent_links set start_enabled=false where organization_id=$1',[org]);
 ok(!(await decision(pauseTarget)).allowed,'UV feature pause also fails closed');
 return checks;
}
