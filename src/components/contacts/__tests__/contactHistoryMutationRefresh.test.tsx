import {beforeEach,describe,it,expect,vi} from 'vitest';
const h=vi.hoisted(()=>({result:{data:null,error:null} as {data:unknown;error:unknown},emit:vi.fn()}));
vi.mock('@/lib/contact-history/refresh',()=>({invalidateContactHistory:h.emit}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:()=>{
 const q:Record<string,unknown>={};for(const m of ['insert','update','delete','select','eq'])q[m]=()=>q;q.maybeSingle=async()=>h.result;return q;
},auth:{getUser:async()=>({data:{user:{id:'actor'}}})}}}));
import {tasksApi} from '@/lib/tasksApi';
import {notesSupabaseApi} from '@/lib/supabase-notes';
beforeEach(()=>{h.emit.mockReset();h.result={data:{id:'row',organization_id:'org',contact_id:'contact',contact_type:'lead'},error:null};});
describe('persisted mutation invalidations',()=>{
 it('task completion/deletion emit scoped saved-row invalidations',async()=>{
  await tasksApi.completeTask('row','org');await tasksApi.deleteTask('row','org');expect(h.emit).toHaveBeenCalledTimes(2);expect(h.emit).toHaveBeenLastCalledWith({organizationId:'org',contactId:'contact',contactType:'lead'});
 });
 it('zero-row completion/deletion is not a successful event',async()=>{
  h.result={data:null,error:null};await expect(tasksApi.completeTask('row','org')).rejects.toThrow();await expect(tasksApi.deleteTask('row','org')).rejects.toThrow();expect(h.emit).not.toHaveBeenCalled();
 });
 it('note deletion uses its returned persisted scope',async()=>{
  await notesSupabaseApi.deleteNote('row');expect(h.emit).toHaveBeenCalledWith({organizationId:'org',contactId:'contact',contactType:'lead'});
 });
 it('failed note deletion creates no optimistic history',async()=>{
  h.result={data:null,error:{message:'Denied'}};await expect(notesSupabaseApi.deleteNote('row')).rejects.toThrow('Denied');expect(h.emit).not.toHaveBeenCalled();
 });
});
