-- =====================================================================================================
-- Harness for the Dashboard milestone review suite (G2).
-- STATUS: run ONLY on a disposable LOCAL PostgreSQL database (AGENT_RULES invariant #28), through
-- scripts/run_dashboard_milestone_tests.sh. Never against a hosted project.
--
-- Builds the minimum the migration depends on, with production's semantics where they matter:
--   * Supabase roles (anon / authenticated / service_role BYPASSRLS) and Supabase's DEFAULT PRIVILEGES
--     (ALL on new public tables and functions to anon/authenticated/service_role) — so the suite proves
--     the migration's REVOKEs, not a clean-room default.
--   * auth.users + auth.uid() (the JWT `sub`), schema `private`.
--   * public.get_org_id() and public.get_user_role() — VERBATIM copies of the production definitions
--     recorded in supabase/tests/custom_fields_rls_harness.sql (pg_get_functiondef, 2026-09-22).
--   * public.organizations / profiles / clients with only the columns used here.
--   * A STAND-IN clients SELECT policy (NOT production's): Admin = organization, Agent = assigned,
--     Team Leader = assigned to self or a direct report. The suite proves the review table defers to
--     whatever clients RLS returns; production's real policy is unchanged by the migration.
-- =====================================================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;

-- Supabase's default privileges in `public` (the hazard the migration's REVOKEs must undo).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TABLE auth.users (id uuid PRIMARY KEY);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

CREATE TABLE public.organizations (id uuid PRIMARY KEY, name text NOT NULL);
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id),
  organization_id uuid REFERENCES public.organizations(id),
  role text NOT NULL,
  status text NOT NULL,
  upline_id uuid
);
CREATE TABLE public.clients (
  id uuid PRIMARY KEY,
  organization_id uuid REFERENCES public.organizations(id),
  assigned_agent_id uuid REFERENCES public.profiles(id),
  first_name text NOT NULL DEFAULT ''
);

-- ---- VERBATIM production resolvers (see header) -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_org_id()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.get_user_role()
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::json->'app_metadata'->>'role', '');
$function$;

-- ---- Stand-in RLS (see header) -----------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_select_harness ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid()
         OR organization_id = nullif(current_setting('request.jwt.claims', true)::json->'app_metadata'->>'organization_id', '')::uuid);

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY clients_select_harness ON public.clients FOR SELECT TO authenticated
  USING (organization_id = public.get_org_id() AND (
    public.get_user_role() IN ('Admin', 'Super Admin')
    OR assigned_agent_id = auth.uid()
    OR assigned_agent_id IN (SELECT p.id FROM public.profiles p WHERE p.upline_id = auth.uid())));

REVOKE ALL ON TABLE public.organizations, public.profiles, public.clients FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.profiles, public.clients TO authenticated, service_role;

-- ---- Test helpers (run as the role that calls them) -----------------------------------------------
CREATE SCHEMA dmr_t;
GRANT USAGE ON SCHEMA dmr_t TO anon, authenticated, service_role;

-- JWT claims of a signed-in user (sub, organization, role), as PostgREST sets them.
CREATE FUNCTION dmr_t.claims(p_sub uuid, p_org uuid, p_role text DEFAULT 'Agent') RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', p_sub, 'role', 'authenticated',
                      'app_metadata', json_build_object('organization_id', p_org, 'role', p_role))::text, false);
$$;

-- Run one statement; 'OK' or the SQLSTATE it raised (its effects roll back on error).
CREATE FUNCTION dmr_t.try(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END $$;

CREATE FUNCTION dmr_t.check(p_label text, p_ok boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS: %', p_label;
END $$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA dmr_t TO anon, authenticated, service_role;
