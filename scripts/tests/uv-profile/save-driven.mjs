/** Actual migration on a synthetic database; Vault, pg_net and cron are inert stubs. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd();
const read=name=>readFile(path.join(root,'supabase/migrations',name),'utf8');
const native=process.env.UV_PROFILE_NATIVE_DB_URL;
let db,admin;
if(native){
  const url=new URL(native);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname),'Loopback only');
  const {default:postgres}=await import('postgres');admin=postgres(native,{max:1});
  await admin.unsafe('CREATE DATABASE uv_profile_saved_test');url.pathname='/uv_profile_saved_test';
  const sql=postgres(url.toString(),{max:1});
  db={exec:s=>sql.unsafe(s),query:async(s,args=[])=>({rows:await sql.unsafe(s,args)}),close:()=>sql.end()};
}else{
  const {PGlite}=await import(process.env.UV_PROFILE_PGLITE_MODULE??'@electric-sql/pglite');db=new PGlite();
}
const org='10000000-0000-4000-8000-000000000001',otherOrg='10000000-0000-4000-8000-000000000002';
const user='20000000-0000-4000-8000-000000000001',other='20000000-0000-4000-8000-000000000002';
await db.exec(`
SET TIME ZONE 'UTC';
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE FUNCTION public.get_org_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.org',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
CREATE TABLE public.organizations(id uuid PRIMARY KEY,status text DEFAULT 'active');
CREATE TABLE public.profiles(id uuid PRIMARY KEY,organization_id uuid,first_name text,last_name text,email text,phone text,avatar_url text,npn text,status text DEFAULT 'Active',availability text);
CREATE TABLE public.agent_state_licenses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,agent_id uuid,state text,license_number text,expiration_date date);
INSERT INTO public.organizations(id) VALUES('${org}'),('${otherOrg}');
INSERT INTO public.profiles(id,organization_id,first_name,last_name,email,phone) VALUES
('${user}','${org}','Test','Agent','synthetic@example.invalid','+15550001000'),
('${other}','${otherOrg}','Other','Agent','other@example.invalid','');
CREATE SCHEMA vault;
CREATE TABLE vault.decrypted_secrets(name text,decrypted_secret text);
INSERT INTO vault.decrypted_secrets VALUES('uv_profile_worker_token','synthetic-worker-token-never-production-00000000');
CREATE SCHEMA net;
CREATE TABLE net.requests(id bigserial,url text,body jsonb);
CREATE TABLE net.behavior(fail boolean DEFAULT false);
INSERT INTO net.behavior DEFAULT VALUES;
CREATE FUNCTION net.http_post(url text,body jsonb,headers jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE request_id bigint;
BEGIN
 IF (SELECT fail FROM net.behavior) THEN RAISE EXCEPTION 'synthetic_transport_failure'; END IF;
 IF headers->>'Authorization' IS DISTINCT FROM 'Bearer synthetic-worker-token-never-production-00000000' THEN RAISE EXCEPTION 'bad_auth'; END IF;
 IF url<>'https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/uv-profile-sync-worker' THEN RAISE EXCEPTION 'bad_destination'; END IF;
 IF body<>'{}'::jsonb OR timeout_milliseconds<>55000 THEN RAISE EXCEPTION 'bad_request'; END IF;
 INSERT INTO net.requests(url,body) VALUES(url,body) RETURNING id INTO request_id; RETURN request_id;
END $$;
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobid bigint PRIMARY KEY,jobname text UNIQUE,active boolean,schedule text,username text,command text);
CREATE FUNCTION cron.alter_job(job_id bigint,command text) RETURNS void LANGUAGE sql AS $$ UPDATE cron.job SET command=$2 WHERE jobid=$1 $$;
`);
const baseline=await read('20260806000000_baseline_production_schema.sql');
await db.exec(baseline.match(/CREATE OR REPLACE FUNCTION "public"\."normalize_us_state"[\s\S]*?\n\$\$;/)[0]);
await db.exec(await read('20261018002956_uv_profile_sync.sql'));
await db.exec(await read('20261018170007_uv_profile_exclusions.sql'));
const prior=await read('20261019013824_uv_agency_profile_activation.sql');
const command=prior.match(/\$job\$([\s\S]*?)\$job\$/)[1];
await db.query("INSERT INTO cron.job VALUES(14,'uv-profile-sync-every-minute',true,'* * * * *','postgres',$1),(15,'unrelated',true,'*/5 * * * *','postgres','SELECT 1;')",[command]);
const acl=(await db.query("SELECT proacl::text FROM pg_proc WHERE oid='public.finish_uv_profile_sync(uuid,uuid,uuid,bigint,jsonb,text)'::regprocedure")).rows[0].proacl;
await db.exec('BEGIN');await db.exec(await read('20261019015242_uv_profile_save_driven.sql'));await db.exec('COMMIT');
await db.exec(`INSERT INTO private.uv_profile_sources VALUES('${org}','Synthetic','synthetic',true);`);
let checks=0;
async function check(name,fn){await fn();checks++;console.log('PASS '+name);}
async function count(){return (await db.query('SELECT count(*)::int AS n FROM net.requests')).rows[0].n;}
async function state(){return (await db.query(`SELECT *,next_attempt_at::text AS next_due FROM private.uv_profile_sync WHERE organization_id='${org}' AND profile_id='${user}'`)).rows[0];}
async function dispatch(){return (await db.query('SELECT private.dispatch_uv_profile_sync() AS id')).rows[0].id;}
async function claim(){return (await db.query('SELECT public.claim_uv_profile_sync(5) AS jobs')).rows[0].jobs;}
async function prepare(job){return (await db.query('SELECT public.prepare_uv_profile_sync($1,$2,$3,false) AS data',[job.organization_id,job.profile_id,job.lease_token])).rows[0].data;}
async function finish(job,prepared,error=null){
 const env=prepared.envelope;
 const receipt=error?null:JSON.stringify({version:env.version,published:env.profile.published,warning:null,public_url:env.profile.published?'https://www.underwriterverified.com/synthetic/test-agent':null});
 return (await db.query('SELECT public.finish_uv_profile_sync($1,$2,$3,$4,$5::jsonb,$6) AS ok',[job.organization_id,job.profile_id,job.lease_token,env.version,receipt,error])).rows[0].ok;
}
async function drain(){const jobs=await claim();for(const job of jobs){const p=await prepare(job);assert.ok(p);assert.equal(await finish(job,p),true);}return jobs;}
async function prefs(published){
 await db.exec(`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${user}',true),set_config('request.jwt.claim.org','${org}',true);`);
 try{
  const row=(await db.query('SELECT public.get_my_uv_profile() AS data')).rows[0].data;
  await db.query('SELECT public.set_my_uv_profile($1,$2,$3,false,$3,$4)',[user,org,published,row.revision]);await db.exec('COMMIT');
 }catch(error){await db.exec('ROLLBACK');throw error;}
}
await check('migration changes only the UV cron command and preserves RPC ACL',async()=>{
 const jobs=(await db.query('SELECT * FROM cron.job ORDER BY jobid')).rows;
 assert.equal(jobs[0].command,'SELECT private.dispatch_uv_profile_sync();');assert.equal(jobs[0].schedule,'* * * * *');assert.equal(jobs[0].active,true);
 assert.equal(jobs[1].command,'SELECT 1;');
 assert.equal((await db.query("SELECT proacl::text FROM pg_proc WHERE oid='public.finish_uv_profile_sync(uuid,uuid,uuid,bigint,jsonb,text)'::regprocedure")).rows[0].proacl,acl);
 const grants=(await db.query("SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE') OR has_function_privilege('service_role',p.oid,'EXECUTE'))")).rows;
 assert.deepEqual(grants,[]);
});
await check('empty queue and unenrolled saves do not invoke worker',async()=>{
 assert.equal(await dispatch(),null);await db.exec(`UPDATE public.profiles SET first_name='Saved' WHERE id='${user}'`);
 assert.equal(await count(),0);assert.equal((await claim()).length,0);
});
await check('opt-in wakes queue, acknowledgment stops all idle work',async()=>{
 await prefs(false);assert.equal(await count(),0);assert.equal(await dispatch(),null);
 await prefs(true);assert.equal(await count(),1);assert.equal((await drain()).length,1);
 assert.equal((await state()).next_due,'infinity');const n=await count();
 for(let i=0;i<5;i++){assert.equal(await dispatch(),null);assert.deepEqual(await claim(),[]);}
 assert.equal(await count(),n);
});
await check('saved shared changes queue once, unchanged and availability saves do not',async()=>{
 const n=await count();await db.exec(`UPDATE public.profiles SET phone='+15550002000' WHERE id='${user}'`);assert.equal(await count(),n+1);
 assert.ok(Number((await state()).revision)>Number((await state()).delivered_revision));await drain();
 const after=await count();await db.exec(`UPDATE public.profiles SET phone=phone,availability='Available' WHERE id='${user}'`);
 assert.equal(await count(),after);assert.deepEqual(await claim(),[]);
});
await check('rolled-back save creates neither durable event nor HTTP request',async()=>{
 const n=await count();const before=await state();await db.exec(`BEGIN; UPDATE public.profiles SET first_name='RolledBack' WHERE id='${user}'; ROLLBACK;`);
 assert.equal(await count(),n);assert.equal((await state()).revision,before.revision);assert.deepEqual(await claim(),[]);
});
await check('dispatch failure does not block Save and durable work remains retryable',async()=>{
 await db.exec(`UPDATE net.behavior SET fail=true; UPDATE public.profiles SET first_name='Retryable' WHERE id='${user}'`);
 assert.equal((await db.query(`SELECT first_name FROM public.profiles WHERE id='${user}'`)).rows[0].first_name,'Retryable');
 assert.ok(Number((await state()).revision)>Number((await state()).delivered_revision));
 await db.exec('UPDATE net.behavior SET fail=false');assert.ok(await dispatch());assert.equal((await drain()).length,1);
});
await check('a newer save supersedes an in-flight acknowledgment',async()=>{
 await db.exec(`UPDATE public.profiles SET first_name='First' WHERE id='${user}'`);const [job]=await claim();const prepared=await prepare(job);
 await db.exec(`UPDATE public.profiles SET first_name='Newest' WHERE id='${user}'`);assert.equal(await finish(job,prepared),false);
 const [next]=await claim();const latest=await prepare(next);assert.equal(latest.envelope.profile.first_name,'Newest');assert.equal(await finish(next,latest),true);
});
await check('failed delivery backs off; live lease is not repeatedly dispatched',async()=>{
 await db.exec(`UPDATE public.profiles SET npn='9876' WHERE id='${user}'`);const [job]=await claim();assert.equal(await dispatch(),null);
 const prepared=await prepare(job);assert.equal(await finish(job,prepared,'temporarily_unavailable'),true);
 assert.equal((await state()).attempts,1);assert.equal(await dispatch(),null);assert.deepEqual(await claim(),[]);
 await db.exec(`UPDATE private.uv_profile_sync SET next_attempt_at=now()-interval '1 second'`);assert.ok(await dispatch());await drain();
 assert.equal((await state()).next_due,'infinity');
});
await check('expired crashed-worker lease recovers only its pending item',async()=>{
 await db.exec(`UPDATE public.profiles SET last_name='Recovery' WHERE id='${user}'`);const [job]=await claim();assert.ok(job);assert.equal(await dispatch(),null);
 await db.exec("UPDATE private.uv_profile_sync SET lease_expires_at=now()-interval '1 second'");assert.ok(await dispatch());assert.equal((await drain()).length,1);
});
await check('license saves queue updates and schedule only the next exact expiry',async()=>{
 await db.exec(`INSERT INTO public.agent_state_licenses(organization_id,agent_id,state,license_number,expiration_date) VALUES('${org}','${user}','CA','VALID',current_date)`);
 const [job]=await claim();const prepared=await prepare(job);assert.deepEqual(prepared.envelope.profile.state_licenses,['CA - #VALID']);await finish(job,prepared);
 assert.equal((await db.query(`SELECT next_attempt_at=((current_date+1)::timestamp AT TIME ZONE 'UTC') AS correct FROM private.uv_profile_sync`)).rows[0].correct,true);
 assert.equal(await dispatch(),null);
 await db.exec(`INSERT INTO public.agent_state_licenses(organization_id,agent_id,state,license_number,expiration_date) VALUES('${org}','${user}','CA','VALID',current_date-1)`);
 await drain();assert.equal((await db.query(`SELECT next_attempt_at=((current_date+1)::timestamp AT TIME ZONE 'UTC') AS correct FROM private.uv_profile_sync`)).rows[0].correct,true);
 await db.exec('DELETE FROM public.agent_state_licenses');await drain();assert.equal((await state()).next_due,'infinity');
});
await check('source disable sends withdrawal, reenable queues saved public choice',async()=>{
 await db.exec('UPDATE private.uv_profile_sources SET enabled=false');const [job]=await claim();const p=await prepare(job);assert.equal(p.envelope.profile.published,false);await finish(job,p);
 assert.equal((await state()).next_due,'infinity');await db.exec('UPDATE private.uv_profile_sources SET enabled=true');await drain();assert.equal((await state()).remote_published,true);
});
await check('excluded profiles never wake, claim or change their sync revision',async()=>{
 await db.exec(`INSERT INTO private.uv_profile_exclusions VALUES('${org}','${user}');`);
 const before=await state(),n=await count();await db.exec(`UPDATE public.profiles SET first_name='Protected' WHERE id='${user}'`);
 assert.equal((await state()).revision,before.revision);assert.equal(await count(),n);
 await db.exec("UPDATE private.uv_profile_sync SET next_attempt_at=now()-interval '1 second'");assert.equal(await dispatch(),null);assert.deepEqual(await claim(),[]);
 await db.exec('DELETE FROM private.uv_profile_exclusions');await drain();
});
await check('deactivation withdraws and does not automatically republish',async()=>{
 await db.exec(`UPDATE public.profiles SET status='Inactive' WHERE id='${user}'`);await drain();assert.equal((await state()).desired_published,false);assert.equal((await state()).remote_published,false);
 await db.exec(`UPDATE public.profiles SET status='Active' WHERE id='${user}'`);assert.deepEqual(await claim(),[]);await prefs(true);await drain();
});
await check('tenant transfer withdraws old link without enrolling new tenant',async()=>{
 await db.exec(`UPDATE public.profiles SET organization_id='${otherOrg}' WHERE id='${user}'`);await drain();assert.equal((await state()).remote_published,false);
 assert.equal((await db.query(`SELECT count(*)::int AS n FROM private.uv_profile_sync WHERE organization_id='${otherOrg}'`)).rows[0].n,0);
 await db.exec(`UPDATE public.profiles SET organization_id='${org}' WHERE id='${user}'`);await prefs(true);await drain();
});
await check('deletion retains a delivery tombstone and withdraws once',async()=>{
 await db.exec(`DELETE FROM public.profiles WHERE id='${user}'`);assert.equal((await drain()).length,1);
 assert.equal((await state()).remote_published,false);assert.equal((await state()).next_due,'infinity');assert.equal(await dispatch(),null);
});
console.log(`PASS ${checks} save-driven SQL scenarios (${native?'native PostgreSQL':'PGlite'}; HTTP/Vault/cron stubs)`);
await db.close();if(admin)await admin.end();
