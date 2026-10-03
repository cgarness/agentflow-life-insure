import { beforeEach,describe,it,expect,vi } from 'vitest';
const h=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),queries:[] as {table:string;org:string;ids:string[]}[],failNames:false}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:h.rpc,from:h.from}}));
import { getConversationPage,getActivityPage } from '../queries';
const agent='00000000-0000-0000-0000-000000000011',campaign='00000000-0000-0000-0000-000000000022';
const request={scope:{viewerId:'viewer',organizationId:'org',contactId:'contact',contactType:'lead' as const},filter:'all' as const,signal:new AbortController().signal};
beforeEach(()=>{
 h.queries=[];h.failNames=false;
 h.rpc.mockReturnValue({abortSignal:async()=>({data:{items:Array.from({length:30},(_,i)=>({kind:'call',event_key:`call:${i}`,event_time:null,payload:{id:String(i),direction:'outbound',agent_id:agent,campaign_id:campaign}})),hasMore:false,nextCursor:null},error:null})});
 h.from.mockImplementation((table:string)=>{
  const q={table,org:'',ids:[] as string[]};h.queries.push(q);
  const builder={select:()=>builder,eq:(_k:string,v:string)=>{q.org=v;return builder;},in:(_k:string,v:string[])=>{q.ids=v;return builder;},abortSignal:async()=>({data:table==='profiles'?[{id:agent,first_name:'Stored',last_name:'Agent'}]:[{id:campaign,name:'Visible campaign'}],error:h.failNames?{message:'unavailable'}:null})};return builder;
 });
});
describe('scoped paged readers',()=>{
 it('batches unique agent/campaign IDs once each per page and scopes all name reads',async()=>{
  const result=await getConversationPage(request);
  expect(h.queries).toEqual([{table:'profiles',org:'org',ids:[agent]},{table:'campaigns',org:'org',ids:[campaign]}]);
  expect(result.items[0]).toMatchObject({agentName:'Stored Agent',campaignName:'Visible campaign'});
  expect(h.rpc).toHaveBeenCalledWith('get_contact_conversation_page',expect.objectContaining({p_contact_id:'contact',p_contact_type:'lead',p_page_size:30,p_filter:'all'}));
 });
 it('keeps genuine records with neutral labels when enrichment fails',async()=>{
  h.failNames=true;const page=await getConversationPage(request);expect(page.items).toHaveLength(30);expect(page.enrichmentUnavailable).toBe(true);expect(page.items[0]).toMatchObject({agentName:'Agent unavailable'});
 });
 it('does not turn a failed source into an empty success',async()=>{
  h.rpc.mockReturnValue({abortSignal:async()=>({data:null,error:{code:'42501'}})});
  await expect(getActivityPage(request)).rejects.toThrow('Could not load history');
 });
 it('rejects incomplete identity before any RPC',async()=>{
  h.rpc.mockClear();await expect(getConversationPage({...request,scope:{...request.scope,viewerId:''}})).rejects.toThrow();expect(h.rpc).not.toHaveBeenCalled();
 });
 it('surfaces cursor invalidation as a refresh request',async()=>{
  h.rpc.mockReturnValue({abortSignal:async()=>({data:null,error:{code:'22023'}})});await expect(getConversationPage(request)).rejects.toThrow('History changed');
 });
});
