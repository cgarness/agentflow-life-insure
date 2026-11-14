import postgres from 'postgres';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHmac, createHash } from 'node:crypto';
const url=process.env.STICKY_TEST_URL;if(!url||new URL(url).hostname!=='127.0.0.1'||new URL(url).pathname!='/sticky_candidate')throw Error('Isolated candidate required');
const db=postgres(url,{max:2,onnotice:()=>{}});const secret='isolated-sticky-number-test-jwt-secret-2026';
const org='10000000-0000-4000-8000-000000000001',agent='20000000-0000-4000-8000-000000000002';
const jwt=(role,sub)=>{const text=[{alg:'HS256',typ:'JWT'},{role,sub,exp:Math.floor(Date.now()/1000)+3600,app_metadata:{role:'Agent',organization_id:org}}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');return text+'.'+createHmac('sha256',secret).update(text).digest('base64url');};
await db.unsafe(await fs.readFile(new URL('fixtures.sql',import.meta.url),'utf8'));
await db`insert into public.workflows(id,organization_id,name,trigger_type) values('90000000-0000-4000-8000-000000000001',${org},'Synthetic legacy test','manual')`;
await db`insert into public.workflow_executions(id,organization_id,workflow_id,contact_id,contact_type) values('90000000-0000-4000-8000-000000000002',${org},'90000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','lead')`;
await db`insert into private.contact_number_internal_alerts(organization_id,key_prefix,actor_id,sender,recipient) values(${org},'clearpath:lead:',${agent},'+12025551111','+12025557777')`;
await db`insert into public.sms_enrollments(organization_id,phone_e164,informational_confirmed) values(${org},'+12025550101',true),(${org},'+12025557777',true)`;
const oldHash=createHash('sha256').update(JSON.stringify(['+12025550101','+12025551111','Old accepted receipt','informational',agent,'30000000-0000-4000-8000-000000000001','lead',null])).digest('hex');
await db`insert into public.sms_dispatches(organization_id,request_key,payload_hash,phone_e164,from_number,body,purpose,evidence_ids,state,provider_sid,provider_status,message_id,actor_id,contact_id,contact_type) values(${org},'old-accepted',${oldHash},'+12025550101','+12025551111','Old accepted receipt','informational',array[]::uuid[],'accepted','SM00000000000000000000000000000099','delivered','90000000-0000-4000-8000-000000000003',${agent},'30000000-0000-4000-8000-000000000001','lead')`;
await db.unsafe("DO $$BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sticky_gateway') THEN CREATE ROLE sticky_gateway LOGIN NOINHERIT NOBYPASSRLS;END IF;END$$;GRANT anon,authenticated,service_role TO sticky_gateway;");
const pgrest=spawn(process.env.STICKY_POSTGREST,[],{env:{...process.env,PGRST_DB_URI:url.replace('postgres@','sticky_gateway@'),PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',PGRST_JWT_SECRET:secret,PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:'55474'},stdio:['ignore','ignore','pipe']});
let pgLog='';pgrest.stderr.on('data',b=>pgLog+=b);
const gateway=createServer(async(req,res)=>{try{
 res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,prefer,accept-profile,content-profile');if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
 if(req.url==='/auth/v1/logout?scope=local'){res.writeHead(204);res.end();return;}
 if(req.url==='/auth/v1/user'){const token=req.headers.authorization?.replace('Bearer ','')??'';const [h,p,s]=token.split('.');if(!s||createHmac('sha256',secret).update(h+'.'+p).digest('base64url')!==s){res.writeHead(401);res.end('{}');return;}const claims=JSON.parse(Buffer.from(p,'base64url'));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:claims.sub,email:'synthetic@example.invalid',app_metadata:claims.app_metadata,user_metadata:{}}));return;}
 if(req.url.startsWith('/functions/v1/')){const body=await Array.fromAsync(req).then(parts=>Buffer.concat(parts));const r=await fetch('http://127.0.0.1:55476'+req.url,{method:req.method,headers:req.headers,body});res.writeHead(r.status,Object.fromEntries([...r.headers].filter(([k])=>!['content-encoding','content-length'].includes(k))));res.end(Buffer.from(await r.arrayBuffer()));return;}
 if(!req.url.startsWith('/rest/v1/')){res.writeHead(404);res.end();return;}
 const body=await Array.fromAsync(req).then(parts=>Buffer.concat(parts));const r=await fetch('http://127.0.0.1:55474'+req.url.slice('/rest/v1'.length),{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:body});res.writeHead(r.status,Object.fromEntries([...r.headers].filter(([k])=>!['content-encoding','content-length'].includes(k))));res.end(Buffer.from(await r.arrayBuffer()));
}catch(e){res.writeHead(500);res.end(JSON.stringify({error:e.message}));}});
await new Promise(resolve=>gateway.listen(55475,'127.0.0.1',resolve));
try{
 for(let i=0;i<100;i++){try{const r=await fetch('http://127.0.0.1:55474/');if(r.ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
 const env={...process.env,SUPABASE_URL:'http://127.0.0.1:55475',SUPABASE_SERVICE_ROLE_KEY:jwt('service_role'),SUPABASE_ANON_KEY:jwt('anon'),STICKY_ACTOR_TOKEN:jwt('authenticated',agent),STICKY_LEGACY_ROOT:process.env.STICKY_LEGACY_ROOT,TWILIO_MASTER_ACCOUNT_SID:'AC00000000000000000000000000000001',TWILIO_MASTER_AUTH_TOKEN:'synthetic-provider-token',TWILIO_AUTH_TOKEN:'synthetic-provider-token',SMS_BRIDGE_SECRET:'synthetic-consent-secret-that-is-not-a-real-credential',SMS_CONSENT_WORKER_TOKEN:'synthetic-local-worker-token-never-production'};
 if(process.env.STICKY_BROWSER==='1'){
  const childEnv={...env,VITE_SUPABASE_URL:env.SUPABASE_URL,VITE_SUPABASE_ANON_KEY:env.SUPABASE_ANON_KEY};
  const edge=spawn(process.env.STICKY_DENO,['run','--cached-only','--node-modules-dir=manual','--import-map='+process.env.STICKY_IMPORT_MAP,'--no-lock','--allow-env','--allow-read','--allow-net=127.0.0.1:55475,127.0.0.1:55476','scripts/sticky-numbers/browser-edge.ts'],{env:childEnv,stdio:'inherit'});
  const vite=spawn(process.execPath,['scripts/sticky-numbers/browser-vite.mjs'],{env:childEnv,stdio:'inherit'});
  try{for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:55477/scripts/sticky-numbers/browser.html')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
   const code=await new Promise(resolve=>{const p=spawn(process.execPath,['scripts/sticky-numbers/browser-tests.mjs'],{env:childEnv,stdio:'inherit'});p.on('exit',resolve);});if(code)process.exitCode=code;
   const receipts=await db`select request_key,from_number,state,affinity_number_id from public.sms_dispatches where body like 'Synthetic browser%'`;await fs.writeFile('../evidence/browser-receipts.json',JSON.stringify(receipts,null,2));
  }finally{vite.kill('SIGTERM');edge.kill('SIGTERM');}
 }else{
 const code=await new Promise(resolve=>{const p=spawn(process.env.STICKY_DENO,['test','--cached-only','--node-modules-dir=manual','--import-map='+process.env.STICKY_IMPORT_MAP,'--no-lock','--allow-env','--allow-read','--allow-net=127.0.0.1:55475','supabase/functions/_shared/sms/affinity.test.ts'],{env,stdio:'inherit'});p.on('exit',resolve);});if(code)process.exitCode=code;const alerts=await db`select count(*)::int n from private.contact_number_affinities where phone_e164='+12025557777'`;if(alerts[0].n)throw Error('Internal alert created customer affinity');
 }
}finally{gateway.closeAllConnections();await new Promise(r=>gateway.close(r));pgrest.kill('SIGTERM');await fs.writeFile(process.env.STICKY_EDGE_LOG??'/tmp/sticky-postgrest.log',pgLog);await db.end();}
