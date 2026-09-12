-- =====================================================================================================
-- Inbound Calling v2 — disposable-localhost harness extension (applied AFTER inbound_harness.sql + M1–M3,
-- BEFORE M4–M7). LOCAL ONLY — never production (AGENT_RULES invariant #28).
-- =====================================================================================================
-- Adds the baseline-faithful surface the v2 migrations and suites need and the base harness lacks:
--   profiles.availability_status / email / phone; inbound_routing_settings (+ unique org index);
--   notifications (+ event_key unique arbiter, RLS shape from 20260819163413); get_user_role(),
--   is_super_admin(), get_user_org_id(); a minimal storage schema (buckets/objects) so M7's bucket insert
--   and object policy can be authored and asserted; the private schema.

CREATE SCHEMA IF NOT EXISTS private;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS availability_status text NOT NULL DEFAULT 'Available',
  ADD COLUMN IF NOT EXISTS email text DEFAULT '',
  ADD COLUMN IF NOT EXISTS phone text DEFAULT '';

CREATE TABLE IF NOT EXISTS public.inbound_routing_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  routing_mode text NOT NULL DEFAULT 'round_robin',
  auto_create_lead boolean NOT NULL DEFAULT false,
  after_hours_sms_enabled boolean NOT NULL DEFAULT false,
  after_hours_sms text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  organization_id uuid NOT NULL,
  voicemail_enabled boolean DEFAULT false,
  fallback_action text DEFAULT 'voicemail',
  voicemail_greeting_text text,
  voicemail_greeting_url text,
  forwarding_number text,
  inbound_fallback_chain jsonb NOT NULL DEFAULT '["last_agent","campaign_agents","all_available"]'::jsonb,
  CONSTRAINT inbound_routing_settings_fallback_action_check CHECK (fallback_action = ANY (ARRAY['voicemail','forward','hangup'])),
  CONSTRAINT inbound_routing_settings_routing_mode_check CHECK (routing_mode = ANY (ARRAY['assigned','all-ring','round_robin']))
);
CREATE UNIQUE INDEX IF NOT EXISTS inbound_routing_settings_org_unique_idx ON public.inbound_routing_settings (organization_id);

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL DEFAULT 'system',
  title text NOT NULL,
  body text NOT NULL,
  read boolean NOT NULL DEFAULT false,
  action_url text,
  action_label text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  organization_id uuid,
  event_key text NOT NULL DEFAULT (gen_random_uuid())::text,
  dismissed_at timestamptz,
  CONSTRAINT notifications_type_check CHECK (type = ANY (ARRAY['win','missed_call','lead_claimed','appointment_reminder','anniversary','system','inbound_sms','inbound_email']))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_user_event_key ON public.notifications (user_id, event_key);

CREATE OR REPLACE FUNCTION public.get_user_role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::json->'app_metadata'->>'role', '');
$$;
CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((current_setting('request.jwt.claims', true)::json->>'is_super_admin')::boolean, false);
$$;
CREATE OR REPLACE FUNCTION public.get_user_org_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT organization_id FROM profiles WHERE id = auth.uid()
$$;

-- Minimal storage surface (production has the real one).
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY, name text NOT NULL, public boolean NOT NULL DEFAULT false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA storage TO service_role;
GRANT SELECT ON storage.objects TO authenticated;
GRANT SELECT ON storage.buckets TO authenticated;

-- Corrective pass 12: the Supabase migration-history table, so the release tooling (state classifier,
-- history verifier) can be exercised locally against the same object shape production has.
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version text PRIMARY KEY,
  statements text[],
  name text
);

-- Corrective pass 11: reproduce THIS PROJECT'S default privileges before M4–M7 create their tables.
-- Verified read-only in production (pg_default_acl, grantor postgres, schema public, objtype 'r'):
--   postgres=arwdDxtm/postgres | anon=arwdDxtm/postgres | authenticated=arwdDxtm/postgres | service_role=arwdDxtm/postgres
-- Every table the migrations create therefore STARTS with the full privilege set for anon, authenticated
-- and service_role, and a GRANT can only add to it. Without this line the suites run against a permissive
-- local default (no default ACL at all) and cannot see a missing REVOKE.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;

-- Base harness grants extended to the new tables (role-real RLS is applied by the migrations themselves).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inbound_routing_settings, public.notifications TO authenticated, service_role;
ALTER TABLE public.inbound_routing_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS harness_irs_all ON public.inbound_routing_settings;
CREATE POLICY harness_irs_all ON public.inbound_routing_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notifications_select ON public.notifications;
CREATE POLICY notifications_select ON public.notifications FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id() AND user_id = auth.uid());
DROP POLICY IF EXISTS notifications_insert ON public.notifications;
CREATE POLICY notifications_insert ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid() AND organization_id = public.get_user_org_id());
