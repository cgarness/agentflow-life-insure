-- Inbound Calling System
-- Owner: Chris Garness | Date: 2026-04-10
--
-- Scope:
--   1. Expand inbound_routing_settings (per-org scoping + new gates/fields).
--   2. Expand profiles (call forwarding, presence, inbound enable toggle).
--   3. Create voicemails table (per-agent + org-wide).
--   4. Create inbound_fork_legs table (tracks simultaneous ring legs).
--   5. Storage bucket for voicemail greetings.
--
-- Architecture note: Outbound is one-legged WebRTC (unchanged). Inbound uses
-- server-side Telnyx Call Control: webhook answers + transfers (single agent)
-- or answers + dials multiple fork legs + bridges first answer (hybrid ring).

-- ────────────────────────────────────────────────────────────────────────────
-- 1. inbound_routing_settings: per-org scoping + new columns
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.inbound_routing_settings
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS contacts_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voicemail_greeting_url text,
  ADD COLUMN IF NOT EXISTS ring_timeout_seconds integer NOT NULL DEFAULT 30;

-- Unique constraint: one row per org (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inbound_routing_settings_organization_id_key'
  ) THEN
    ALTER TABLE public.inbound_routing_settings
      ADD CONSTRAINT inbound_routing_settings_organization_id_key UNIQUE (organization_id);
  END IF;
END $$;

-- Backfill: ensure each organization has a row.
INSERT INTO public.inbound_routing_settings (organization_id)
SELECT o.id FROM public.organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM public.inbound_routing_settings irs
  WHERE irs.organization_id = o.id
)
ON CONFLICT (organization_id) DO NOTHING;

-- Replace permissive legacy policy with org-scoped policy.
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.inbound_routing_settings;
DROP POLICY IF EXISTS "inbound_routing_settings_org_scope" ON public.inbound_routing_settings;

CREATE POLICY "inbound_routing_settings_org_scope"
  ON public.inbound_routing_settings
  FOR ALL
  TO authenticated
  USING (public.is_super_admin() OR organization_id = public.get_org_id())
  WITH CHECK (public.is_super_admin() OR organization_id = public.get_org_id());

-- ────────────────────────────────────────────────────────────────────────────
-- 2. profiles: call forwarding, presence, inbound toggle
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS call_forwarding_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS call_forwarding_number text,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS inbound_enabled boolean NOT NULL DEFAULT true;

-- Index powers the "online agents in last 5 min" query on every inbound call.
CREATE INDEX IF NOT EXISTS idx_profiles_org_last_seen
  ON public.profiles (organization_id, last_seen_at DESC)
  WHERE last_seen_at IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. voicemails table
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.voicemails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  caller_number text NOT NULL,
  recording_url text,
  duration_seconds integer,
  transcription text,
  is_read boolean NOT NULL DEFAULT false,
  telnyx_call_control_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voicemails_org_created ON public.voicemails (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_voicemails_agent_unread ON public.voicemails (agent_id, is_read) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_voicemails_ccid ON public.voicemails (telnyx_call_control_id) WHERE telnyx_call_control_id IS NOT NULL;

ALTER TABLE public.voicemails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "voicemails_org_scope" ON public.voicemails;
CREATE POLICY "voicemails_org_scope"
  ON public.voicemails
  FOR ALL
  TO authenticated
  USING (public.is_super_admin() OR organization_id = public.get_org_id())
  WITH CHECK (public.is_super_admin() OR organization_id = public.get_org_id());

-- Keep updated_at fresh on mark-as-read and transcription updates.
CREATE OR REPLACE FUNCTION public.voicemails_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS voicemails_updated_at ON public.voicemails;
CREATE TRIGGER voicemails_updated_at
  BEFORE UPDATE ON public.voicemails
  FOR EACH ROW EXECUTE FUNCTION public.voicemails_touch_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 4. inbound_fork_legs table (simultaneous-ring bookkeeping)
-- ────────────────────────────────────────────────────────────────────────────
-- When an inbound call is forked to multiple agents, we need a stateless record
-- of every outbound leg so the webhook can:
--   (a) bridge the first answer to the parent inbound leg, and
--   (b) hang up all other still-ringing legs.

CREATE TABLE IF NOT EXISTS public.inbound_fork_legs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_call_id uuid NOT NULL REFERENCES public.calls(id) ON DELETE CASCADE,
  parent_control_id text NOT NULL,
  leg_control_id text NOT NULL UNIQUE,
  agent_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'dialing',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inbound_fork_legs_parent ON public.inbound_fork_legs (parent_call_id);
CREATE INDEX IF NOT EXISTS idx_inbound_fork_legs_leg ON public.inbound_fork_legs (leg_control_id);

ALTER TABLE public.inbound_fork_legs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inbound_fork_legs_org_scope" ON public.inbound_fork_legs;
CREATE POLICY "inbound_fork_legs_org_scope"
  ON public.inbound_fork_legs
  FOR ALL
  TO authenticated
  USING (public.is_super_admin() OR organization_id = public.get_org_id())
  WITH CHECK (public.is_super_admin() OR organization_id = public.get_org_id());

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Storage bucket for voicemail greetings
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('voicemail-assets', 'voicemail-assets', true)
ON CONFLICT (id) DO NOTHING;

-- Public read (so the Telnyx `playback_start` action can fetch the greeting).
DROP POLICY IF EXISTS "voicemail_assets_public_read" ON storage.objects;
CREATE POLICY "voicemail_assets_public_read"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'voicemail-assets');

-- Authenticated users can upload to their org's folder only.
DROP POLICY IF EXISTS "voicemail_assets_org_write" ON storage.objects;
CREATE POLICY "voicemail_assets_org_write"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'voicemail-assets'
    AND (storage.foldername(name))[1] = public.get_org_id()::text
  );

DROP POLICY IF EXISTS "voicemail_assets_org_update" ON storage.objects;
CREATE POLICY "voicemail_assets_org_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'voicemail-assets'
    AND (storage.foldername(name))[1] = public.get_org_id()::text
  );

DROP POLICY IF EXISTS "voicemail_assets_org_delete" ON storage.objects;
CREATE POLICY "voicemail_assets_org_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'voicemail-assets'
    AND (storage.foldername(name))[1] = public.get_org_id()::text
  );

-- Reload PostgREST schema cache so the new columns are visible immediately.
NOTIFY pgrst, 'reload schema';
