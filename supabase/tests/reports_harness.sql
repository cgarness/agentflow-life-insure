-- =====================================================================================================
-- Harness for the Reports RPC suite (supabase/tests/reports_rpc.sql).
-- STATUS: run ONLY on a disposable LOCAL PostgreSQL database (AGENT_RULES invariant #28), through
-- scripts/run_reports_rpc_tests.sh, which refuses any non-localhost URL.
-- =====================================================================================================
-- Creates the minimum schema the Reports migration reads, using the production column names, types and
-- the defaults that matter (read-only information_schema check on jncvvsvckxhqgqvkppmj, 2026-09-28).
-- Synthetic data only. RLS policies are deliberately NOT replayed: every Reports RPC is SECURITY
-- DEFINER precisely because it must see rows RLS hides from the caller, and the suite asserts the
-- functions' OWN authorization.
--
-- The functions the migration DEPENDS ON are NOT written here. The runner extracts them VERBATIM from
-- the repository migrations and applies them after this file, so the suite tests the real contract:
--   public.get_org_id()                  — 20260806000000_baseline_production_schema.sql
--   public.rpc_report_* (4 legacy)       — 20260806000000_baseline_production_schema.sql (byte-identical
--                                          to production: prosrc md5 verified 2026-09-28), with the
--                                          production ACL {postgres, anon, authenticated, service_role}
--   private.campaign_actor()             — 20260811200920_campaign_leads_membership_uniqueness_…sql
--   private.resolve_downline_ids(uuid,uuid) — 20260919183544_profile_book_and_team_stats_rpcs.sql
--   private.profile_parse_iso_date(text) — 20260919183544_profile_book_and_team_stats_rpcs.sql (the
--                                          additional-policy date parser the policy migration reuses)
-- auth.uid() is the one deliberate stub: it reads the request.jwt.claims GUC exactly as PostgREST sets it.

CREATE SCHEMA IF NOT EXISTS private;
CREATE SCHEMA IF NOT EXISTS auth;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')  THEN CREATE ROLE service_role NOLOGIN; END IF;
END$$;

-- Production: authenticated has no USAGE on schema private.
REVOKE ALL ON SCHEMA private FROM PUBLIC;
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
  id   uuid PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE public.profiles (
  id              uuid PRIMARY KEY,
  organization_id uuid REFERENCES public.organizations(id),
  first_name      text NOT NULL DEFAULT '',
  last_name       text NOT NULL DEFAULT '',
  email           text NOT NULL DEFAULT '',
  role            text NOT NULL DEFAULT 'Agent',
  status          text NOT NULL DEFAULT 'Active',
  upline_id       uuid,
  is_super_admin  boolean DEFAULT false
);

CREATE TABLE public.role_permissions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  role            text NOT NULL,
  permissions     jsonb NOT NULL,
  CONSTRAINT role_permissions_org_role_unique UNIQUE (organization_id, role)
);

CREATE TABLE public.company_settings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name    text NOT NULL DEFAULT 'Agency',
  timezone        text DEFAULT 'America/Chicago',
  organization_id uuid
);
CREATE UNIQUE INDEX company_settings_org_unique ON public.company_settings (organization_id);

CREATE TABLE public.pipeline_stages (
  id                uuid PRIMARY KEY,
  name              text NOT NULL,
  pipeline_type     text NOT NULL DEFAULT 'lead',
  convert_to_client boolean NOT NULL DEFAULT false,
  organization_id   uuid NOT NULL
);

CREATE TABLE public.dispositions (
  id                    uuid PRIMARY KEY,
  name                  text NOT NULL,
  color                 text NOT NULL DEFAULT '#3B82F6',
  callback_scheduler    boolean NOT NULL DEFAULT false,
  appointment_scheduler boolean NOT NULL DEFAULT false,
  dnc_auto_add          boolean NOT NULL DEFAULT false,
  counts_as_contacted   boolean NOT NULL DEFAULT false,
  pipeline_stage_id     uuid,
  organization_id       uuid NOT NULL
);
CREATE UNIQUE INDEX dispositions_org_lower_name_unique ON public.dispositions (organization_id, lower(name));

CREATE TABLE public.campaigns (
  id              uuid PRIMARY KEY,
  name            text NOT NULL,
  type            text NOT NULL,
  status          text NOT NULL DEFAULT 'Active',
  user_id         uuid,
  organization_id uuid
);

CREATE TABLE public.leads (
  id                uuid PRIMARY KEY,
  first_name        text NOT NULL DEFAULT '',
  last_name         text NOT NULL DEFAULT '',
  phone             text NOT NULL DEFAULT '',
  status            text NOT NULL DEFAULT 'New',
  lead_source       text NOT NULL DEFAULT '',
  assigned_agent_id uuid,
  user_id           uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  organization_id   uuid
);

CREATE TABLE public.campaign_leads (
  id              uuid PRIMARY KEY,
  campaign_id     uuid NOT NULL,
  lead_id         uuid,
  status          text,
  call_attempts   integer DEFAULT 0,
  organization_id uuid
);

CREATE TABLE public.calls (
  id               uuid PRIMARY KEY,
  contact_id       uuid,
  contact_type     text,
  contact_name     text,
  contact_phone    text,
  agent_id         uuid,
  campaign_id      uuid,
  campaign_lead_id uuid,
  direction        text DEFAULT 'outbound',
  duration         integer DEFAULT 0,
  disposition_id   uuid,
  disposition_name text,
  notes            text,
  started_at       timestamptz DEFAULT now(),
  created_at       timestamptz DEFAULT now(),
  status           text,
  lead_id          uuid,
  organization_id  uuid
);

CREATE TABLE public.wins (
  id              uuid PRIMARY KEY,
  agent_id        uuid,
  contact_id      uuid,
  campaign_id     uuid,
  premium_amount  numeric,
  created_at      timestamptz DEFAULT now(),
  organization_id uuid,
  idempotency_key text,
  sold_date       date
);
-- Production: conversion wins are DB-idempotent on the key 'conversion:<lead-id>'.
CREATE UNIQUE INDEX uq_wins_idempotency_key ON public.wins (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Production-shaped clients (baseline 20260806000000 + sold_date from 20260812042319). The defaults are
-- the point: a CSV-imported client lands on policy_type 'Term', premium 0, face 0, blank carrier and
-- number and no sale date — a CLIENT with no policy evidence (AGENT_RULES #34).
CREATE TABLE public.clients (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name        text NOT NULL DEFAULT '',
  last_name         text NOT NULL DEFAULT '',
  policy_type       text NOT NULL DEFAULT 'Term',
  carrier           text DEFAULT '',
  policy_number     text DEFAULT '',
  premium           numeric DEFAULT 0,
  face_amount       numeric DEFAULT 0,
  issue_date        text,
  effective_date    text,
  custom_fields     jsonb,
  lead_id           uuid,
  premium_amount    numeric DEFAULT 0,
  assigned_agent_id uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  sold_date         date,
  organization_id   uuid
);
CREATE UNIQUE INDEX uq_clients_lead_id ON public.clients (lead_id) WHERE lead_id IS NOT NULL;

CREATE TABLE public.appointments (
  id              uuid PRIMARY KEY,
  title           text NOT NULL DEFAULT 'Appointment',
  type            text,
  status          text,
  created_by      uuid,
  user_id         uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  organization_id uuid
);

CREATE TABLE public.dialer_sessions (
  id                uuid PRIMARY KEY,
  agent_id          uuid NOT NULL,
  campaign_id       uuid,
  started_at        timestamptz NOT NULL,
  ended_at          timestamptz,
  last_heartbeat_at timestamptz NOT NULL,
  status            text NOT NULL DEFAULT 'active',
  organization_id   uuid NOT NULL
);
