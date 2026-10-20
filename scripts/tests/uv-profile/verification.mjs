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
  await admin.unsafe('CREATE DATABASE uv_profile_verification_test');url.pathname='/uv_profile_verification_test';
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
 const receipt=error?null:{version:env.version,published:env.profile.published,warning:null,public_url:env.profile.published?'https://www.underwriterverified.com/synthetic/test-agent':null};
 const parameter=receipt!==null&&!native?JSON.stringify(receipt):receipt;
 return (await db.query('SELECT public.finish_uv_profile_sync($1,$2,$3,$4,$5::jsonb,$6) AS ok',[job.organization_id,job.profile_id,job.lease_token,env.version,parameter,error])).rows[0].ok;
}
async function drain(){const jobs=await claim();for(const job of jobs){const p=await prepare(job);assert.ok(p);assert.equal(await finish(job,p),true);}return jobs;}
async function prefs(published){
 await db.exec(`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${user}',true),set_config('request.jwt.claim.org','${org}',true);`);
 try{
  const row=(await db.query('SELECT public.get_my_uv_profile() AS data')).rows[0].data;
  await db.query('SELECT public.set_my_uv_profile($1,$2,$3,false,$3,$4)',[user,org,published,row.revision]);await db.exec('COMMIT');
 }catch(error){await db.exec('ROLLBACK');throw error;}
}
await db.exec('BEGIN');await db.exec(await read('20261019032157_uv_profile_verification_wizard.sql'));await db.exec('COMMIT');
await db.exec('BEGIN');await db.exec(await read('20261020171244_uv_personal_brand.sql'));await db.exec('COMMIT');
async function actor(fn,id=user,organization=org,role='authenticated') {
 await db.exec(`BEGIN; SET LOCAL ROLE ${role}; SELECT set_config('request.jwt.claim.sub','${id}',true),set_config('request.jwt.claim.org','${organization}',true);`);
 try{const value=await fn();await db.exec('COMMIT');return value;}catch(e){await db.exec('ROLLBACK');throw e;}
}
async function setup(){return (await db.query('SELECT public.get_my_uv_setup() AS data')).rows[0].data;}
async function verification(){return (await db.query('SELECT public.get_my_uv_verification() AS data')).rows[0].data;}
async function complete(snapshot,draft=snapshot.draft,profileId=user,organizationId=org) {
 const value=native?draft:JSON.stringify(draft);
 return (await db.query('SELECT public.complete_my_uv_setup($1,$2,$3,$4,$5::jsonb,true,true) AS data',
 [profileId,organizationId,snapshot.revision,snapshot.snapshot,value])).rows[0].data;
}
const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4l8AAAAASUVORK5CYII=';
let snapshot;
await check('setup is prefilled, no existing profile is auto-confirmed',async()=>{
 snapshot=await actor(setup);assert.equal(snapshot.draft.first_name,'Test');assert.equal(snapshot.draft.licenses.length,0);
 assert.equal((await actor(verification)).verified,false);
});
const valid={...snapshot.draft,first_name:'Wizard',last_name:'Agent',phone:'+15550001000',email:'wizard@example.invalid',npn:'123456',avatar_url:photo,
 bio:'I help families. <script>literal text only</script>',licenses:[{id:null,state:'California',license_number:'NO-DATE',expiration_date:null}]};
await check('every required field is enforced atomically with no partial save',async()=>{
 for(const field of ['first_name','last_name','phone','email','npn','avatar_url','licenses']) {
  const bad={...valid,[field]:field==='licenses'?[]:''};
  await assert.rejects(()=>actor(()=>complete(snapshot,bad)));
  assert.equal((await actor(setup)).snapshot,snapshot.snapshot);
 }
});
await check('foreign identity and protected owner cannot complete',async()=>{
 await assert.rejects(()=>actor(()=>complete(snapshot,valid,other,otherOrg)));
 await db.exec(`INSERT INTO private.uv_profile_exclusions VALUES('${org}','${user}')`);
 await assert.rejects(()=>actor(setup));await assert.rejects(()=>actor(()=>complete(snapshot,valid)));
 await db.exec('DELETE FROM private.uv_profile_exclusions');
 await assert.rejects(()=>actor(setup,user,org,'anon'));
});
await check('complete profile with an undated license remains pending until receipt',async()=>{
 const result=await actor(()=>complete(snapshot,valid));assert.equal(result.verified,false);assert.equal(result.status.state,'pending');
 const [job]=await claim();const prepared=await prepare(job);assert.equal(prepared.envelope.profile.profile_verified,true);
 assert.equal(prepared.envelope.profile.bio,valid.bio);assert.deepEqual(prepared.envelope.profile.state_licenses,['CA - #NO-DATE']);
 assert.equal(await finish(job,prepared),true);assert.equal((await actor(verification)).verified,true);
 assert.equal((await state()).next_due,'infinity');assert.equal(await dispatch(),null);
});
await check('stale snapshot cannot overwrite a newer save or duplicate a license',async()=>{
 await assert.rejects(()=>actor(()=>complete(snapshot,valid)));
 const loaded=await actor(setup);await db.exec(`UPDATE public.profiles SET first_name='Newer' WHERE id='${user}'`);
 await assert.rejects(()=>actor(()=>complete(loaded,loaded.draft)));await drain();
 assert.equal((await db.query('SELECT count(*)::int AS n FROM public.agent_state_licenses')).rows[0].n,1);
});
await check('missing photo removes badge on both sender status and delivered payload',async()=>{
 await db.exec(`UPDATE public.profiles SET avatar_url='' WHERE id='${user}'`);
 assert.equal((await actor(verification)).verified,false);
 const [job]=await claim();const prepared=await prepare(job);assert.equal(prepared.envelope.profile.profile_verified,false);await finish(job,prepared);
 assert.equal((await actor(verification)).verified,false);
});
await check('restoring requirements restores confirmation without expiry polling',async()=>{
 await db.query('UPDATE public.profiles SET avatar_url=$1 WHERE id=$2',[photo,user]);
 await db.exec(`UPDATE public.agent_state_licenses SET expiration_date=current_date-1`);await drain();
 assert.equal((await actor(verification)).verified,true);assert.equal((await state()).next_due,'infinity');
 const n=await count();for(let i=0;i<3;i++)assert.equal(await dispatch(),null);assert.equal(await count(),n);
});
await check('editing bio retains canonical license ID and original expiry',async()=>{
 const current=await actor(setup);const before=current.draft.licenses[0];
 const next={...current.draft,bio:'Updated bio',licenses:[{...before,expiration_date:null}]};
 await actor(()=>complete(current,next));await drain();
 const after=(await actor(setup)).draft.licenses[0];assert.equal(after.id,before.id);assert.equal(after.expiration_date,before.expiration_date);
 assert.equal((await state()).payload.bio,'Updated bio');
});
await check('personal branding saves, syncs, resets and preserves agency identity',async()=>{
 const original=await actor(setup);assert.equal(original.draft.brand_name,'Synthetic');
 await actor(()=>complete(original,{...original.draft,brand_name:'  Independent Life  '}));await drain();
 assert.equal((await actor(setup)).draft.brand_name,'Independent Life');
 assert.equal((await state()).payload.agency,'Independent Life');assert.equal((await state()).payload.agency_slug,'synthetic');
 assert.equal((await db.query('SELECT agency_name FROM private.uv_profile_sources')).rows[0].agency_name,'Synthetic');
 await assert.rejects(()=>actor(()=>complete(original,{...original.draft,brand_name:'Stale'})));
 const current=await actor(setup);
 for(const brand_name of ['x'.repeat(121),'Bad\nName',null,{},42]){
  await assert.rejects(()=>actor(()=>complete(current,{...current.draft,brand_name})));
  assert.equal((await actor(setup)).snapshot,current.snapshot);
 }
 const legacy={...current.draft};delete legacy.brand_name;
 await actor(()=>complete(current,legacy));await drain();assert.equal((await state()).payload.agency,'Independent Life');
 const cleared=await actor(setup);await actor(()=>complete(cleared,{...cleared.draft,brand_name:'  '}));await drain();
 assert.equal((await state()).payload.agency,'Synthetic');assert.equal((await state()).brand_name,null);
 assert.equal((await state()).next_due,'infinity');assert.equal(await dispatch(),null);
});
await check('removing the only license removes badge without breaking profile save',async()=>{
 await db.exec('DELETE FROM public.agent_state_licenses');await drain();
 assert.equal((await actor(verification)).verified,false);assert.equal((await state()).payload.profile_verified,false);
});
await check('new private helpers are not executable by client roles',async()=>{
 const grants=(await db.query("SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE') OR has_function_privilege('service_role',p.oid,'EXECUTE'))")).rows;
 assert.equal(grants.length,0);
});
console.log(`PASS ${checks} verification SQL scenarios (${native?'native PostgreSQL':'PGlite'})`);
await db.close();if(admin)await admin.end();
