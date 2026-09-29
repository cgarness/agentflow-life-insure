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

-- Every production column (baseline 20260806000000), so row width — and therefore scan cost — is realistic.
CREATE TABLE public.appointments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                   text NOT NULL DEFAULT '',
  contact_name            text,
  contact_id              uuid,
  type                    text NOT NULL DEFAULT 'Sales Call',
  status                  text NOT NULL DEFAULT 'Scheduled',
  start_time              timestamptz NOT NULL,
  end_time                timestamptz,
  notes                   text,
  created_by              uuid,
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now(),
  user_id                 uuid,
  external_event_id       text,
  external_provider       text,
  external_last_synced_at timestamptz,
  sync_source             text NOT NULL DEFAULT 'internal',
  organization_id         uuid NOT NULL
);

CREATE TABLE public.clients (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assigned_agent_id uuid,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- The production indexes these reads can use (read-only pg_indexes check, 2026-09-29; baseline definitions).
CREATE INDEX appointments_org_start_time_idx  ON public.appointments USING btree (organization_id, start_time);
CREATE INDEX appointments_user_start_time_idx ON public.appointments USING btree (user_id, start_time);
CREATE INDEX idx_appointments_organization_id ON public.appointments USING btree (organization_id);
CREATE INDEX idx_appointments_user_id         ON public.appointments USING btree (user_id);
CREATE INDEX idx_calls_agent_id               ON public.calls USING btree (agent_id);
CREATE INDEX idx_clients_assigned_agent_id    ON public.clients USING btree (assigned_agent_id);
CREATE INDEX idx_profiles_organization_id     ON public.profiles USING btree (organization_id);
CREATE INDEX idx_agency_group_members_group   ON public.agency_group_members USING btree (agency_group_id);
CREATE UNIQUE INDEX idx_agency_group_members_one_active_group ON public.agency_group_members USING btree (organization_id)
  WHERE status = ANY (ARRAY['active'::text, 'invited'::text]);

-- Assertion helpers (schema gt): a failure raises, so psql -v ON_ERROR_STOP=1 exits non-zero. They run as the
-- CALLING role (SECURITY INVOKER), so an access check made through them is the caller's own.
CREATE SCHEMA gt;
GRANT USAGE ON SCHEMA gt TO anon, authenticated;
CREATE FUNCTION gt.eq(label text, got anyelement, want anyelement) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'ASSERT FAILED [%]: got %, want %', label, got, want;
  END IF;
END $$;

-- The group board's roster (first names, alphabetical) for the current caller.
CREATE FUNCTION gt.roster(p_period text DEFAULT 'month') RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  RETURN (SELECT string_agg(b.agent_first_name, ',' ORDER BY b.agent_first_name)
            FROM public.get_agency_group_leaderboard('99999999-0000-4000-8000-000000000001', p_period) b);
END $$;

-- The current caller must be refused by the membership check (and by nothing else).
CREATE FUNCTION gt.expect_denied(label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM * FROM public.get_agency_group_leaderboard('99999999-0000-4000-8000-000000000001', 'month');
  RAISE EXCEPTION 'ASSERT FAILED [%]: the group board was returned', label;
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE 'Access denied%' THEN RAISE; END IF;
END $$;

-- Access-differential probe: the outcome for the current caller and period, with every column EXCEPT
-- appointments_set (the one metric the repair changes by design) fingerprinted.
CREATE FUNCTION gt.probe(label text, p_period text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE n int; sig text;
BEGIN
  SELECT count(*), md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s|%s|%s|%s', b.organization_id, b.organization_name,
           b.agent_id, b.agent_first_name, b.agent_last_name, b.agent_avatar_url, b.calls_made, b.policies_sold,
           b.talk_time_seconds), ';' ORDER BY b.agent_id), ''))
    INTO n, sig
    FROM public.get_agency_group_leaderboard('99999999-0000-4000-8000-000000000001', p_period) b;
  RAISE NOTICE 'MATRIX % | ok | % rows | %', label, n, sig;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'MATRIX % | % | %', label, SQLSTATE, SQLERRM;
END $$;
