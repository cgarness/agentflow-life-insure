/** Synthetic-only paired SQL/handler checks. Refuses non-loopback native databases. */
import assert from 'node:assert/strict';
import { readFile,mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const root=process.cwd(), peer=process.env.UV_PROFILE_PEER;
if (!peer) throw new Error('UV_PROFILE_PEER must point to the checked-out receiver');
const temp=path.resolve(process.env.RUNNER_TEMP ?? '/tmp','uv-profile-checks');
await mkdir(temp,{recursive:true});
const native=process.env.UV_PROFILE_NATIVE_DB_URL;
let admin;
async function database(name) {
  if (native) {
    const url=new URL(native);
    assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname),'Loopback database required');
    assert.match(name,/^uv_profile_[a-z]+_test$/);
    const {default:postgres}=await import('postgres');
    admin ??=postgres(native,{max:1});
    await admin.unsafe(`CREATE DATABASE ${name}`);
    url.pathname='/'+name;
    const sql=postgres(url.toString(),{max:1});
    return {exec:s=>sql.unsafe(s),query:async(s,args=[])=>({rows:await sql.unsafe(s,args)}),close:()=>sql.end(),url:url.toString()};
  }
  const module=process.env.UV_PROFILE_PGLITE_MODULE ?? '@electric-sql/pglite';
  const {PGlite}=await import(module);
  return new PGlite();
}
const af=await database('uv_profile_af_test'),uv=await database('uv_profile_receiver_test');
const org='10000000-0000-4000-8000-000000000001',otherOrg='10000000-0000-4000-8000-000000000002';
const user='20000000-0000-4000-8000-000000000001',other='20000000-0000-4000-8000-000000000002';
const bootstrap=`
SET TIME ZONE 'UTC';
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
`;
await af.exec(bootstrap+`
CREATE TABLE public.organizations(id uuid PRIMARY KEY,status text DEFAULT 'active');
CREATE TABLE public.profiles(id uuid PRIMARY KEY,organization_id uuid,first_name text,last_name text,email text,phone text,avatar_url text,npn text,status text DEFAULT 'Active');
CREATE TABLE public.agent_state_licenses(id uuid DEFAULT gen_random_uuid(),organization_id uuid,agent_id uuid,state text,license_number text,expiration_date date);
CREATE FUNCTION public.get_org_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.org',true),'')::uuid $$;
INSERT INTO public.organizations(id) VALUES('${org}'),('${otherOrg}');
INSERT INTO public.profiles(id,organization_id,first_name,last_name,email,phone,avatar_url,npn) VALUES
('${user}','${org}','Test','Agent','synthetic@example.invalid','+15550001000','','123456'),
('${other}','${otherOrg}','Other','Agent','other@example.invalid','','','');
INSERT INTO public.agent_state_licenses(organization_id,agent_id,state,license_number,expiration_date) VALUES
('${org}','${user}','CA','TEST-VALID',current_date+30),('${org}','${user}','TX','TEST-EXPIRED',current_date-1),
('${org}','${user}','NV','TEST-UNKNOWN',NULL),('${otherOrg}','${user}','NY','WRONG-ORG',current_date+30);
`);
await uv.exec(bootstrap+`
CREATE TABLE public.agents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),slug text NOT NULL UNIQUE,agency_slug text NOT NULL,
 name text NOT NULL,first_name text NOT NULL,last_name text NOT NULL,phone text NOT NULL DEFAULT '',email text NOT NULL DEFAULT '',
 agency text NOT NULL DEFAULT '',npn text NOT NULL DEFAULT '',bio text NOT NULL DEFAULT '',short_bio text NOT NULL DEFAULT '',
 headshot_url text NOT NULL DEFAULT '',calendar_url text NOT NULL DEFAULT '#contact',state_licenses jsonb NOT NULL DEFAULT '[]',
 testimonials jsonb NOT NULL DEFAULT '[]',user_id uuid);
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view agent profiles" ON public.agents FOR SELECT USING(true);
CREATE POLICY "Owner edit" ON public.agents FOR UPDATE TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
GRANT SELECT ON public.agents TO anon,authenticated;
GRANT UPDATE ON public.agents TO authenticated;
CREATE TABLE public.agentflow_consent_links(agent_id uuid PRIMARY KEY);
`);
// Use the canonical baseline normalizer, not a simplified test-only imitation.
const baseline = await readFile(path.join(root,'supabase/migrations/20260806000000_baseline_production_schema.sql'),'utf8');
const normalizer = baseline.match(/CREATE OR REPLACE FUNCTION "public"\."normalize_us_state"[\s\S]*?\n\$\$;/);
assert.ok(normalizer, 'Canonical state normalizer must be present');
await af.exec(normalizer[0]);
await af.exec(await readFile(path.join(root,'supabase/migrations/20261018002956_uv_profile_sync.sql'),'utf8'));
await uv.exec(await readFile(path.join(peer,'supabase/migrations/20261017222810_agentflow_profile_sync.sql'),'utf8'));
await uv.exec(await readFile(path.join(peer,'supabase/migrations/20260929183000_public_intake_and_sms_consent.sql'),'utf8'));
await af.exec(await readFile(path.join(root,'supabase/migrations/20261018170007_uv_profile_exclusions.sql'),'utf8'));
await uv.exec(await readFile(path.join(peer,'supabase/migrations/20261018170007_agentflow_contact_cards.sql'),'utf8'));
await build({entryPoints:[path.join(root,'supabase/functions/uv-profile-sync-worker/handler.ts')],bundle:true,platform:'node',format:'esm',outfile:path.join(temp,'worker.mjs'),logLevel:'silent'});
await build({entryPoints:[path.join(peer,'supabase/functions/agentflow-profile-sync/handler.ts')],bundle:true,platform:'node',format:'esm',outfile:path.join(temp,'receiver.mjs'),logLevel:'silent'});
await build({entryPoints:[path.join(root,'supabase/functions/_shared/uv-profile/protocol.ts')],bundle:true,platform:'node',format:'esm',outfile:path.join(temp,'protocol.mjs'),logLevel:'silent'});
const {handleWorker,RECEIVER_URL}=await import(pathToFileURL(path.join(temp,'worker.mjs')));
const {handleProfileSync}=await import(pathToFileURL(path.join(temp,'receiver.mjs')));
const {sign}=await import(pathToFileURL(path.join(temp,'protocol.mjs')));
for (const name of ['protocol','payload']) assert.equal(await readFile(path.join(root,`supabase/functions/_shared/uv-profile/${name}.ts`),'utf8'),await readFile(path.join(peer,`supabase/functions/_shared/uv-profile/${name}.ts`),'utf8'));
const specs={
 get_my_uv_profile:[],set_my_uv_profile:['p_profile_id:uuid','p_organization_id:uuid','p_published:boolean','p_phone_public:boolean','p_email_public:boolean','p_expected_revision:bigint'],
 claim_uv_profile_sync:['p_limit:integer'],prepare_uv_profile_sync:['p_organization_id:uuid','p_profile_id:uuid','p_lease_token:uuid','p_force_private:boolean'],
 finish_uv_profile_sync:['p_organization_id:uuid','p_profile_id:uuid','p_lease_token:uuid','p_version:bigint','p_receipt:jsonb','p_error:text'],
 consume_agentflow_profile_nonce:['p_nonce:uuid','p_sent_at:timestamptz'],apply_agentflow_profile_v1:['p_organization_id:uuid','p_profile_id:uuid','p_version:bigint','p_profile:jsonb'],
};
function rpc(db) {return async(name,args={})=>{
 const spec=specs[name];assert.ok(spec,'Known RPC only');
 const values=spec.map(s=>{const [key,type]=s.split(':');return type==='jsonb'&&args[key]!=null&&!native?JSON.stringify(args[key]):args[key]??null;});
 try {const out=await db.query(`SELECT public.${name}(${spec.map((s,i)=>'$'+(i+1)+'::'+s.split(':')[1]).join(',')}) AS data`,values);return {data:out.rows[0].data,error:null};}
 catch(error){return {data:null,error:{code:error.code,message:error.message}};}
};}
const afRpc=rpc(af),uvRpc=rpc(uv);
async function service(db,fn){await db.exec('BEGIN; SET LOCAL ROLE service_role');try{const value=await fn();await db.exec('COMMIT');return value;}catch(error){await db.exec('ROLLBACK');throw error;}}
const workerRpc=(name,args)=>service(af,()=>afRpc(name,args));
const receiverRpc=(name,args)=>service(uv,()=>uvRpc(name,args));
async function actor(id,organization,fn,role='authenticated') {
 await af.exec('BEGIN; SET LOCAL ROLE '+role+';');
 try {await af.query(`SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.org',$2,true)`,[id,organization]);const out=await fn();await af.exec('COMMIT');return out;}
 catch(error){await af.exec('ROLLBACK');throw error;}
}
async function preferences(published,phone=false,email=false,expected,scope={profile:user,organization:org}) {
 return actor(user,org,async()=>{
  const current=await afRpc('get_my_uv_profile');assert.equal(current.error,null);
  return afRpc('set_my_uv_profile',{p_profile_id:scope.profile,p_organization_id:scope.organization,p_published:published,p_phone_public:phone,p_email_public:email,p_expected_revision:expected??current.data.revision});
 });
}
const secret='synthetic-profile-sync-key-not-production-000000',workerSecret='synthetic-worker-key-not-production-111111';
let deliveries=0,lastRequest;
async function receiverFetch(url,init){assert.equal(url,RECEIVER_URL);assert.equal(init.redirect,'error');deliveries++;lastRequest={body:init.body,headers:new Headers(init.headers)};return handleProfileSync(new Request(url,init),{secret,rpc:receiverRpc});}
async function run(extra={}){return handleWorker(new Request('http://localhost/worker',{method:'POST',headers:{authorization:'Bearer '+workerSecret}}),{enabled:true,workerSecret,syncSecret:secret,rpc:workerRpc,fetch:receiverFetch,...extra});}
async function due(){await af.exec("UPDATE private.uv_profile_sync SET next_attempt_at=now()-interval '1 second',lease_expires_at=NULL,lease_token=NULL");}
async function row(){return (await uv.query('SELECT * FROM public.agents ORDER BY slug')).rows.find(x=>x.first_name==='Test');}
let checks=0;
async function check(name,fn){await fn();checks++;console.log('PASS '+name);}
await check('default-off, no enrollment and no private table grants',async()=>{
 const s=await actor(user,org,()=>afRpc('get_my_uv_profile'));assert.equal(s.data.available,false);assert.equal(s.data.desired_published,false);
 assert.equal((await preferences(true)).error.code,'42501');
 assert.equal((await af.query('SELECT count(*)::int AS n FROM private.uv_profile_sync')).rows[0].n,0);
 const grants=(await af.query("SELECT has_table_privilege('authenticated','private.uv_profile_sync','SELECT') AS readable")).rows[0];assert.equal(grants.readable,false);
 const called=[];const r=await run({enabled:false,rpc:async(...a)=>{called.push(a);return {data:null,error:null};}});assert.deepEqual(await r.json(),{enabled:false});assert.equal(called.length,0);
});
await check('anonymous and authenticated callers cannot invoke worker RPCs',async()=>{
 const a=await actor(user,org,()=>afRpc('claim_uv_profile_sync',{p_limit:1}));assert.equal(a.error.code,'42501');
 const b=await actor('',org,()=>afRpc('get_my_uv_profile'),'anon');assert.equal(b.error.code,'42501');
 const r=await handleWorker(new Request('http://localhost',{method:'POST'}),{enabled:true,workerSecret,syncSecret:secret,rpc:()=>{throw Error('must not call');},fetch:receiverFetch});assert.equal(r.status,401);
});
await af.exec(`INSERT INTO private.uv_profile_sources VALUES('${org}','Synthetic Agency','synthetic-agency',true);`);
await uv.exec(`INSERT INTO private.agentflow_profile_sources VALUES('${org}','Synthetic Agency','synthetic-agency',true,true);`);
await check('scope preconditions reject another identity or organization',async()=>{
 assert.equal((await preferences(true,false,false,0,{profile:other,organization:org})).error.code,'42501');
 assert.equal((await preferences(true,false,false,0,{profile:user,organization:otherOrg})).error.code,'42501');
 const mismatch=await actor(user,otherOrg,()=>afRpc('get_my_uv_profile'));assert.equal(mismatch.error.code,'42501');
});
await check('new ownerless page requires an explicitly published contact',async()=>{
 assert.equal((await preferences(true)).error,null);assert.equal((await run()).status,503);
 assert.equal((await uv.query('SELECT count(*)::int AS n FROM public.agents')).rows[0].n,0);
 assert.equal((await preferences(true,true,false)).error,null);assert.equal((await run()).status,200);
 assert.equal((await row()).contact_card_only,true);
});
await check('existing contact card permits removing every public contact',async()=>{
 const saved=await preferences(true);assert.equal(saved.error,null);assert.equal(saved.data.desired_published,true);const r=await run();assert.equal(r.status,200);
 const p=await row();assert.equal(p.is_published,true);assert.equal(p.phone,'');assert.equal(p.email,'');assert.equal(p.managed_by_agentflow,true);
 assert.deepEqual(p.state_licenses,['CA - #TEST-VALID']);assert.equal(p.npn,'123456');assert.equal(p.user_id,null);
});
const first=await row();
await check('exclusions deny enrollment, claims, prepared leases and receiver mutations',async()=>{
 await due();
 const claim=await afRpc('claim_uv_profile_sync',{p_limit:1});const lease=claim.data[0];
 await af.query('INSERT INTO private.uv_profile_exclusions VALUES ($1,$2)',[org,user]);
 await uv.query('INSERT INTO private.agentflow_profile_exclusions VALUES ($1,$2)',[org,user]);
 const before=(await uv.query('SELECT to_jsonb(a) AS data FROM public.agents a')).rows;
 assert.equal((await actor(user,org,()=>afRpc('get_my_uv_profile'))).data.available,false);
 assert.equal((await preferences(true)).error.message,'profile_excluded');
 assert.deepEqual((await afRpc('claim_uv_profile_sync',{p_limit:5})).data,[]);
 const prepared=await afRpc('prepare_uv_profile_sync',{p_organization_id:org,p_profile_id:user,p_lease_token:lease.lease_token,p_force_private:false});
 assert.equal(prepared.error.message,'profile_excluded');
 const refused=await uvRpc('apply_agentflow_profile_v1',{p_organization_id:org,p_profile_id:user,p_version:999,p_profile:{published:false}});
 assert.equal(refused.error.message,'profile_excluded');
 assert.deepEqual((await uv.query('SELECT to_jsonb(a) AS data FROM public.agents a')).rows,before);
 for(const [db,table] of [[af,'uv_profile_exclusions'],[uv,'agentflow_profile_exclusions']]) {
  const grants=(await db.query(`SELECT has_table_privilege('authenticated','private.${table}','SELECT') AS readable,has_table_privilege('service_role','private.${table}','INSERT') AS writable`)).rows[0];
  assert.equal(grants.readable,false);assert.equal(grants.writable,false);
  await db.exec(`DELETE FROM private.${table}`);
 }
 await due();
});
await check('ownerless intake is rejected before any consent or request writes',async()=>{
 const invoke=()=>uv.query(`SELECT public.submit_public_intake($1,'quote',$2,$3,$4,'Synthetic','Visitor','visitor@example.invalid','+15555550123','California',false,false,'2026-09-29-separate-sms','')`,[crypto.randomUUID(),'/'+first.agency_slug+'/'+first.slug,first.agency_slug,first.slug]);
 await assert.rejects(invoke(),/unknown_agent/);
 assert.equal((await uv.query('SELECT count(*)::int AS n FROM public.intake_requests')).rows[0].n,0);
 assert.equal((await uv.query('SELECT count(*)::int AS n FROM public.sms_consent_events')).rows[0].n,0);
 // An owned synthetic page keeps its established intake and unchecked consent behavior.
 await uv.query('UPDATE public.agents SET user_id=$1 WHERE id=$2',[user,first.id]);
 await invoke();
 assert.equal((await uv.query('SELECT count(*)::int AS n FROM public.intake_requests')).rows[0].n,1);
 assert.deepEqual((await uv.query('SELECT choice FROM public.sms_consent_events ORDER BY purpose')).rows.map(r=>r.choice),['not_granted','not_granted']);
 await uv.query('UPDATE public.agents SET user_id=NULL WHERE id=$1',[first.id]);
});
await check('canonical full-state names normalize, duplicates collapse and invalid names stay private',async()=>{
 await af.query('INSERT INTO public.agent_state_licenses(organization_id,agent_id,state,license_number,expiration_date) VALUES ($1,$2,$3,$4,current_date+30),($1,$2,$5,$6,current_date+30),($1,$2,$7,$8,current_date+30)',[org,user,'California','TEST-VALID',' New York ','TEST-NY','Atlantis','TEST-INVALID']);
 await due();assert.equal((await run()).status,200);
 assert.deepEqual((await row()).state_licenses,['CA - #TEST-VALID','NY - #TEST-NY']);
});

await check('unchanged profiles do not resend or create duplicate pages',async()=>{
 const before=deliveries;await due();assert.equal((await run()).status,200);assert.equal(deliveries,before);
 assert.equal((await uv.query('SELECT count(*)::int AS n FROM public.agents')).rows[0].n,1);
});
await check('explicit contact choices and fresh profile changes propagate',async()=>{
 const changed=await preferences(true,true,false);assert.equal(changed.error,null);assert.equal(changed.data.state,'pending');
 await af.exec(`UPDATE public.profiles SET phone='+15550001001',npn='999999' WHERE id='${user}'`);
 assert.equal((await run()).status,200);const p=await row();assert.equal(p.phone,'+15550001001');assert.equal(p.email,'');assert.equal(p.npn,'999999');assert.equal(p.slug,first.slug);
});
await check('preference revisions remain pending until acknowledged, including private no-ops',async()=>{
 const changed=await preferences(true,true,true);assert.equal(changed.data.state,'pending');
 assert.equal((await run()).status,200);assert.equal((await actor(user,org,()=>afRpc('get_my_uv_profile'))).data.state,'published');
 await preferences(false);assert.equal((await run()).status,200);const sent=deliveries;
 const hidden=await preferences(false,true,false);assert.equal(hidden.data.state,'pending');
 assert.equal((await run()).status,200);assert.equal(deliveries,sent);assert.equal((await actor(user,org,()=>afRpc('get_my_uv_profile'))).data.state,'private');
 await preferences(true,true,false);assert.equal((await run()).status,200);
});
await check('stale preferences cannot overwrite a newer privacy decision',async()=>{assert.equal((await preferences(false,false,false,'0')).error.code,'40001');});
await check('signed receiver requests cannot replay',async()=>{
 const r=await handleProfileSync(new Request(RECEIVER_URL,{method:'POST',body:lastRequest.body,headers:lastRequest.headers}),{secret,rpc:receiverRpc});assert.equal(r.status,409);assert.equal((await r.json()).error,'request_replayed');
});
await check('outage remains retryable and never blocks ordinary profile save',async()=>{
 await af.exec(`UPDATE public.profiles SET npn='777777' WHERE id='${user}'`);await due();
 assert.equal((await run({fetch:async()=>{throw Error('offline');}})).status,503);
 const s=(await af.query('SELECT * FROM private.uv_profile_sync')).rows[0];assert.equal(s.last_error,'temporarily_unavailable');assert.ok(s.next_attempt_at);
 await af.exec(`UPDATE public.profiles SET first_name='Test' WHERE id='${user}'`);
 await due();assert.equal((await run()).status,200);assert.equal((await row()).npn,'777777');
});
await check('lost acknowledgement retries the same version idempotently',async()=>{
 await af.exec(`UPDATE public.profiles SET npn='666666' WHERE id='${user}'`);await due();
 const failAck=async(name,args)=>name==='finish_uv_profile_sync'?{data:null,error:{code:'offline'}}:workerRpc(name,args);
 assert.equal((await run({rpc:failAck})).status,503);
 const version=(await uv.query('SELECT last_version::text AS v FROM private.agentflow_profile_links')).rows[0].v;
 await due();assert.equal((await run()).status,200);
 assert.equal((await uv.query('SELECT last_version::text AS v FROM private.agentflow_profile_links')).rows[0].v,version);
 assert.equal((await uv.query('SELECT count(*)::int AS n FROM public.agents')).rows[0].n,1);
});
await check('opt-out supersedes in-flight publication and hides public reads',async()=>{
 await af.exec(`UPDATE public.profiles SET npn='555555' WHERE id='${user}'`);await due();
 const claimed=await afRpc('claim_uv_profile_sync',{p_limit:1});const j=claimed.data[0];
 const job={p_organization_id:j.organization_id,p_profile_id:j.profile_id,p_lease_token:j.lease_token};
 const staged=await afRpc('prepare_uv_profile_sync',{...job,p_force_private:false});const old=staged.data.envelope;
 assert.equal((await preferences(false)).error,null);assert.equal((await run()).status,200);
 const text=JSON.stringify(old),timestamp=Math.floor(Date.now()/1000).toString(),nonce=crypto.randomUUID();
 const signature=await sign(text,secret,timestamp,nonce);
 const stale=await handleProfileSync(new Request(RECEIVER_URL,{method:'POST',body:text,headers:{'content-type':'application/json','x-uv-timestamp':timestamp,'x-uv-nonce':nonce,'x-uv-signature':signature}}),{secret,rpc:receiverRpc});assert.equal(stale.status,409);
 assert.equal((await afRpc('finish_uv_profile_sync',{...job,p_version:old.version,p_receipt:null,p_error:'temporarily_unavailable'})).data,false);
 await uv.exec('SET ROLE anon');assert.equal((await uv.query('SELECT * FROM public.agents')).rows.length,0);await uv.exec('RESET ROLE');
 assert.equal((await row()).is_published,false);
});
await check('invalid image data unpublishes instead of leaving stale contact details',async()=>{
 await af.exec(`UPDATE public.profiles SET avatar_url='data:image/svg+xml;base64,PHN2Zz4=' WHERE id='${user}'`);
 assert.equal((await preferences(true,true,true)).error,null);assert.equal((await run()).status,503);assert.equal((await row()).is_published,false);
 const s=await actor(user,org,()=>afRpc('get_my_uv_profile'));assert.equal(s.data.state,'attention');
 await af.exec(`UPDATE public.profiles SET avatar_url='' WHERE id='${user}'`);await due();assert.equal((await run()).status,200);
});
await check('license removal and expiration are reflected on next reconciliation',async()=>{
 await af.exec(`UPDATE public.agent_state_licenses SET expiration_date=current_date-1 WHERE organization_id='${org}' AND agent_id='${user}'`);await due();assert.equal((await run()).status,200);assert.deepEqual((await row()).state_licenses,[]);
});
await check('linked fields are protected while UV-only content and consent remain intact',async()=>{
 await uv.exec(`UPDATE public.agents SET user_id='${user}',bio='Genuine biography',testimonials='["Genuine existing review"]'; INSERT INTO public.agentflow_consent_links SELECT id FROM public.agents;`);
 await uv.exec(`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${user}',true);`);
 await assert.rejects(uv.exec("UPDATE public.agents SET phone='unauthorized'"));await uv.exec('ROLLBACK');
 await uv.exec(`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${user}',true); UPDATE public.agents SET bio='Updated genuine biography'; COMMIT;`);
 const before=(await uv.query('SELECT to_jsonb(a) AS data FROM public.agents a')).rows;
 const link=(await uv.query('SELECT * FROM private.agentflow_profile_links')).rows[0];
 for (const payload of [link.last_payload,{published:false}]) {
  const result=await uvRpc('apply_agentflow_profile_v1',{p_organization_id:org,p_profile_id:user,p_version:link.last_version,p_profile:payload});
  assert.equal(result.error.message,'profile_consent_protected');
 }
 await af.exec(`UPDATE public.profiles SET first_name='Changed' WHERE id='${user}'`);await due();assert.equal((await run()).status,503);
 assert.deepEqual((await uv.query('SELECT to_jsonb(a) AS data FROM public.agents a')).rows,before);
 const p=await row();assert.equal(p.first_name,'Test');assert.equal(p.user_id,user);assert.equal(p.slug,first.slug);assert.equal(p.bio,'Updated genuine biography');assert.deepEqual(p.testimonials,['Genuine existing review']);
 // Remove only the synthetic consent link to continue unrelated lifecycle scenarios.
 await uv.exec('DELETE FROM public.agentflow_consent_links');
 await af.exec(`UPDATE public.profiles SET first_name='Test' WHERE id='${user}'`);
});
await check('agency disable still permits unpublish delivery',async()=>{
 await af.exec('UPDATE private.uv_profile_sources SET enabled=false');await uv.exec('UPDATE private.agentflow_profile_sources SET enabled=false');await due();assert.equal((await run()).status,200);assert.equal((await row()).is_published,false);
 await af.exec('UPDATE private.uv_profile_sources SET enabled=true');await uv.exec('UPDATE private.agentflow_profile_sources SET enabled=true');await due();assert.equal((await run()).status,200);
});
await check('deactivation withdraws and reactivation requires fresh opt-in',async()=>{
 await af.exec(`UPDATE public.profiles SET status='Inactive' WHERE id='${user}'`);await due();assert.equal((await run()).status,200);assert.equal((await row()).is_published,false);
 await af.exec(`UPDATE public.profiles SET status='Active' WHERE id='${user}'`);await due();assert.equal((await run()).status,200);assert.equal((await row()).is_published,false);
 assert.equal((await preferences(true)).error,null);assert.equal((await run()).status,200);
});
await check('organization transfer retains old tombstone, no implicit new enrollment',async()=>{
 await af.exec(`UPDATE public.profiles SET organization_id='${otherOrg}' WHERE id='${user}'`);await due();assert.equal((await run()).status,200);assert.equal((await row()).is_published,false);
 assert.equal((await af.query('SELECT count(*)::int AS n FROM private.uv_profile_sync')).rows[0].n,1);
 await af.exec(`UPDATE public.profiles SET organization_id='${org}' WHERE id='${user}'`);await due();assert.equal((await run()).status,200);assert.equal((await row()).is_published,false);assert.equal((await preferences(true)).error,null);assert.equal((await run()).status,200);
});
await check('deleted profiles retain durable unpublish delivery',async()=>{
 await af.exec(`DELETE FROM public.profiles WHERE id='${user}'`);await due();assert.equal((await run()).status,200);assert.equal((await row()).is_published,false);
 assert.equal((await af.query('SELECT count(*)::int AS n FROM private.uv_profile_sync')).rows[0].n,1);
});
await check('provisioning refuses name claims and preserves owners during slug collisions',async()=>{
 const identity='20000000-0000-4000-8000-000000000090';
 const payload={published:true,first_name:'Collision',last_name:'Agent',phone:'',email:'collision@example.invalid',npn:'',headshot_url:'',agency:'Synthetic Agency',agency_slug:'synthetic-agency',state_licenses:[]};
 const existing=(await uv.query(`INSERT INTO public.agents(slug,agency_slug,name,first_name,last_name,agency,user_id) VALUES ('collision-agent','synthetic-agency','Collision Agent','Collision','Agent','Synthetic Agency',$1) RETURNING id`,[other])).rows[0];
 const deliver=()=>uvRpc('apply_agentflow_profile_v1',{p_organization_id:org,p_profile_id:identity,p_version:1,p_profile:payload});
 assert.equal((await deliver()).error.message,'profile_link_required');
 assert.equal((await uv.query('SELECT count(*)::int AS n FROM private.agentflow_profile_links WHERE profile_id=$1',[identity])).rows[0].n,0);
 await uv.query("UPDATE public.agents SET name='Different Person' WHERE id=$1",[existing.id]);
 const before=(await uv.query('SELECT to_jsonb(a) AS data FROM public.agents a WHERE id=$1',[existing.id])).rows[0].data;
 await uv.exec('UPDATE private.agentflow_profile_sources SET allow_provisioning=false');
 assert.equal((await deliver()).error.message,'profile_link_required');
 await uv.exec('UPDATE private.agentflow_profile_sources SET allow_provisioning=true');
 const delivered=await deliver();assert.equal(delivered.error,null);assert.match(delivered.data.public_url,/\/collision-agent-[0-9a-f]{16}$/);
 assert.deepEqual((await deliver()).data,delivered.data);
 assert.deepEqual((await uv.query('SELECT to_jsonb(a) AS data FROM public.agents a WHERE id=$1',[existing.id])).rows[0].data,before);
 const linked=(await uv.query('SELECT agent_id FROM private.agentflow_profile_links WHERE profile_id=$1',[identity])).rows[0];assert.notEqual(linked.agent_id,existing.id);
});
if(native) await check('native concurrent workers cannot claim the same delivery',async()=>{
 const {default:postgres}=await import('postgres');const second=postgres(af.url,{max:1});await due();
 await af.exec('BEGIN');const a=await afRpc('claim_uv_profile_sync',{p_limit:1});assert.equal(a.data.length,1);
 const b=await second`SELECT public.claim_uv_profile_sync(1) AS data`;assert.equal(b[0].data.length,0);
 await af.exec('COMMIT');await second.end();
});
await check('compatible receiver migration and signed confirmation/bio delivery',async()=>{
 await uv.exec('BEGIN');await uv.exec(await readFile(path.join(peer,'supabase/migrations/20261019032157_agentflow_profile_verification.sql'),'utf8'));await uv.exec('COMMIT');
 await uv.exec('BEGIN');await uv.exec(await readFile(path.join(peer,'supabase/migrations/20261020171251_agentflow_personal_brand.sql'),'utf8'));await uv.exec('COMMIT');
 const identity='20000000-0000-4000-8000-000000000091';
 const payload={published:true,first_name:'Verified',last_name:'Agent',phone:'+15550001000',email:'verified@example.invalid',npn:'123456',headshot_url:'https://images.example.com/photo.png',agency:'Synthetic Agency',agency_slug:'synthetic-agency',state_licenses:['CA - #UNDATED'],profile_verified:true,bio:'A real optional biography.'};
 async function signed(version,profile){
  const body=JSON.stringify({schema:1,organization_id:org,profile_id:identity,version:String(version),profile});
  const timestamp=String(Math.floor(Date.now()/1000)),nonce=crypto.randomUUID();
  return receiverFetch(RECEIVER_URL,{method:'POST',redirect:'error',body,headers:{'content-type':'application/json','x-uv-timestamp':timestamp,'x-uv-nonce':nonce,'x-uv-signature':await sign(body,secret,timestamp,nonce)}});
 }
 assert.equal((await signed(1,payload)).status,200);
 const id=(await uv.query('SELECT agent_id FROM private.agentflow_profile_links WHERE profile_id=$1',[identity])).rows[0].agent_id;
 const published=(await uv.query('SELECT * FROM public.agents WHERE id=$1',[id])).rows[0];
 assert.equal(published.profile_verified,true);assert.equal(published.bio,payload.bio);assert.equal(published.contact_card_only,true);
 // Backend ownership applies even if a managed agent later has an owner.
 await uv.query('UPDATE public.agents SET user_id=$1 WHERE id=$2',[user,id]);
 await uv.exec(`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${user}',true)`);
 await assert.rejects(uv.query("UPDATE public.agents SET profile_verified=false,bio='tampered' WHERE id=$1",[id]));await uv.exec('ROLLBACK');
 assert.equal((await signed(2,{...payload,profile_verified:false,headshot_url:''})).status,200);
 assert.equal((await uv.query('SELECT profile_verified FROM public.agents WHERE id=$1',[id])).rows[0].profile_verified,false);
 assert.notEqual((await signed(1,payload)).status,200);
 assert.equal((await signed(3,{...payload,agency:'Independent Life'})).status,200);
 const branded=(await uv.query('SELECT agency,agency_slug,slug FROM public.agents WHERE id=$1',[id])).rows[0];
 assert.equal(branded.agency,'Independent Life');assert.equal(branded.agency_slug,published.agency_slug);assert.equal(branded.slug,published.slug);
 assert.equal((await signed(4,{...payload,agency:'Independent Life',agency_slug:'another-agency'})).status,400);
 for(const agency of ['', 'x'.repeat(121), 'Bad\nName'])assert.equal((await signed(4,{...payload,agency})).status,400);
 assert.equal((await signed(4,payload)).status,200);
 assert.equal((await uv.query('SELECT agency FROM public.agents WHERE id=$1',[id])).rows[0].agency,payload.agency);
 assert.equal((await signed(5,{published:false})).status,200);
 assert.equal((await uv.query('SELECT is_published FROM public.agents WHERE id=$1',[id])).rows[0].is_published,false);
});
await af.close();await uv.close();if(admin) await admin.end();
console.log(`PAIRED_PROFILE_CHECKS=${checks} ENGINE=${native?'native-postgresql':'pglite'}`);
