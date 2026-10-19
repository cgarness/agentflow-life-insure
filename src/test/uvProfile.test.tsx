import React from 'react';
import { act,cleanup,fireEvent,render,renderHook,screen,waitFor } from '@testing-library/react';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { preferencesSchema,parseStatus,saveProfilePreferences } from '@/lib/uv-profile/api';
import { useUnderwriterVerifiedProfile } from '@/hooks/useUnderwriterVerifiedProfile';
import { UnderwriterVerifiedProfile } from '@/components/underwriter-verified/UnderwriterVerifiedProfile';

const mock=vi.hoisted(()=>({rpc:vi.fn(),auth:{} as Record<string,unknown>}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:async(name:string,args?:unknown)=>{const result=await mock.rpc(name,args);return name==='get_my_uv_verification'&&result?.data?{...result,data:{status:result.data,verified:false}}:result;}}}));
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>mock.auth}));
const user='20000000-0000-4000-8000-000000000001',org='10000000-0000-4000-8000-000000000001';
const scope={profileId:user,organizationId:org};
const status={profile_id:user,organization_id:org,available:true,desired_published:false,phone_public:false,email_public:false,
 revision:'0',state:'private' as const,public_url:null,last_synced_at:null};
let cache:QueryClient;
function wrapper({children}:{children:React.ReactNode}){return <QueryClientProvider client={cache}>{children}</QueryClientProvider>;}
beforeEach(()=>{
 vi.stubGlobal('ResizeObserver',class {observe(){} unobserve(){} disconnect(){}});
 vi.stubEnv('VITE_UV_PROFILE_ENABLED','true');mock.rpc.mockReset();mock.rpc.mockResolvedValue({data:status,error:null});
 const profile={id:user,organization_id:org,phone:'+15550001000',email:'synthetic@example.invalid'};
 mock.auth={isLoading:false,isImpersonating:false,user:{id:user},profile,realProfile:profile};
 cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0},mutations:{retry:false}}});
});
afterEach(()=>{cleanup();cache.clear();vi.useRealTimers();vi.unstubAllEnvs();vi.unstubAllGlobals();});

describe('profile API contract',()=>{
 it.each(['phonePublic','emailPublic','published'])('requires explicit boolean %s',field=>{
  expect(()=>preferencesSchema.parse({published:false,phonePublic:false,emailPublic:false,[field]:'yes'})).toThrow();
 });
 it('rejects injected private fields',()=>{expect(()=>preferencesSchema.parse({published:true,phonePublic:false,emailPublic:false,organizationId:org})).toThrow();});
 it('rejects a response for another user or organization',()=>{
  expect(()=>parseStatus({...status,profile_id:org},scope)).toThrow();expect(()=>parseStatus({...status,organization_id:user},scope)).toThrow();
 });
 it.each(['https://evil.example/profile','javascript:alert(1)','https://www.underwriterverified.com.evil.example/a/b'])('refuses untrusted profile URL %s',public_url=>{
  expect(()=>parseStatus({...status,public_url},scope)).toThrow();
 });
 it('sends caller-scope preconditions and optimistic revision',async()=>{
  await saveProfilePreferences(scope,{published:true,phonePublic:false,emailPublic:true},'0');
  expect(mock.rpc).toHaveBeenCalledWith('set_my_uv_profile',{p_profile_id:user,p_organization_id:org,p_published:true,p_phone_public:false,p_email_public:true,p_expected_revision:'0'});
 });
 it('does not expose database error details',async()=>{
  mock.rpc.mockResolvedValue({data:null,error:{message:'internal secret details'}});
  await expect(saveProfilePreferences(scope,{published:false,phonePublic:false,emailPublic:false},'0')).rejects.toThrow('Could not save. Reload profile settings');
 });
});

describe('profile hook authorization and async scope',()=>{
 it.each(['private','published','disabled','attention'])('does not poll a settled %s status',async state=>{
  vi.useFakeTimers();mock.rpc.mockResolvedValue({data:{...status,state},error:null});
  renderHook(()=>useUnderwriterVerifiedProfile(true),{wrapper});
  await act(async()=>{await vi.advanceTimersByTimeAsync(120_000);});
  expect(mock.rpc).toHaveBeenCalledTimes(1);
 });
 it('stops pending status refresh after its short window',async()=>{
  vi.useFakeTimers();mock.rpc.mockResolvedValue({data:{...status,state:'pending'},error:null});
  renderHook(()=>useUnderwriterVerifiedProfile(true),{wrapper});
  await act(async()=>{await vi.advanceTimersByTimeAsync(35_000);});
  const calls=mock.rpc.mock.calls.length;expect(calls).toBeGreaterThan(1);expect(calls).toBeLessThanOrEqual(17);
  await act(async()=>{await vi.advanceTimersByTimeAsync(120_000);});expect(mock.rpc).toHaveBeenCalledTimes(calls);
 });
 it('refreshes after saved profile data changes but not a presence update',async()=>{
  const {rerender}=renderHook(()=>useUnderwriterVerifiedProfile(true),{wrapper});
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledTimes(1));
  mock.auth.realProfile={...(mock.auth.realProfile as object),availability:'Available'};rerender();
  expect(mock.rpc).toHaveBeenCalledTimes(1);
  mock.auth.realProfile={...(mock.auth.realProfile as object),first_name:'Saved'};rerender();
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledTimes(2));
 });
 it.each(['loading','impersonating','wrong-profile','signed-out'])('never requests data when %s',mode=>{
  if(mode==='loading')mock.auth.isLoading=true;
  if(mode==='impersonating')mock.auth.isImpersonating=true;
  if(mode==='wrong-profile')mock.auth.profile={id:org,organization_id:org};
  if(mode==='signed-out')mock.auth.user=null;
  const {result}=renderHook(()=>useUnderwriterVerifiedProfile(true),{wrapper});
  expect(result.current.ready).toBe(false);expect(result.current.data).toBeNull();expect(mock.rpc).not.toHaveBeenCalled();
 });
 it('rejects a save callback captured before View As',async()=>{
  const {result,rerender}=renderHook(()=>useUnderwriterVerifiedProfile(true),{wrapper});await waitFor(()=>expect(result.current.data).not.toBeNull());
  const oldSave=result.current.save;mock.auth.isImpersonating=true;rerender();mock.rpc.mockClear();
  await expect(oldSave({preferences:{published:true,phonePublic:true,emailPublic:true},revision:'0'})).rejects.toThrow('scope changed');
  expect(mock.rpc).not.toHaveBeenCalled();expect(result.current.data).toBeNull();
 });
 it('does not repopulate data after an in-flight read and sign-out',async()=>{
  let resolve!:(value:unknown)=>void;mock.rpc.mockImplementation(()=>new Promise(r=>{resolve=r;}));
  const {result,rerender}=renderHook(()=>useUnderwriterVerifiedProfile(true),{wrapper});
  mock.auth.user=null;rerender();await act(async()=>{resolve({data:status,error:null});});expect(result.current.data).toBeNull();
 });
 it('does not commit an in-flight save into a new scope cache',async()=>{
  const {result,rerender}=renderHook(()=>useUnderwriterVerifiedProfile(true),{wrapper});await waitFor(()=>expect(result.current.data).not.toBeNull());
  let resolve!:(value:unknown)=>void;mock.rpc.mockImplementation(()=>new Promise(r=>{resolve=r;}));
  let promise!:Promise<unknown>;act(()=>{promise=result.current.save({preferences:{published:true,phonePublic:true,emailPublic:true},revision:'0'});});
  const rejected=expect(promise).rejects.toThrow('scope changed');await waitFor(()=>expect(resolve).toBeDefined());
  mock.auth.isImpersonating=true;rerender();await act(async()=>resolve({data:{...status,desired_published:true},error:null}));await rejected;
  expect(result.current.data).toBeNull();expect(cache.getQueryData(['uv-public-profile',null,null])).toBeUndefined();
 });
});

describe('compact profile controls',()=>{
 it('opens the protected owner page without enabling sync or requesting its settings',()=>{
  const id='ecf2bb91-0350-4542-85ec-14d914311e99';
  const profile={id,organization_id:'a0000000-0000-0000-0000-000000000001'};
  mock.auth={isLoading:false,isImpersonating:false,user:{id},profile,realProfile:profile};
  render(<UnderwriterVerifiedProfile/>,{wrapper});
  expect(screen.getByRole('link',{name:'View UV Page'})).toHaveAttribute('href','https://www.underwriterverified.com/cg-financial/christopher-garness');
  expect(screen.queryByRole('button',{name:'Edit public profile settings'})).toBeNull();expect(mock.rpc).not.toHaveBeenCalled();
 });
 it.each(['impersonating','wrong-org','signed-out','loading'])('does not show the protected link when %s',mode=>{
  const id='ecf2bb91-0350-4542-85ec-14d914311e99';
  const profile={id,organization_id:mode==='wrong-org'?org:'a0000000-0000-0000-0000-000000000001'};
  mock.auth={isLoading:mode==='loading',isImpersonating:mode==='impersonating',user:mode==='signed-out'?null:{id},profile,realProfile:profile};
  render(<UnderwriterVerifiedProfile/>,{wrapper});expect(screen.queryByRole('link',{name:'View UV Page'})).toBeNull();
 });
 it('is inert before UI activation',()=>{
  vi.stubEnv('VITE_UV_PROFILE_ENABLED','false');render(<UnderwriterVerifiedProfile/>);expect(mock.rpc).not.toHaveBeenCalled();expect(screen.queryByText('Underwriter Verified')).toBeNull();
 });
 it('keeps Agent Profile navigation-only even for an unpublished agent',async()=>{
  render(<UnderwriterVerifiedProfile/>,{wrapper});
  await screen.findByRole('button',{name:'Copy Link'});
  expect(screen.getByRole('button',{name:'View UV Page'})).toBeDisabled();
  expect(screen.getByRole('button',{name:'Copy Link'})).toBeDisabled();
  expect(screen.queryByRole('button',{name:'Edit public profile settings'})).toBeNull();
  expect(screen.queryByText('Private')).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
 });
 it('starts publication and contact checkboxes unchecked',async()=>{
  render(<UnderwriterVerifiedProfile settings/>,{wrapper});await screen.findByText('Private');fireEvent.click(screen.getByRole('button',{name:'Edit public profile settings'}));
  expect(screen.getAllByRole('checkbox')).toHaveLength(3);for(const box of screen.getAllByRole('checkbox'))expect(box).not.toBeChecked();
 });
 it('saves explicit opt-in choices independently',async()=>{
  render(<UnderwriterVerifiedProfile settings/>,{wrapper});await screen.findByText('Private');fireEvent.click(screen.getByRole('button',{name:'Edit public profile settings'}));
  fireEvent.click(screen.getByRole('checkbox',{name:'Publish profile'}));fireEvent.click(screen.getByRole('checkbox',{name:/Show email/}));fireEvent.click(screen.getByRole('button',{name:'Save'}));
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('set_my_uv_profile',expect.objectContaining({p_published:true,p_phone_public:false,p_email_public:true})));
 });
 it('shows real canonical View and Copy links only',async()=>{
  const url='https://www.underwriterverified.com/synthetic-agency/test-agent';mock.rpc.mockResolvedValue({data:{...status,state:'published',desired_published:true,public_url:url},error:null});
  const write=vi.fn().mockResolvedValue(undefined);Object.defineProperty(navigator,'clipboard',{value:{writeText:write},configurable:true});
  render(<UnderwriterVerifiedProfile/>,{wrapper});const link=await screen.findByRole('link',{name:'View UV Page'});expect(link).toHaveAttribute('href',url);
  fireEvent.click(screen.getByRole('button',{name:'Copy Link'}));await waitFor(()=>expect(write).toHaveBeenCalledWith(url));
 });
 it('does not retain an open settings dialog under View As',async()=>{
  const {rerender}=render(<UnderwriterVerifiedProfile settings/>,{wrapper});await screen.findByText('Private');fireEvent.click(screen.getByRole('button',{name:'Edit public profile settings'}));
  mock.auth.isImpersonating=true;rerender(<UnderwriterVerifiedProfile settings/>);expect(screen.queryByRole('dialog')).toBeNull();
 });
});
