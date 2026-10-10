-- =====================================================================================================
-- Synthetic LOCAL harness for supabase/migrations/pending/20261011120000_onboarding_email_foundation.sql.
-- Mirrors only the production shapes the feature reads: Supabase roles, auth.users (with the GoTrue
-- columns used: email_confirmed_at, deleted_at, banned_until), auth.uid(), organizations, profiles
-- (ON DELETE CASCADE from auth.users), company_settings (unique organization_id), and
-- public.get_org_id() copied verbatim from 20260806000000_baseline_production_schema.sql.
-- No production data; never run against a hosted project (scripts/run_onboarding_email_tests.sh
-- proves locality first).
-- =====================================================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

CREATE SCHEMA auth;
CREATE SCHEMA private;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

-- Supabase's default privileges grant new public objects to the API roles; the migration must
-- revoke them itself. Reproduce that so a missing REVOKE fails the privilege tests.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TABLE auth.users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              varchar(255),
  email_confirmed_at timestamptz,
  banned_until       timestamptz,
  deleted_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Same contract as Supabase's auth.uid(): the JWT subject from the request settings.
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
$$;

CREATE TABLE public.organizations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_at timestamptz DEFAULT now(),
  status     text DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived'))
);

CREATE TABLE public.profiles (
  id                    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email                 text NOT NULL DEFAULT '',
  first_name            text NOT NULL DEFAULT '',
  last_name             text NOT NULL DEFAULT '',
  organization_id       uuid REFERENCES public.organizations(id),
  role                  text NOT NULL DEFAULT 'Agent' CHECK (role IN ('Agent', 'Team Leader', 'Admin', 'Super Admin')),
  status                text NOT NULL DEFAULT 'Active',
  is_super_admin        boolean DEFAULT false,
  welcome_email_sent_at timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.profiles TO authenticated;

CREATE TABLE public.company_settings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name    text NOT NULL DEFAULT 'Agency',
  timezone        text DEFAULT 'America/Chicago',
  organization_id uuid REFERENCES public.organizations(id),
  CONSTRAINT company_settings_org_unique UNIQUE (organization_id)
);

-- Verbatim from 20260806000000_baseline_production_schema.sql.
CREATE OR REPLACE FUNCTION "public"."get_org_id"() RETURNS "uuid"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_org uuid;
BEGIN
  -- Primary: JWT claim (fast path — no table access)
  v_org := NULLIF(
    current_setting('request.jwt.claims', true)::json
      ->'app_metadata'->>'organization_id',
    ''
  )::uuid;

  IF v_org IS NOT NULL THEN
    RETURN v_org;
  END IF;

  -- Fallback: profile table lookup (handles stale/missing JWT claims)
  SELECT organization_id INTO v_org
  FROM public.profiles
  WHERE id = auth.uid();

  RETURN v_org;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_org_id() TO anon, authenticated, service_role;

-- ── Synthetic fixtures that exist BEFORE the migration ──────────────────────────────────────────
-- Agencies: A1 New York, A2 Los Angeles (other tenant), A3 suspended, A4 no settings row, A5 bad zone.
INSERT INTO public.organizations (id, name, status) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'Agency One',   'active'),
  ('00000000-0000-0000-0000-0000000000a2', 'Agency Two',   'active'),
  ('00000000-0000-0000-0000-0000000000a3', 'Agency Three', 'suspended'),
  ('00000000-0000-0000-0000-0000000000a4', 'Agency Four',  'active'),
  ('00000000-0000-0000-0000-0000000000a5', 'Agency Five',  NULL);
INSERT INTO public.company_settings (organization_id, timezone) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'America/New_York'),
  ('00000000-0000-0000-0000-0000000000a2', 'America/Los_Angeles'),
  ('00000000-0000-0000-0000-0000000000a3', 'America/Chicago'),
  ('00000000-0000-0000-0000-0000000000a5', 'Not/A_Zone');

-- Historical user: confirmed, Active, welcome sent long ago. Must never be enrolled (no backfill).
INSERT INTO auth.users (id, email, email_confirmed_at, created_at) VALUES
  ('00000000-0000-0000-0000-000000000901', 'historical@example.test', '2025-06-01', '2025-06-01');
INSERT INTO public.profiles (id, email, first_name, organization_id, role, welcome_email_sent_at, created_at) VALUES
  ('00000000-0000-0000-0000-000000000901', 'historical@example.test', 'Hal',
   '00000000-0000-0000-0000-0000000000a1', 'Agent', '2025-06-01 15:00+00', '2025-06-01');
