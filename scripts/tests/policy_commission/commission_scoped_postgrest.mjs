// Actual PostgREST + supabase-js against a guarded disposable native database. Synthetic JWT secret generated here.
import { spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
const { PGURL, DB_URL, POSTGREST_BIN } = process.env;
for (const url of [PGURL, DB_URL]) if (!url || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw Error('Disposable localhost only');
if (!new URL(DB_URL).pathname.startsWith('/pc_test_') || !POSTGREST_BIN) throw Error('Runner database and PostgREST required');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const admin = postgres(DB_URL, { max: 2, onnotice: () => {} });
const cluster = postgres(new URL('/postgres', PGURL).toString(), { max: 1, onnotice: () => {} });
const secret = randomBytes(32).toString('hex'), password = randomBytes(18).toString('hex');
const authRole = 'pc_scoped_authenticator';
const b64 = x => Buffer.from(JSON.stringify(x)).toString('base64url');
const jwt = claims => { const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ exp: Math.floor(Date.now()/1000)+3600, ...claims })}`; return `${body}.${createHmac('sha256',secret).update(body).digest('base64url')}`; };
const port = await new Promise(resolve => { const s=createServer().listen(0,'127.0.0.1',()=>{ const p=s.address().port;s.close(()=>resolve(p)); }); });
let child;
try {
 await cluster.unsafe(`DROP ROLE IF EXISTS ${authRole}`);
 await cluster.unsafe(`CREATE ROLE ${authRole} LOGIN NOINHERIT PASSWORD '${password}'`);
 await cluster.unsafe(`GRANT anon,authenticated,service_role TO ${authRole}`);
 const db = new URL(DB_URL);db.username=authRole;db.password=password;
 child=spawn(POSTGREST_BIN,[],{env:{PATH:process.env.PATH,PGRST_DB_URI:db.toString(),PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',PGRST_JWT_SECRET:secret,PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:String(port),PGRST_DB_POOL:'4',PGRST_LOG_LEVEL:'error'},stdio:['ignore','inherit','inherit']});
 const base=`http://127.0.0.1:${port}`;
 for(let n=0;;n++){try{if((await fetch(base)).ok)break;}catch{}if(n>100)throw Error('PostgREST failed startup');await new Promise(r=>setTimeout(r,100));}
 const people=Object.fromEntries((await admin`select id,organization_id,role,is_super_admin from profiles`).map(p=>[p.id,p]));
 let requests=0;
 const client = who => {
  const p=people[id(who)];
  const claims=p?{sub:p.id,role:'authenticated',is_super_admin:p.is_super_admin,app_metadata:{organization_id:p.organization_id,role:p.role}}:{role:who};
  return createClient(base,'synthetic-anon-key',{global:{headers:{Authorization:`Bearer ${jwt(claims)}`},fetch:(input,init)=>{requests++;return fetch(String(input).replace(`${base}/rest/v1`,base),init);}},auth:{persistSession:false,autoRefreshToken:false}});
 };
 const tl=client(14),agent=client(11),adm=client(13);
 const APIs={get_commission_agent_scope:{},get_scoped_commission_overview:{p_agent_scope:'all',p_agent_ids:null},get_scoped_commission_installments:{p_agent_scope:'all',p_agent_ids:null},get_scoped_commission_receipt_list:{p_agent_scope:'all',p_agent_ids:null},get_scoped_commission_policy_list:{p_agent_scope:'all',p_agent_ids:null},get_scoped_commission_breakdown:{p_agent_scope:'all',p_agent_ids:null},get_scoped_policy_commission:{p_agent_scope:'all',p_agent_ids:null,p_policy_id:(await admin`select ci_policy('Alpha') id`)[0].id}};
 for(const who of ['anon','service_role'])for(const [fn,args]of Object.entries(APIs)){const r=await client(who).rpc(fn,args);assert.equal(r.error?.code,'42501',`${who} ${fn}`);}
 console.log('PASS A17 HTTP anon/service_role denied across all seven APIs');
 for(const [fn,args]of Object.entries(APIs)){const r=await tl.rpc(fn,args);assert.equal(r.status,200,`${fn}: ${JSON.stringify(r.error)}`);}
 const selected={p_agent_scope:'selected',p_agent_ids:[id(11),id(42)],p_period:'all'};
 const before=requests;
 const list=await tl.rpc('get_scoped_commission_policy_list',{...selected,p_limit:25,p_offset:0});
 assert.equal(list.data.total_count,45);assert.equal(list.data.rows.length,25);assert.equal(requests-before,1,'one request for multiple agents');
 const page2=await tl.rpc('get_scoped_commission_policy_list',{...selected,p_limit:25,p_offset:25});
 assert.equal(page2.data.rows.length,20);assert.deepEqual(page2.data.totals,list.data.totals);
 assert.ok(list.data.rows.every(r=>[id(11),id(42)].includes(r.credited_agent_id)&&r.agent_name));
 assert.deepEqual(list.data.meta.agent_scope.agent_ids,[id(11),id(42)]);
 const duplicate=await tl.rpc('get_scoped_commission_policy_list',{...selected,p_agent_ids:[id(42),id(11),id(42)]});
 assert.deepEqual(duplicate.data.meta.agent_scope,list.data.meta.agent_scope,'canonical ID set');
 console.log('PASS F07 U06 HTTP single set-based request, full totals, canonical IDs, seller identity');
 for(const ids of [[id(31)],[id(11),id(31)],[id(999999)]]){const r=await tl.rpc('get_scoped_commission_overview',{p_agent_scope:'selected',p_agent_ids:ids});assert.equal(r.error.code,'42501');}
 for(const args of [{p_agent_scope:'selected',p_agent_ids:[]},{p_agent_scope:'selected',p_agent_ids:[null]},{p_agent_scope:'all',p_agent_ids:[id(11)]},{p_agent_scope:'invalid',p_agent_ids:null}]){const r=await tl.rpc('get_scoped_commission_overview',args);assert.equal(r.error.code,'22023');}
 assert.equal((await agent.rpc('get_scoped_commission_overview',{p_agent_scope:'selected',p_agent_ids:[id(43)]})).error.code,'42501');
 console.log('PASS A02 A06 A11 A12 HTTP exact scope refusal and no partial fallback');
 const search=await tl.rpc('get_commission_agent_scope',{p_search:'nothing matches',p_limit:1});
 assert.equal(search.data.total_count,0);assert.ok(search.data.available_count>1);
 assert.equal((await tl.rpc('get_scoped_commission_policy_list',{p_agent_scope:'all',p_agent_ids:null})).data.total_count>0,true);
 const hidden=await tl.rpc('get_scoped_policy_commission',{p_agent_scope:'selected',p_agent_ids:[id(11)],p_policy_id:(await admin`select ci_policy('Juliet') id`)[0].id});
 assert.equal(hidden.data.contact,null);assert.equal(hidden.data.policy.access,'read');
 assert.ok(!JSON.stringify(hidden.data).includes('Juliet Synthetic'));
 const self=(await admin`select ci_policy('ScopedLeader') id`)[0].id;
 for(const args of [{p_agent_scope:'all',p_agent_ids:null},{p_agent_scope:'selected',p_agent_ids:[id(14)]}])assert.equal((await tl.rpc('get_scoped_policy_commission',{...args,p_policy_id:self})).data.policy.access,'read');
 assert.equal((await tl.rpc('get_scoped_policy_commission',{p_agent_scope:'me',p_agent_ids:null,p_policy_id:self})).data.policy.access,'write');
 console.log('PASS A15 A19 U17 HTTP private contact, read-only self and search-independent All');
 // SAME existing token after current database demotion; server must not trust stale role.
 await admin`update profiles set role='Agent' where id=${id(14)}`;
 try {assert.equal((await tl.rpc('get_scoped_commission_overview',{p_agent_scope:'selected',p_agent_ids:[id(11)]})).error.code,'42501');assert.equal((await tl.rpc('get_scoped_commission_overview',{p_agent_scope:'me',p_agent_ids:null})).status,200);}
 finally{await admin`update profiles set role='Team Leader' where id=${id(14)}`;}
 console.log('PASS A10 HTTP same stale JWT after database demotion');
 const paths=await(await fetch(base,{headers:{Authorization:`Bearer ${jwt({role:'authenticated',sub:id(14),app_metadata:{organization_id:id(1),role:'Team Leader'}})}`}})).text();
 assert.ok(paths.includes('/rpc/get_commission_agent_scope'));assert.ok(!paths.includes('/rpc/resolve_scope'));
 for(const fn of ['resolve_scope','viewer','policies','read_overview'])assert.equal((await tl.rpc(fn,{})).error.code,'PGRST202');
 assert.equal((await adm.schema('policy_commission_scoped').rpc('resolve_scope',{p_agent_scope:'all',p_agent_ids:null})).error.code,'PGRST106');
 console.log('PASS A16 HTTP internal schema absent from PostgREST');
 const t=performance.now();for(let n=0;n<5;n++)assert.equal((await tl.rpc('get_scoped_commission_policy_list',selected)).status,200);
 console.log(JSON.stringify({http_samples:5,mean_ms:(performance.now()-t)/5,requests,snapshot:'synthetic 45 selected policies, sequential warm calls'}));
 console.log('PASS scoped PostgREST integration');
} finally {child?.kill('SIGTERM');await admin.end();await new Promise(r=>setTimeout(r,100));await cluster.unsafe(`DROP ROLE IF EXISTS ${authRole}`).catch(()=>{});await cluster.end();}
