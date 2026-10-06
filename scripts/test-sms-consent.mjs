// Disposable PostgreSQL engine; no environment credentials or remote database connections.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
let PGlite;
if (!process.env.SMS_NATIVE_PG) ({PGlite}=await import(pathToFileURL(resolve(process.env.A2P_PGLITE_MODULE)).href));
async function database(label) {
 if (!process.env.SMS_NATIVE_PG) return new PGlite();
 const url=new URL(process.env.SMS_NATIVE_PG);
 if(!['localhost','127.0.0.1'].includes(url.hostname)||!['postgres:','postgresql:'].includes(url.protocol)) throw Error('Native tests require disposable localhost PostgreSQL');
 const {default:postgres}=await import('postgres');const admin=postgres(url.toString(),{max:1});
 const name=`sms_test_${label}_${process.pid}`;await admin.unsafe(`create database ${name}`);url.pathname='/'+name;
 // PGlite receives serialized JSON parameters. Keep those bytes on the native
 // adapter too: postgres.js otherwise JSON.stringify's an already encoded array.
 const sql=postgres(url.toString(),{max:1,types:{json:{to:114,from:[114,3802],serialize:value=>typeof value==='string'?value:JSON.stringify(value),parse:JSON.parse}}});
 return {query:async(text,args=[])=>({rows:await sql.unsafe(text,args)}),exec:text=>sql.unsafe(text,[],{prepare:false}),url:url.toString(),close:async()=>{await sql.end();await admin.unsafe(`drop database ${name}`);await admin.end();}};
}
const uvRoot=process.env.UV_SOURCE_ROOT;
if(!uvRoot) throw Error('UV_SOURCE_ROOT must point to the reviewed UV checkout');
const uv=await database("uv"),af=await database("af");
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const org=id(1),agent='11111111-1111-1111-1111-111111111111',sender=id(2);
const query=async(db,sql,args=[]) => (await db.query(sql,args)).rows;
let checks=0; const ok=(v,label)=>{assert.ok(v,label);checks++;};
async function rejects(db,sql,args=[],pattern){await assert.rejects(()=>db.query(sql,args),pattern);checks++;}
try {
 await uv.exec(await readFile(`${uvRoot}/supabase/tests/harness_bootstrap.sql`,'utf8'));
 for(const f of (await readdir(`${uvRoot}/supabase/migrations`)).filter(x=>x.endsWith('.sql')).sort()) await uv.exec(await readFile(`${uvRoot}/supabase/migrations/${f}`,'utf8'));
 await uv.exec(await readFile(`${uvRoot}/supabase/tests/integration_seed.sql`,'utf8'));
 if (!process.env.SMS_NATIVE_PG) await af.exec("create role anon;create role authenticated;create role service_role bypassrls;");
 await af.exec(`create schema private;
 create table organizations(id uuid primary key);create table phone_numbers(id uuid primary key,organization_id uuid,phone_number text,status text);
 create table message_templates(id uuid primary key);create table messages(id uuid primary key default gen_random_uuid(),organization_id uuid,direction text,body text,from_number text,to_number text,status text,provider_message_id text,created_by uuid,sent_at timestamptz,contact_id uuid,contact_type text,lead_id uuid);
 create table dnc_list(organization_id uuid,phone_number text);
 grant usage on schema public,private to service_role;grant all on all tables in schema public to service_role;
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
 alter default privileges in schema public grant all on functions to anon,authenticated,service_role;`);
 const normalizer=await readFile('supabase/migrations/20260915035141_inbound_route_attempts_d13_and_recovery.sql','utf8');
 await af.exec(normalizer.slice(normalizer.indexOf('CREATE OR REPLACE FUNCTION private.phone_digits_e164ish'),normalizer.indexOf('CREATE OR REPLACE FUNCTION public.record_inbound_mobile_accept')));
 const dnc=await readFile('supabase/migrations/20261003043122_dialer_disposition_dnc_integrity.sql','utf8');
 await af.exec(dnc.slice(dnc.indexOf('CREATE FUNCTION private.dnc_phone_lock_key'),dnc.indexOf('CREATE FUNCTION private.guard_dnc_phone')));
 await af.exec('revoke all on function private.dnc_phone_lock_key(uuid,text),private.is_dnc_phone(uuid,text) from public,anon,authenticated,service_role;grant execute on function private.phone_digits_e164ish(text) to service_role;');
 const before=await query(af,"select proname,prosrc,proacl::text from pg_proc where pronamespace='private'::regnamespace order by proname");
 await af.exec(await readFile('supabase/migrations/20261005194649_sms_consent_dispatch.sql','utf8'));
 const after=await query(af,"select proname,prosrc,proacl::text from pg_proc where pronamespace='private'::regnamespace and proname in ('dnc_phone_lock_key','is_dnc_phone','phone_digits_e164ish') order by proname");
 assert.deepEqual(after,before);checks++;
 for(const db of [af,uv]) {
  const names=db===af?['sms_agency_policies','sms_suppressions','sms_suppression_events','sms_consent_inbox','sms_enrollments','sms_confirmation_jobs','sms_dispatches','sms_bridge_nonces']:['agentflow_consent_links','consent_bridge_nonces','consent_bridge_outbox'];
  for(const t of names) ok((await query(db,"select relrowsecurity and not has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') and not has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') as ok from pg_class where oid=$1::regclass",[`public.${t}`]))[0].ok,`RLS/ACL ${t}`);
 }
 await af.query('insert into organizations values($1)',[org]);await af.query('insert into phone_numbers values($1,$2,$3,$4)',[sender,org,'+19095550100','active']);
 await af.query("insert into sms_agency_policies(organization_id,enforced,send_enabled,uv_profile_id,uv_project,sender_name,selected_phone_ids,active_from) values($1,true,true,$2,'jzdzeevjpootbeuniygx','CG Financial',array[$3::uuid],now()-interval '1 minute')",[org,agent,sender]);
 await uv.query("insert into agentflow_consent_links(organization_id,agent_id,agency_slug,agent_slug,sender_name,sender_agency,relay_enabled,active_from) values($1,$2,'cg-financial','christopher-garness','Christopher Garness','CG Financial',true,now()-interval '1 minute')",[org,agent]);
 await uv.exec('set role service_role');await af.exec('set role service_role');
 const submit=async(n,info,market,requestKey=n+100)=>{
  const phone=`+1909555${String(n).padStart(4,'0')}`;
  await uv.query("select submit_public_intake($1,'quote','/sms-opt-in','cg-financial','christopher-garness','Synthetic','Consent','synthetic@example.test',$2,'California',$3,$4,'2026-10-05-policy-clarifications','')",[id(requestKey),phone,info,market]);
  const events=await query(uv,'select claim_consent_bridge_events() as e');const e=events.find(x=>x.e.phone===phone)?.e;assert.ok(e);
  await af.query('select sms_ingest_consent($1,$2,$3,$4,$5::jsonb,$6)',[org,agent,e.request_id,phone,JSON.stringify(e.events),'hash-'+n]);
  // Complete outbox checkpoint to make claim recovery deterministic.
  await uv.query('update consent_bridge_outbox set delivered_at=now() where request_id=$1',[e.request_id]);
  return {phone,e};
 };
 const none=await submit(1001,false,false),info=await submit(1002,true,false),marketing=await submit(1003,false,true),both=await submit(1004,true,true);
 ok((await query(af,'select count(*)::int n from sms_confirmation_jobs'))[0].n===3,'neither does not queue confirmation');
 for(const [v,purposes] of [[info,['informational']],[marketing,['marketing']],[both,['informational','marketing']]]) assert.deepEqual((await query(af,'select purposes from sms_confirmation_jobs where phone_e164=$1',[v.phone]))[0].purposes.sort(),purposes);
 checks+=3;
 await af.query('select sms_ingest_consent($1,$2,$3,$4,$5::jsonb,$6)',[org,agent,info.e.request_id,info.phone,JSON.stringify(info.e.events),'hash-1002']);
 ok((await query(af,'select count(*)::int n from sms_confirmation_jobs'))[0].n===3,'event replay no duplicate');
 await rejects(af,'select sms_ingest_consent($1,$2,$3,$4,$5::jsonb,$6)',[org,agent,info.e.request_id,info.phone,JSON.stringify(info.e.events),'altered'],/conflict/);
 await rejects(af,'select sms_ingest_consent($1,$2,$3,$4,$5::jsonb,$6)',[id(9),agent,info.e.request_id,info.phone,JSON.stringify(info.e.events),'hash'],/mapping/);
 await submit(1002,true,false,501);await submit(1002,false,false,502);
 ok((await query(af,'select count(*)::int n from sms_confirmation_jobs'))[0].n===3,'unchanged enrollment and later unchecked form do not queue again');
 const stale=structuredClone(info.e.events);stale.forEach(e=>e.created_at='2020-01-01T00:00:00Z');
 await af.query('select sms_ingest_consent($1,$2,$3,$4,$5::jsonb,$6)',[org,agent,id(503),'+19095559991',JSON.stringify(stale),'stale']);
 ok((await query(af,"select count(*)::int n from sms_confirmation_jobs where phone_e164='+19095559991'"))[0].n===0,'old source event cannot enroll across activation');
 await af.query('insert into sms_bridge_nonces(nonce) values($1)',[id(504)]);await rejects(af,'insert into sms_bridge_nonces(nonce) values($1)',[id(504)],/duplicate/);
 await uv.query('insert into consent_bridge_nonces(nonce) values($1)',[id(504)]);await rejects(uv,'insert into consent_bridge_nonces(nonce) values($1)',[id(504)],/duplicate/);
 for(const [db,fn] of [[af,'sms_record_suppression(uuid,text,text,text)'],[uv,'agentflow_consent_check(uuid,uuid,text,text)']]) ok((await query(db,"select not has_function_privilege('anon',$1,'execute') and not has_function_privilege('authenticated',$1,'execute') as ok",[fn]))[0].ok,'browser cannot invoke service consent RPC');
 const fresh=await query(uv,"select agentflow_consent_check($1,$2,$3,'informational') as c",[org,agent,info.phone]);ok(fresh[0].c.allowed,'fresh info eligibility');
 ok(!(await query(uv,"select agentflow_consent_check($1,$2,$3,'marketing') as c",[org,agent,info.phone]))[0].c.allowed,'info cannot authorize marketing');
 const prepare=async(v,key,purpose,confirmation=null)=>query(af,'select sms_prepare_dispatch($1,$2,$3,$4,$5,$6,$7,$8::uuid[],null,null,null,$9) as r',[org,key,v.phone,'+19095550100','Synthetic message',purpose,key,v.e.events.filter(x=>x.choice==='granted').map(x=>x.id),confirmation]);
 await rejects(af,'select sms_prepare_dispatch($1,$2,$3,$4,$5,$6,$7,$8::uuid[])',[org,'premature',info.phone,'+19095550100','Test','informational','hash',[info.e.events[0].id]],/confirmation_pending/);
 const job=(await query(af,'select * from sms_confirmation_jobs where phone_e164=$1',[info.phone]))[0];
 await prepare(info,'confirm','informational',job.id);
 ok((await query(af,'select sms_start_dispatch($1,$2) as started',[org,'confirm']))[0].started,'first start');
 ok(!(await query(af,'select sms_start_dispatch($1,$2) as started',[org,'confirm']))[0].started,'duplicate start blocked');
 await af.query("select sms_finish_dispatch($1,$2,'accepted',$3,'queued')",[org,'confirm','SM'+'1'.repeat(32)]);
 await af.query("select sms_finish_dispatch($1,$2,'accepted',$3,'queued')",[org,'confirm','SM'+'1'.repeat(32)]);
 ok((await query(af,'select count(*)::int n from messages'))[0].n===1,'accepted receipt repeated one history row');
 ok((await query(af,'select informational_confirmed from sms_enrollments where phone_e164=$1',[info.phone]))[0].informational_confirmed,'confirmation enables matching purpose');
 await prepare(info,'manual','informational');
 await af.query("select sms_record_suppression($1,$2,'stop','unknown-contact-stop')",[org,info.phone]);
 await rejects(af,'select sms_start_dispatch($1,$2)',[org,'manual'],/suppressed/);
 await uv.query("select agentflow_consent_suppress($1,$2,$3,'stop')",[org,agent,info.phone]);
 ok(!(await query(uv,"select agentflow_consent_check($1,$2,$3,'informational') as c",[org,agent,info.phone]))[0].c.allowed,'UV stops after durable relay');
 await submit(1002,true,true,505);
 ok(!(await query(uv,"select agentflow_consent_check($1,$2,$3,'marketing') as c",[org,agent,info.phone]))[0].c.allowed,'new form cannot clear STOP');
 await af.query("select sms_record_suppression($1,$2,'stop','before-grant')",[org,'+19095551005']);
 const stoppedFirst=await submit(1005,true,true);
 ok((await query(af,'select state from sms_confirmation_jobs where phone_e164=$1',[stoppedFirst.phone]))[0].state==='blocked','STOP before grant blocks new enrollment');
 await rejects(af,"update sms_suppressions set phone_e164='+19095559999'",[],/immutable/);
 await rejects(af,"update sms_consent_inbox set payload_hash='tampered'",[],/immutable/);
 await rejects(af,'update sms_agency_policies set enforced=false',[],/cannot_be_removed/);
 await af.query("insert into dnc_list values($1,'(909) 555-1003')",[org]);
 const mjob=(await query(af,'select id from sms_confirmation_jobs where phone_e164=$1',[marketing.phone]))[0];
 await assert.rejects(()=>prepare(marketing,'dnc','marketing',mjob.id),/suppressed/);checks++;
 await af.exec("update sms_confirmation_jobs set created_at=now()-interval '31 minutes' where state='pending'");
 await query(af,'select * from sms_claim_confirmations()');
 ok((await query(af,"select count(*)::int n from sms_confirmation_jobs where state='pending'"))[0].n===0,'old confirmations never replay');
 // Provider uncertainty persists and cannot start again.
 await af.query("delete from dnc_list where organization_id=$1",[org]);
 await af.query("update sms_enrollments set marketing_confirmed=true where phone_e164=$1",[marketing.phone]);
 await prepare(marketing,'uncertain','marketing');await af.query('select sms_start_dispatch($1,$2)',[org,'uncertain']);
 await af.query("select sms_finish_dispatch($1,$2,'uncertain',null,null,'timeout')",[org,'uncertain']);
 ok(!(await query(af,'select sms_start_dispatch($1,$2) as started',[org,'uncertain']))[0].started,'uncertain cannot auto resend');
 await af.exec('reset role');await uv.exec('reset role');
 ok((await query(af,"select not has_function_privilege('service_role','private.is_dnc_phone(uuid,text)','EXECUTE') as ok"))[0].ok,'private DNC ACL stays closed');
 if(af.url){
  const {default:postgres}=await import('postgres');const x=postgres(af.url,{max:1}),y=postgres(af.url,{max:1});
  await af.query("update sms_enrollments set marketing_confirmed=true where phone_e164=$1",[marketing.phone]);
  await prepare(marketing,'contended','marketing');
  try {
   const results=await Promise.all([x,y].map(c=>c.begin(async tx=>{await tx.unsafe('set local role service_role');return (await tx`select sms_start_dispatch(${org},'contended') as started`)[0].started;})));
   assert.deepEqual(results.sort(),[false,true]);checks++;
  } finally {await x.end();await y.end();}
 }
 console.log(`SMS_SQL_OK ${checks} assertions: real UV intake -> outbox -> AF enrollment -> confirmation -> dispatch -> STOP, isolation, evidence, expiry and receipt guards`);
} finally {await uv.close();await af.close();}
