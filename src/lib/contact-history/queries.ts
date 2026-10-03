import { supabase } from '@/integrations/supabase/client';
import { buildCallItem, buildEmailItem, buildSmsItem } from '@/components/contacts/conversation-history/conversationTypes';
import type { ConversationItem } from '@/components/contacts/conversation-history/conversationTypes';
import type { ActivityItem, HistoryNames, HistoryPage, HistoryRequest, HistoryRow } from './types';
import { presentActivity, text } from './presentation';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function ids(rows:HistoryRow[],kind:'profiles'|'campaigns'|'dispositions') {
 const found=new Set<string>();
 const add=(v:unknown)=>{if(typeof v==='string'&&UUID.test(v))found.add(v);};
 for(const {payload:p} of rows) {
  if(kind==='dispositions') {add(p.disposition_id);continue;}
  if(kind==='campaigns') {add(p.campaign_id);add((p.after_values as Record<string,unknown>)?.campaign_id);continue;}
  for(const k of ['agent_id','answered_by_agent_id','missed_for_agent_id','created_by','actor_id','assignee_before','assignee_after'])add(p[k]);
  if(Array.isArray(p.routed_agent_ids))p.routed_agent_ids.forEach(add);
  for(const values of [p.before_values,p.after_values]) if(values && typeof values==='object')
   for(const k of ['user_id','assigned_to','assigned_agent_id','claimed_by','callback_agent_id'])add((values as Record<string,unknown>)[k]);
 }
 return [...found];
}
async function namesFor(rows:HistoryRow[],request:HistoryRequest) {
 const names:HistoryNames={profiles:new Map(),campaigns:new Map(),dispositions:new Map()}; let unavailable=false;
 await Promise.all((['profiles','campaigns','dispositions'] as const).map(async table=>{
  const all=ids(rows,table);
  for(let i=0;i<all.length;i+=100) {
   const {data,error}=await supabase.from(table).select(table==='profiles'?'id,first_name,last_name':'id,name')
    .eq('organization_id',request.scope.organizationId).in('id',all.slice(i,i+100)).abortSignal(request.signal);
   if(error){unavailable=true;continue;}
   for(const record of data??[]) {
    const r=record as unknown as Record<string,unknown>;
    const name=table==='profiles'?[text(r.first_name),text(r.last_name)].filter(Boolean).join(' '):text(r.name);
    if(name)names[table]?.set(String(r.id),name);
   }
  }
 }));
 return {names,unavailable};
}
async function read(request:HistoryRequest,mode:'conversation'|'activity') {
 const {scope,signal}=request;
 if(!scope.viewerId||!scope.organizationId||!scope.contactId)throw new Error('Contact history scope unavailable');
 const args={p_contact_id:scope.contactId,p_contact_type:scope.contactType,p_cursor:request.cursor??undefined,p_page_size:30,
  ...(mode==='conversation'?{p_filter:request.filter}:{})};
 const {data,error}=await supabase.rpc(mode==='conversation'?'get_contact_conversation_page':'get_contact_activity_page',args).abortSignal(signal);
 if(error)throw new Error(error.code==='22023'?'History changed; refresh to continue.':'Could not load history. Retry to refresh.');
 const page=data as unknown as HistoryPage<HistoryRow>;
 if(!page||!Array.isArray(page.items)||typeof page.hasMore!=='boolean'||(page.hasMore&&!page.nextCursor))throw new Error('History response unavailable');
 const enrichment=await namesFor(page.items,request);
 if(signal.aborted)throw new DOMException('Aborted','AbortError');
 return {...page,...enrichment};
}
export async function getConversationPage(request:HistoryRequest):Promise<HistoryPage<ConversationItem>> {
 const page=await read(request,'conversation');
 return {...page,enrichmentUnavailable:page.unavailable,items:page.items.map(r=>r.kind==='call'?buildCallItem(r.payload,page.names):r.kind==='sms'?buildSmsItem(r.payload):buildEmailItem(r.payload))};
}
export async function getActivityPage(request:HistoryRequest):Promise<HistoryPage<ActivityItem>> {
 const page=await read(request,'activity');
 return {...page,enrichmentUnavailable:page.unavailable,items:page.items.map(r=>presentActivity(r,page.names))};
}
