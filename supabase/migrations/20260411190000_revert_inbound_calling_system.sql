-- Revert inbound calling system (20260410120000_inbound_calling_system)
-- Restores inbound_routing_settings to legacy single-row + permissive RLS,
-- removes profiles inbound columns, voicemails, inbound_fork_legs; drops voicemail-assets storage policies (not the bucket — use Dashboard/API).

-- ── 1. Tables that reference calls / org (drop policies via CASCADE on table drop not for RLS - drop explicitly)
DROP POLICY IF EXISTS "inbound_fork_legs_org_scope" ON public.inbound_fork_legs;
DROP TABLE IF EXISTS public.inbound_fork_legs;

DROP TRIGGER IF EXISTS voicemails_updated_at ON public.voicemails;
DROP POLICY IF EXISTS "voicemails_org_scope" ON public.voicemails;
DROP TABLE IF EXISTS public.voicemails;
DROP FUNCTION IF EXISTS public.voicemails_touch_updated_at();

-- ── 2. Storage: voicemail greetings bucket (policies only)
-- Supabase blocks SQL DELETE on storage.* (protect_delete). Drop policies so the bucket
-- is unused by the app; remove the empty bucket in Dashboard → Storage if you want it gone.
DROP POLICY IF EXISTS "voicemail_assets_public_read" ON storage.objects;
DROP POLICY IF EXISTS "voicemail_assets_org_write" ON storage.objects;
DROP POLICY IF EXISTS "voicemail_assets_org_update" ON storage.objects;
DROP POLICY IF EXISTS "voicemail_assets_org_delete" ON storage.objects;

-- ── 3. profiles: presence / forwarding / inbound toggle
DROP INDEX IF EXISTS public.idx_profiles_org_last_seen;
ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS call_forwarding_enabled,
  DROP COLUMN IF EXISTS call_forwarding_number,
  DROP COLUMN IF EXISTS last_seen_at,
  DROP COLUMN IF EXISTS inbound_enabled;

-- ── 4. inbound_routing_settings: back to global default row + legacy policy
-- (Follow-up prod migration added inbound_routing_select / inbound_routing_update on organization_id.)
DROP POLICY IF EXISTS "inbound_routing_settings_org_scope" ON public.inbound_routing_settings;
DROP POLICY IF EXISTS "inbound_routing_select" ON public.inbound_routing_settings;
DROP POLICY IF EXISTS "inbound_routing_update" ON public.inbound_routing_settings;
ALTER TABLE public.inbound_routing_settings
  DROP CONSTRAINT IF EXISTS inbound_routing_settings_organization_id_key;

DELETE FROM public.inbound_routing_settings;

ALTER TABLE public.inbound_routing_settings
  DROP COLUMN IF EXISTS organization_id,
  DROP COLUMN IF EXISTS contacts_only,
  DROP COLUMN IF EXISTS voicemail_greeting_url,
  DROP COLUMN IF EXISTS ring_timeout_seconds;

INSERT INTO public.inbound_routing_settings (id)
VALUES ('00000000-0000-0000-0000-000000000000')
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.inbound_routing_settings;
CREATE POLICY "Allow all for authenticated users" ON public.inbound_routing_settings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
