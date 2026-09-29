-- =====================================================================================================
-- Harness for the Group leaderboard appointment-attribution suite (supabase/tests/group_leaderboard_rpc.sql).
-- STATUS: run ONLY on a disposable LOCAL PostgreSQL database (AGENT_RULES invariant #28), through
-- scripts/run_group_leaderboard_tests.sh, which refuses any non-localhost URL.
-- =====================================================================================================
-- Creates the minimum schema public.get_agency_group_leaderboard reads, with the production column names,
-- types and defaults that matter (read-only information_schema check on jncvvsvckxhqgqvkppmj, 2026-09-29).
-- Synthetic data only. RLS is deliberately not replayed: the function is SECURITY DEFINER and the suite
-- asserts its OWN membership check and its unchanged grants.
--
-- The functions under test are NOT written here. The runner extracts them VERBATIM from
-- 20260806000000_baseline_production_schema.sql and applies them after this file:
--   public.get_org_id()
--   public.get_agency_group_leaderboard(uuid, text)  — byte-identical to production (prosrc md5
--     e1f021d557e30ebda92c66264ae92eb2, definition md5 e1283b5b05d295c1d25888485cc08346, read 2026-09-29),
--     with the production ACL {=X, postgres=X, anon=X, authenticated=X, service_role=X}.
-- auth.uid() is the one deliberate stub: it reads the request.jwt.claims GUC exactly as PostgREST sets it.

CREATE SCHEMA IF NOT EXISTS auth;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')  THEN CREATE ROLE service_role NOLOGIN; END IF;
END$$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth   TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(NULLIF(current_setting('request.jwt.claims', true), '')::json ->> 'sub', '')::uuid;
$$;

CREATE TABLE public.organizations (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
);

CREATE TABLE public.profiles (
  id              uuid PRIMARY KEY,
  organization_id uuid REFERENCES public.organizations(id),
  first_name      text NOT NULL DEFAULT '',
  last_name       text NOT NULL DEFAULT '',
  avatar_url      text DEFAULT '',
  role            text NOT NULL DEFAULT 'Agent',
  status          text NOT NULL DEFAULT 'Active'
);

CREATE TABLE public.agency_group_members (
  agency_group_id uuid NOT NULL,
  organization_id uuid,
  status          text NOT NULL DEFAULT 'invited'
);

CREATE TABLE public.company_settings (
  organization_id uuid,
  timezone        text DEFAULT 'America/Chicago'
);

CREATE TABLE public.calls (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id   uuid,
  created_at timestamptz DEFAULT now(),
  duration   integer DEFAULT 0
);

CREATE TABLE public.appointments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  user_id         uuid,
  created_by      uuid,
  status          text NOT NULL DEFAULT 'Scheduled',
  start_time      timestamptz NOT NULL,
  created_at      timestamptz DEFAULT now()
);

CREATE TABLE public.clients (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assigned_agent_id uuid,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Assertion helpers (schema gt): a failure raises, so psql -v ON_ERROR_STOP=1 exits non-zero.
CREATE SCHEMA gt;
CREATE FUNCTION gt.eq(label text, got anyelement, want anyelement) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'ASSERT FAILED [%]: got %, want %', label, got, want;
  END IF;
END $$;
