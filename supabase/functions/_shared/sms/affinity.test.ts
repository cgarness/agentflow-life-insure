import assert from "node:assert/strict";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { dispatch } from "./dispatch.ts";
import { describeSender } from "./readiness.ts";
import { affinityGuard } from "./affinity.ts";
import type { Db } from "../a2p/types.ts";
const url=Deno.env.get("SUPABASE_URL")!;
if(url!=="http://127.0.0.1:55475")throw Error("Loopback test gateway required");
const db=createClient(url,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
const actorDb=createClient(url,Deno.env.get("SUPABASE_ANON_KEY")!,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${Deno.env.get("STICKY_ACTOR_TOKEN")}`}}});
const org="10000000-0000-4000-8000-000000000001",actor="20000000-0000-4000-8000-000000000002",contactId="30000000-0000-4000-8000-000000000001",number="40000000-0000-4000-8000-000000000001";
const originalFetch=globalThis.fetch;let posts:{from:string;account:string;service:string;body:string}[]=[];let mode="accepted";
const transport:typeof fetch=async(input,init)=>{
 const address=typeof input==="string"?input:input instanceof URL?input.href:input.url;
 if(address.startsWith(url+"/")){const r=await originalFetch(input,init);if(!r.ok)console.error("LOCAL HTTP",r.status,await r.clone().text());return r;}
 if(address.includes("agentflow-consent")){const p=JSON.parse(String(init?.body));return Response.json({...p,checked_at:new Date().toISOString(),allowed:true,evidence:[{id:"80000000-0000-4000-8000-000000000001"}]});}
 if(address.startsWith("https://api.twilio.com/")&&address.endsWith("/Messages.json")){
  const payload=new URLSearchParams(String(init?.body));posts.push({from:payload.get("From")!,account:address.split('/Accounts/')[1].split('/')[0],service:payload.get("MessagingServiceSid")!,body:payload.get("Body")!});
  if(mode==="timeout")throw Error("synthetic timeout");if(mode==="rejected")return Response.json({code:21612},{status:400});
  return Response.json({sid:"SM"+crypto.randomUUID().replaceAll("-",""),status:"queued"});
 }
 if(address.startsWith("https://api.twilio.com/")||address.startsWith("https://messaging.twilio.com/")){const sid=address.match(/PN[0-9a-f]{32}/i)?.[0];return Response.json({sid,account_sid:"AC00000000000000000000000000000001",service_sid:"MG00000000000000000000000000000001",capabilities:{sms:true}});}
 throw Error("External transport refused: "+new URL(address).hostname);
};
const manual=(key=crypto.randomUUID())=>({org,key:`manual:${actor}:${key}`,actor,contactId,contactType:"lead",manual:true,expectedSenderId:number,to:"+12025550101",from:"+12025552222",body:"Synthetic text "+key,verifyRecipient:async()=>{const r=await actorDb.from("leads").select("id,phone").eq("id",contactId).maybeSingle();if(r.error||!r.data)throw Error("scope");}});
Deno.test({name:"native Edge: pure description, authoritative serialized From, replay and no retry",sanitizeResources:false,sanitizeOps:false,fn:async()=>{
 globalThis.fetch=transport;
 try{
  const before=posts.length;const preview=await describeSender(db,{org,actor,contactId,contactType:"lead"});assert.equal(preview.sms.id,number);assert.equal(posts.length,before);
  const input=manual();const r=await dispatch(db,input,transport);assert.equal(r?.success,true);assert.equal(posts.length,1);
  const saved=(await db.from("sms_dispatches").select("*").eq("organization_id",org).eq("request_key",input.key).maybeSingle()).data!;
  assert.deepEqual(posts[0],{from:saved.from_number,account:saved.affinity_account_sid,service:saved.affinity_service_sid,body:input.body});assert.equal(posts[0].from,"+12025551111");
  const replay=await dispatch(db,{...input,from:"+12025551111"},transport);assert.equal(replay?.replayed,true);assert.equal(posts.length,1);
  await db.from('sms_agency_policies').update({send_enabled:false}).eq('organization_id',org);
  assert.equal((await dispatch(db,input,transport))?.replayed,true);assert.equal(posts.length,1);
  await assert.rejects(()=>dispatch(db,{...input,overrideSenderId:'40000000-0000-4000-8000-000000000002'},transport));
  await db.from('sms_agency_policies').update({send_enabled:true}).eq('organization_id',org);
  await assert.rejects(()=>dispatch(db,{...input,body:"different"},transport));assert.equal(posts.length,1);
  mode="timeout";const timeout=manual();await assert.rejects(()=>dispatch(db,timeout,transport));const attempted=posts.length;await assert.rejects(()=>dispatch(db,timeout,transport));assert.equal(posts.length,attempted);
  await db.from('sms_agency_policies').update({send_enabled:false}).eq('organization_id',org);await assert.rejects(()=>dispatch(db,timeout,transport),/already has an attempt/);assert.equal(posts.length,attempted);await db.from('sms_agency_policies').update({send_enabled:true}).eq('organization_id',org);
  mode="rejected";const rejected=manual();await assert.rejects(()=>dispatch(db,rejected,transport));const d=(await db.from("sms_dispatches").select("state").eq("organization_id",org).eq("request_key",rejected.key).maybeSingle()).data;assert.equal(d?.state,"failed");
 }finally{globalThis.fetch=originalFetch;mode="accepted";}
}});
Deno.test({name:"native Edge: preview action returns before send even with body; View As and legacy bypass refused",sanitizeResources:false,sanitizeOps:false,fn:async()=>{
 globalThis.fetch=transport;const serve=Deno.serve;let handler:((r:Request)=>Promise<Response>)|undefined;
 Object.defineProperty(Deno,"serve",{value:(f:(r:Request)=>Promise<Response>)=>{handler=f;return {};},configurable:true});
 try{
  await import("../../twilio-sms/index.ts");assert.ok(handler);const before=posts.length;
  const req=(body:unknown)=>new Request(url+"/functions/v1/twilio-sms",{method:"POST",headers:{Authorization:`Bearer ${Deno.env.get("STICKY_ACTOR_TOKEN")}`,"Content-Type":"application/json"},body:JSON.stringify(body)});
  const response=await handler(req({action:"preview",contact_id:contactId,contact_type:"lead",body:"MUST NOT SEND",to:"+12025550101"}));assert.equal(response.status,200);assert.equal(posts.length,before);
  const denied=await handler(req({action:"preview",contact_id:contactId,contact_type:"lead",view_as:true}));assert.equal(denied.status,403);
  const afterhours=await handler(req({to:"+12025550101",from:"+12025551111",body:"after hours"}));assert.notEqual(afterhours.status,200);assert.equal(posts.length,before);
 }finally{Object.defineProperty(Deno,"serve",{value:serve,configurable:true});globalThis.fetch=originalFetch;}
}});
Deno.test({name:"native legacy packages: all four deployed outbound dispatchers, old hashes, stale candidates and internal exemption",sanitizeResources:false,sanitizeOps:false,fn:async()=>{
 globalThis.fetch=transport;
 try {
  const root=Deno.env.get('STICKY_LEGACY_ROOT');assert.ok(root?.startsWith('/workspace/'));
  for(const slug of ['twilio-sms','workflow-executor','sms-consent-worker','clearpath-lead-alert']) {
   const legacy=await import(`file://${root}/${slug}/_shared/sms/dispatch.ts`);
   const input={org,key:`workflow:90000000-0000-4000-8000-000000000002:${crypto.randomUUID()}`,actor,contactId,contactType:'lead',purpose:'informational',to:'+12025550101',from:'+12025551111',body:'Synthetic legacy '+slug};
   const before=posts.length;const result=await legacy.dispatch(db,input,transport);assert.equal(result.success,true,slug);assert.equal(posts.length,before+1);assert.equal(posts.at(-1)?.from,'+12025551111');
   const replay=await legacy.dispatch(db,input,transport);assert.equal(replay.replayed,true);assert.equal(posts.length,before+1);
   await assert.rejects(()=>legacy.dispatch(db,{...input,key:input.key+'x',from:'+12025552222'},transport));assert.equal(posts.length,before+1);
  }
  const old=await import(`file://${root}/sms-consent-worker/_shared/sms/dispatch.ts`);const before=posts.length;
  const accepted=await old.dispatch(db,{org,key:'old-accepted',actor,contactId,contactType:'lead',purpose:'informational',to:'+12025550101',from:'+12025551111',body:'Old accepted receipt'},transport);
  assert.equal(accepted.replayed,true);assert.equal(posts.length,before);
  const cp=await import(`file://${root}/clearpath-lead-alert/_shared/sms/dispatch.ts`);
  const alert={org,key:'clearpath:lead:synthetic-alert',actor,purpose:'informational',to:'+12025557777',from:'+12025551111',body:'Synthetic internal agent alert'};
  assert.equal((await cp.dispatch(db,alert,transport)).success,true);
  await assert.rejects(()=>cp.dispatch(db,{...alert,key:'clearpath:lead:forged-recipient',to:'+12025557778'},transport));
  await assert.rejects(()=>old.dispatch(db,{org,key:'afterhours:synthetic',purpose:'informational',to:'+12025550101',from:'+12025551111',body:'After hours'},transport));
 } finally {globalThis.fetch=originalFetch;}
}});

Deno.test({name:"E09 E10 actual new and deployed confirmation workers share server binding with customer workflows",sanitizeResources:false,sanitizeOps:false,fn:async()=>{
 globalThis.fetch=transport;
 const checked=<T>(r:{data:T,error:unknown})=>{if(r.error)throw r.error;return r.data;};
 try{
  checked(await db.from('phone_numbers').update({is_default:false}).eq('organization_id',org));checked(await db.from('phone_numbers').update({is_default:true}).eq('id','40000000-0000-4000-8000-000000000002'));
  const workflow={org,key:`workflow:90000000-0000-4000-8000-000000000002:${crypto.randomUUID()}`,contactId,contactType:'lead',purpose:'informational',to:'+12025550101',from:'+12025552222',body:'Scheduled synthetic workflow'};
  assert.equal((await dispatch(db,workflow,transport))?.success,true);assert.equal(posts.at(-1)?.from,'+12025551111');
  checked(await db.from('sms_agency_policies').update({sender_name:'CG Financial'}).eq('organization_id',org)); // Preserve the existing worker's deliberately narrow approved template.
  const worker=await import('../../sms-consent-worker/index.ts');
  for(const legacy of [false,true]){
   if(legacy){checked(await db.from('phone_numbers').update({is_default:false}).eq('organization_id',org));checked(await db.from('phone_numbers').update({is_default:true}).eq('id',number));}
   const job=crypto.randomUUID();checked(await db.from('sms_confirmation_jobs').insert({id:job,organization_id:org,phone_e164:'+12025550101',request_id:crypto.randomUUID(),purposes:['informational'],evidence_ids:['80000000-0000-4000-8000-000000000001']}));
   const implementation=legacy?await import(`file://${Deno.env.get('STICKY_LEGACY_ROOT')}/sms-consent-worker/sms-consent-worker/index.ts`):worker;
   const before=posts.length;const r:Response=await implementation.handle(new Request(url+'/functions/v1/sms-consent-worker',{method:'POST',headers:{Authorization:`Bearer ${Deno.env.get('SMS_CONSENT_WORKER_TOKEN')}`}}));assert.equal(r.status,200);assert.equal(posts.length,before+1,legacy?'deployed worker':'candidate worker');assert.equal(posts.at(-1)?.from,'+12025551111');
   const saved=checked(await db.from('sms_dispatches').select('*').eq('organization_id',org).eq('request_key','confirmation:'+job).maybeSingle());assert.equal(saved.state,'accepted');assert.equal(saved.affinity_number_id,number);assert.equal(saved.affinity_actor_id,actor);assert.equal(saved.affinity_contact_id,contactId);assert.equal(saved.actor_id,null); // Keep the old immutable hash metadata intact.
   await implementation.handle(new Request(url+'/functions/v1/sms-consent-worker',{method:'POST',headers:{Authorization:`Bearer ${Deno.env.get('SMS_CONSENT_WORKER_TOKEN')}`}}));assert.equal(posts.length,before+1);
  }
 }finally{globalThis.fetch=originalFetch;}
}});
Deno.test('F13 guard read errors, missing data and invalid modes never grant legacy fallback',async()=>{
 for(const result of [{data:null,error:{message:'synthetic read failure'}},{data:null,error:null},{data:{sms:'off'},error:null},{data:{sms:'invalid',voice:'off'},error:null}])await assert.rejects(()=>affinityGuard({rpc:async()=>result} as unknown as Db,org));
});
