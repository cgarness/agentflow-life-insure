import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';

export const preferencesSchema = z.object({ published:z.boolean(),phonePublic:z.boolean(),emailPublic:z.boolean() }).strict();
export type Preferences = z.infer<typeof preferencesSchema>;
export interface ProfileStatus {
  profile_id:string; organization_id:string; available:boolean; desired_published:boolean;
  phone_public:boolean; email_public:boolean; revision:string;
  state:'disabled'|'private'|'pending'|'published'|'attention'; public_url:string|null; last_synced_at:string|null;
}
const statusSchema = z.object({
  profile_id:z.string().uuid(),organization_id:z.string().uuid(),available:z.boolean(),desired_published:z.boolean(),
  phone_public:z.boolean(),email_public:z.boolean(),revision:z.string().regex(/^(0|[1-9]\d{0,18})$/),
  state:z.enum(['disabled','private','pending','published','attention']),
  public_url:z.string().regex(/^https:\/\/www\.underwriterverified\.com\/[a-z0-9][a-z0-9-]{0,79}\/[a-z0-9][a-z0-9-]{0,79}$/).nullable(),
  last_synced_at:z.string().datetime({offset:true}).nullable(),
}).strict();
export type Scope = {profileId:string;organizationId:string};
// Only these two user-scoped endpoints are exposed before generated types are refreshed.
type Client = {rpc:(name:'get_my_uv_profile'|'set_my_uv_profile',args?:Record<string,unknown>) => PromiseLike<{data:unknown;error:unknown}>};
const client = supabase as unknown as Client;
export function parseStatus(data:unknown,scope:Scope):ProfileStatus {
  const parsed = statusSchema.parse(data);
  if (parsed.profile_id!==scope.profileId || parsed.organization_id!==scope.organizationId) throw new Error('Profile scope changed.');
  return parsed as ProfileStatus;
}
export async function getProfileStatus(scope:Scope):Promise<ProfileStatus> {
  const result = await client.rpc('get_my_uv_profile');
  if (result.error) throw new Error('Public profile unavailable.');
  return parseStatus(result.data,scope);
}
export async function saveProfilePreferences(scope:Scope,value:Preferences,revision:string):Promise<ProfileStatus> {
  const input = preferencesSchema.parse(value);
  if (!/^(0|[1-9]\d{0,18})$/.test(revision)) throw new Error('Reload profile settings.');
  const result = await client.rpc('set_my_uv_profile',{p_profile_id:scope.profileId,p_organization_id:scope.organizationId,
    p_published:input.published,p_phone_public:input.phonePublic,p_email_public:input.emailPublic,p_expected_revision:revision});
  if (result.error) throw new Error('Could not save. Reload profile settings and try again.');
  return parseStatus(result.data,scope);
}
