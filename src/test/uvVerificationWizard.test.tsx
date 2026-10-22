import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VerificationWizard } from '@/components/underwriter-verified/VerificationWizard';
import { credentialsSchema, identitySchema, setupDraftSchema } from '@/lib/uv-profile/setup';
const mock=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc}}));
const profileId='20000000-0000-4000-8000-000000000001',organizationId='10000000-0000-4000-8000-000000000001';
const scope={profileId,organizationId};
const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4l8AAAAASUVORK5CYII=';
const draft={first_name:'Test',last_name:'Agent',phone:'5550001000',email:'agent@example.invalid',avatar_url:photo,npn:'123456',bio:'',brand_name:'Shared Agency',
 licenses:[{id:'30000000-0000-4000-8000-000000000001',state:'California',license_number:'1234',expiration_date:null}]};
const snapshot={profile_id:profileId,organization_id:organizationId,revision:'3',snapshot:'a'.repeat(32),draft};
const status={profile_id:profileId,organization_id:organizationId,available:true,desired_published:false,phone_public:false,email_public:false,revision:'3',state:'private' as const,public_url:null,last_synced_at:null,verified:false};
beforeEach(()=>{mock.rpc.mockReset();mock.rpc.mockResolvedValue({data:snapshot,error:null});vi.stubGlobal('ResizeObserver',class {observe(){}unobserve(){}disconnect(){}});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
async function review(){await screen.findByDisplayValue('Test');fireEvent.click(screen.getByRole('button',{name:'Continue'}));fireEvent.click(screen.getByRole('button',{name:'Continue'}));}
describe('verification wizard',()=>{
 it('prefills saved details, accepts undated licenses and optional bio, requires confirmation',async()=>{
  const complete=vi.fn().mockResolvedValue({});render(<VerificationWizard scope={scope} status={status} onClose={vi.fn()} onRefresh={vi.fn()} onComplete={complete}/>);
  await screen.findByDisplayValue('Shared Agency');
  fireEvent.change(screen.getByRole('textbox',{name:'Agency / Brand Name (optional)'}),{target:{value:'Independent Life'}});
  await review();expect(screen.getByRole('button',{name:'Confirm & get verified'})).toBeDisabled();
  expect(screen.getByText('Independent Life')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox',{name:/About you/}),{target:{value:'Helping families'}});
  fireEvent.click(screen.getByRole('checkbox',{name:/I confirm/}));fireEvent.click(screen.getByRole('button',{name:'Confirm & get verified'}));
  await waitFor(()=>expect(complete).toHaveBeenCalledWith(snapshot,{...draft,bio:'Helping families',brand_name:'Independent Life'},true,true));
  expect(screen.queryByText('Your agent site is ready')).toBeNull();expect(await screen.findByText('Setting up your agent site')).toBeInTheDocument();
 });
 it('does not call completion for a missing photo',async()=>{
  mock.rpc.mockResolvedValue({data:{...snapshot,draft:{...draft,avatar_url:''}},error:null});const complete=vi.fn();
  render(<VerificationWizard scope={scope} status={status} onClose={vi.fn()} onRefresh={vi.fn()} onComplete={complete}/>);
  await screen.findByDisplayValue('Test');fireEvent.click(screen.getByRole('button',{name:'Continue'}));
  expect(screen.getByRole('alert')).toHaveTextContent('Add a profile photo');expect(complete).not.toHaveBeenCalled();
 });
 it('preserves edits when saving fails and never shows a success badge',async()=>{
  const complete=vi.fn().mockRejectedValue(new Error('Save failed'));
  render(<VerificationWizard scope={scope} status={status} onClose={vi.fn()} onRefresh={vi.fn()} onComplete={complete}/>);
  await review();fireEvent.change(screen.getByRole('textbox',{name:/About you/}),{target:{value:'Keep my bio'}});
  fireEvent.click(screen.getByRole('checkbox',{name:/I confirm/}));fireEvent.click(screen.getByRole('button',{name:'Confirm & get verified'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Save failed');expect(screen.getByDisplayValue('Keep my bio')).toBeInTheDocument();expect(screen.queryByText('Your agent site is ready')).toBeNull();
 });
 it('shows completion only after the published verified receipt arrives',async()=>{
  const props={scope,status,onClose:vi.fn(),onRefresh:vi.fn(),onComplete:vi.fn().mockResolvedValue({})};
  const view=render(<VerificationWizard {...props}/>);await review();fireEvent.click(screen.getByRole('checkbox',{name:/I confirm/}));fireEvent.click(screen.getByRole('button',{name:'Confirm & get verified'}));
  await screen.findByText('Setting up your agent site');view.rerender(<VerificationWizard {...props} status={{...status,state:'published',verified:true,public_url:'https://www.underwriterverified.com/synthetic/test-agent'}}/>);
  expect(screen.getByText('Your agent site is ready')).toBeInTheDocument();expect(screen.getByRole('link',{name:'View Agent Page'})).toHaveAttribute('href','https://www.underwriterverified.com/synthetic/test-agent');
 });
 it.each(['first_name','last_name','phone','email','avatar_url'])('requires %s',field=>{expect(identitySchema.safeParse({...draft,[field]:''}).success).toBe(false);});
 it('requires an NPN and numbered license, without an expiration or bio requirement',()=>{
  expect(setupDraftSchema.safeParse(draft).success).toBe(true);
  expect(credentialsSchema.safeParse({...draft,npn:''}).success).toBe(false);
  expect(credentialsSchema.safeParse({...draft,licenses:[]}).success).toBe(false);
  expect(credentialsSchema.safeParse({...draft,licenses:[{...draft.licenses[0],license_number:''}]}).success).toBe(false);
 });
});
