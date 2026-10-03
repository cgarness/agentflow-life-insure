import {act,renderHook,waitFor,cleanup} from '@testing-library/react';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
const h=vi.hoisted(()=>({conversation:vi.fn(),activity:vi.fn()}));
vi.mock('@/lib/contact-history/queries',()=>({getConversationPage:h.conversation,getActivityPage:h.activity}));
import {useContactHistory} from '../useContactHistory';
import {invalidateContactHistory} from '@/lib/contact-history/refresh';
const scope={viewerId:'viewer',organizationId:'org',contactType:'lead' as const,contactId:'one'};
const page=(key:string,more=false)=>({items:[{key}],hasMore:more,nextCursor:more?{key}:null});
beforeEach(()=>{h.conversation.mockReset().mockResolvedValue(page('call:1'));h.activity.mockReset().mockResolvedValue(page('event:1'));});
afterEach(()=>{cleanup();vi.useRealTimers();});
describe('history coordinator',()=>{
 it('hides old contact immediately and discards late completions',async()=>{
  let complete!:(v:unknown)=>void;h.conversation.mockImplementationOnce(()=>new Promise(r=>{complete=r;}));
  const {result,rerender}=renderHook(({id})=>useContactHistory({...scope,contactId:id},'all',true),{initialProps:{id:'one'}});
  rerender({id:'two'});expect(result.current.conversation.items).toEqual([]);
  await waitFor(()=>expect(result.current.conversation.loading).toBe(false));
  await act(async()=>complete(page('old-contact')));expect(result.current.conversation.items[0].key).toBe('call:1');
 });
 it('coalesces persisted mutation signals while a request is running',async()=>{
  let complete!:(v:unknown)=>void;h.conversation.mockImplementationOnce(()=>new Promise(r=>{complete=r;}));
  const {result}=renderHook(()=>useContactHistory(scope,'all',true));
  act(()=>{for(let i=0;i<5;i++)invalidateContactHistory({organizationId:'org',contactId:'one'});});
  expect(h.conversation).toHaveBeenCalledTimes(1);
  await act(async()=>complete(page('call:1')));await waitFor(()=>expect(result.current.conversation.loading).toBe(false));
  expect(h.conversation).toHaveBeenCalledTimes(2);
 });
 it('loads earlier with cursor and dedupes repeated page identities',async()=>{
  h.conversation.mockResolvedValueOnce(page('call:1',true)).mockResolvedValueOnce({items:[{key:'call:1'},{key:'call:2'}],hasMore:false,nextCursor:null});
  const {result}=renderHook(()=>useContactHistory(scope,'all',true));
  await waitFor(()=>expect(result.current.conversation.loading).toBe(false));act(()=>result.current.loadConversation());
  await waitFor(()=>expect(result.current.conversation.items).toHaveLength(2));expect(h.conversation.mock.calls[1][0].cursor).toEqual({key:'call:1'});
 });
 it('keeps saved history visible on refresh failure and exposes Retry error',async()=>{
  const {result}=renderHook(()=>useContactHistory(scope,'all',true));await waitFor(()=>expect(result.current.activity.loading).toBe(false));
  h.activity.mockRejectedValueOnce(new Error('unavailable'));act(()=>result.current.refresh());await waitFor(()=>expect(result.current.activity.error).toBe('unavailable'));expect(result.current.activity.items).toHaveLength(1);
 });
 it('blocked scope does no reads',()=>{renderHook(()=>useContactHistory(null,'all',true));expect(h.conversation).not.toHaveBeenCalled();expect(h.activity).not.toHaveBeenCalled();});
 it('ignores unrelated organizations and contacts',async()=>{
  const {result}=renderHook(()=>useContactHistory(scope,'all',true));await waitFor(()=>expect(result.current.activity.loading).toBe(false));
  act(()=>{invalidateContactHistory({organizationId:'other'});invalidateContactHistory({organizationId:'org',contactId:'other'});});expect(h.activity).toHaveBeenCalledTimes(1);
 });
});
