import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { parseStatus, type ProfileStatus, type Scope } from './api';
import { safePhoto } from '../../../supabase/functions/_shared/uv-profile/payload';

export const stateCodes = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');
const clean = (max: number) => z.string().trim().max(max).refine(s => ![...s].some(c => c.charCodeAt(0)<32 || c.charCodeAt(0)===127), 'Remove special control characters');
export const identitySchema = z.object({
  brand_name: clean(120).optional(),
  first_name: clean(50).refine(Boolean, 'Enter your first name'),
  last_name: clean(50).refine(Boolean, 'Enter your last name'),
  phone: clean(40).refine(s => /^\d{10,15}$/.test(s.replace(/\D/g,'')), 'Enter a valid phone number'),
  email: clean(254).pipe(z.string().email('Enter a valid email')),
  avatar_url: z.string().min(1, 'Add a profile photo').refine(safePhoto, 'Use a JPG, PNG or WebP photo under 3 MB'),
});
const licenseSchema = z.object({id:z.string().uuid().nullable(),state:z.string().min(1),license_number:clean(50),expiration_date:z.string().nullable()});
export const credentialsSchema = z.object({npn:clean(40).refine(Boolean,'Enter your NPN'),
  licenses:z.array(licenseSchema).min(1,'Add a state license').max(60)
    .refine(rows => rows.some(r => r.license_number.trim()), 'Enter at least one license number')
    .refine(rows => rows.every(r => r.id || (stateCodes.includes(r.state) && r.license_number.trim())), 'Complete each new license'),
});
export const setupDraftSchema = identitySchema.merge(credentialsSchema).extend({bio:z.string().trim().max(2000)});
export type SetupDraft = z.infer<typeof setupDraftSchema>;
const snapshotSchema = z.object({profile_id:z.string().uuid(),organization_id:z.string().uuid(),revision:z.string(),snapshot:z.string().regex(/^[a-f0-9]{32}$/),
  draft:z.object({brand_name:clean(120).optional(),first_name:z.string(),last_name:z.string(),phone:z.string(),email:z.string(),avatar_url:z.string(),npn:z.string(),bio:z.string(),licenses:z.array(licenseSchema)})});
export type SetupSnapshot = z.infer<typeof snapshotSchema>;
type Client = {rpc:(name:string,args?:Record<string,unknown>) => PromiseLike<{data:unknown;error:unknown}>};
const client=supabase as unknown as Client;
export function parseVerification(data:unknown,scope:Scope):ProfileStatus {
  const result=z.object({status:z.unknown(),verified:z.boolean()}).strict().parse(data);
  return {...parseStatus(result.status,scope),verified:result.verified};
}
export async function getSetup(scope:Scope):Promise<SetupSnapshot> {
  const result=await client.rpc('get_my_uv_setup');
  if(result.error) throw new Error('Unable to load your profile. Please try again.');
  const data=snapshotSchema.parse(result.data);
  if(data.profile_id!==scope.profileId || data.organization_id!==scope.organizationId) throw new Error('Profile scope changed.');
  return data;
}
export async function completeSetup(scope:Scope,snapshot:SetupSnapshot,draft:SetupDraft,phonePublic:boolean,emailPublic:boolean):Promise<ProfileStatus> {
  const result=await client.rpc('complete_my_uv_setup',{p_profile_id:scope.profileId,p_organization_id:scope.organizationId,
    p_expected_revision:snapshot.revision,p_snapshot:snapshot.snapshot,p_draft:setupDraftSchema.parse(draft),p_phone_public:phonePublic,p_email_public:emailPublic});
  if(result.error) throw new Error('Could not save. Your profile may have changed elsewhere. Close and reopen setup to reload your latest information.');
  return parseVerification(result.data,scope);
}
