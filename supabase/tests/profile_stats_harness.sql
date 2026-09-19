-- =====================================================================================================
-- Harness for the Agent/Team Profile aggregate-RPC suite.
-- STATUS: run ONLY on a disposable LOCAL PostgreSQL database (AGENT_RULES invariant #28).
-- =====================================================================================================
-- Creates the minimum schema public.get_profile_book_stats / public.get_profile_team_readiness need,
-- with the SAME column set, types, nullability and defaults as production. Column definitions were
-- read live from information_schema on jncvvsvckxhqgqvkppmj (read-only) on 2026-09-19 — in particular
-- the defaults that make the metric canon load-bearing:
--
--   clients.policy_type  text NOT NULL DEFAULT 'Term'   <- why D-3b evidence-based counting exists
--   clients.premium      numeric     DEFAULT 0          <- why 0 means "not recorded"
--   clients.face_amount  numeric     DEFAULT 0          <- same
--   clients.carrier      text        DEFAULT ''         <- blank, not NULL, is the unset value
--   clients.sold_date    date        NULL               <- a real date: no time, no timezone
--
-- Three production functions the migration DEPENDS ON are replayed here VERBATIM from their live
-- definitions so the suite tests the real contract rather than a convenient stub:
--   public.normalize_us_state(text)   — pg_get_functiondef, jncvvsvckxhqgqvkppmj, 2026-09-19
--   public.get_org_id()               — pg_get_functiondef, same
--   private.campaign_actor()          — 20260811200920_campaign_leads_membership_uniqueness…sql:131
--
-- auth.uid() is the one deliberate stub: it reads the same request.jwt.claims GUC PostgREST sets, so
-- `SET LOCAL request.jwt.claims` in the suite impersonates a caller exactly the way a real request
-- does. RLS policies are deliberately NOT replayed — both functions are SECURITY DEFINER precisely
-- because they must see rows RLS hides from the caller, and the suite asserts their OWN authorization.

CREATE SCHEMA IF NOT EXISTS private;
CREATE SCHEMA IF NOT EXISTS auth;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END$$;

-- ── auth.uid() — reads the PostgREST claims GUC, as in a real request ───────────────────────────
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(NULLIF(current_setting('request.jwt.claims', true), '')::json ->> 'sub', '')::uuid;
$$;

-- ── Tables ─────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.organizations (
  id   uuid PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id              uuid PRIMARY KEY,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  first_name      text NOT NULL DEFAULT '',
  last_name       text NOT NULL DEFAULT '',
  role            text NOT NULL DEFAULT 'Agent',
  status          text NOT NULL DEFAULT 'Active',
  upline_id       uuid,
  npn             text,
  resident_state  text,
  carriers        jsonb DEFAULT '[]'::jsonb,
  licensed_states jsonb DEFAULT '[]'::jsonb,
  is_super_admin  boolean DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.clients (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid,
  assigned_agent_id uuid,
  policy_type       text NOT NULL DEFAULT 'Term'::text,
  carrier           text DEFAULT ''::text,
  policy_number     text DEFAULT ''::text,
  premium           numeric DEFAULT 0,
  premium_amount    numeric DEFAULT 0,   -- present so the suite can prove it is NEVER read
  face_amount       numeric DEFAULT 0,
  issue_date        text,
  effective_date    text,
  sold_date         date,
  custom_fields     jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_state_licenses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        uuid NOT NULL,
  organization_id uuid NOT NULL,
  state           text NOT NULL,
  license_number  text,
  expiration_date date,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- The raw-text unique index production actually has. It is what lets "CA" and "California" coexist
-- for ONE agent, which is exactly why every state measure must go through normalize_us_state().
CREATE UNIQUE INDEX IF NOT EXISTS agent_state_licenses_agent_state_unique
  ON public.agent_state_licenses USING btree (agent_id, state);

CREATE TABLE IF NOT EXISTS public.calls (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  agent_id        uuid,
  direction       text,
  duration        integer,
  created_at      timestamptz,
  started_at      timestamptz
);

-- public.wins exists in the harness ONLY so the suite can prove the RPCs never read it: the suite
-- seeds contradictory wins and asserts not one metric moves.
CREATE TABLE IF NOT EXISTS public.wins (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        uuid,
  contact_id      uuid,
  organization_id uuid,
  policy_type     text DEFAULT ''::text,
  premium_amount  numeric,
  sold_date       date,
  idempotency_key text,
  created_at      timestamptz DEFAULT now()
);

-- ── public.normalize_us_state(text) — VERBATIM from production ─────────────────────────────────
-- Note the contract: blanks and UNRECOGNIZED values (territories, typos, non-US) are returned
-- UNCHANGED — "don't invent". Only the 50 states + DC map.
CREATE OR REPLACE FUNCTION public.normalize_us_state(p_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_trim  text;
  v_upper text;
  v_code  text;
BEGIN
  IF p_raw IS NULL OR btrim(p_raw) = '' THEN
    RETURN p_raw;
  END IF;

  v_trim  := btrim(p_raw);
  v_upper := upper(v_trim);

  IF v_upper IN (
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
    'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
    'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
    'VA','WA','WV','WI','WY','DC'
  ) THEN
    RETURN v_upper;
  END IF;

  v_code := CASE lower(v_trim)
    WHEN 'alabama'              THEN 'AL'
    WHEN 'alaska'               THEN 'AK'
    WHEN 'arizona'              THEN 'AZ'
    WHEN 'arkansas'             THEN 'AR'
    WHEN 'california'           THEN 'CA'
    WHEN 'colorado'             THEN 'CO'
    WHEN 'connecticut'          THEN 'CT'
    WHEN 'delaware'             THEN 'DE'
    WHEN 'florida'              THEN 'FL'
    WHEN 'georgia'              THEN 'GA'
    WHEN 'hawaii'               THEN 'HI'
    WHEN 'idaho'                THEN 'ID'
    WHEN 'illinois'             THEN 'IL'
    WHEN 'indiana'              THEN 'IN'
    WHEN 'iowa'                 THEN 'IA'
    WHEN 'kansas'               THEN 'KS'
    WHEN 'kentucky'             THEN 'KY'
    WHEN 'louisiana'            THEN 'LA'
    WHEN 'maine'                THEN 'ME'
    WHEN 'maryland'             THEN 'MD'
    WHEN 'massachusetts'        THEN 'MA'
    WHEN 'michigan'             THEN 'MI'
    WHEN 'minnesota'            THEN 'MN'
    WHEN 'mississippi'          THEN 'MS'
    WHEN 'missouri'             THEN 'MO'
    WHEN 'montana'              THEN 'MT'
    WHEN 'nebraska'             THEN 'NE'
    WHEN 'nevada'               THEN 'NV'
    WHEN 'new hampshire'        THEN 'NH'
    WHEN 'new jersey'           THEN 'NJ'
    WHEN 'new mexico'           THEN 'NM'
    WHEN 'new york'             THEN 'NY'
    WHEN 'north carolina'       THEN 'NC'
    WHEN 'north dakota'         THEN 'ND'
    WHEN 'ohio'                 THEN 'OH'
    WHEN 'oklahoma'             THEN 'OK'
    WHEN 'oregon'               THEN 'OR'
    WHEN 'pennsylvania'         THEN 'PA'
    WHEN 'rhode island'         THEN 'RI'
    WHEN 'south carolina'       THEN 'SC'
    WHEN 'south dakota'         THEN 'SD'
    WHEN 'tennessee'            THEN 'TN'
    WHEN 'texas'                THEN 'TX'
    WHEN 'utah'                 THEN 'UT'
    WHEN 'vermont'              THEN 'VT'
    WHEN 'virginia'             THEN 'VA'
    WHEN 'washington'           THEN 'WA'
    WHEN 'west virginia'        THEN 'WV'
    WHEN 'wisconsin'            THEN 'WI'
    WHEN 'wyoming'              THEN 'WY'
    WHEN 'district of columbia' THEN 'DC'
    ELSE NULL
  END;

  IF v_code IS NOT NULL THEN
    RETURN v_code;
  END IF;

  RETURN p_raw;
END;
$function$;

-- ── public.get_org_id() — VERBATIM from production ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_org_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid;
BEGIN
  v_org := NULLIF(
    current_setting('request.jwt.claims', true)::json
      ->'app_metadata'->>'organization_id',
    ''
  )::uuid;

  IF v_org IS NOT NULL THEN
    RETURN v_org;
  END IF;

  SELECT organization_id INTO v_org
  FROM public.profiles
  WHERE id = auth.uid();

  RETURN v_org;
END;
$function$;

-- ── private.campaign_actor() — VERBATIM from 20260811200920…:131-167 ───────────────────────────
-- The DB-authoritative actor resolver the profile RPCs delegate to. The suite pins this contract
-- because the profile functions depend on it (documented coupling, migration header section
-- "SECURITY MODEL").
CREATE OR REPLACE FUNCTION private.campaign_actor()
RETURNS TABLE (uid uuid, org_id uuid, actor_role text, is_super boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid := public.get_org_id();
  v_p   RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'no organization context' USING ERRCODE = '42501';
  END IF;

  SELECT p.role, p.organization_id, COALESCE(p.is_super_admin, false) AS isa, p.status
    INTO v_p
    FROM public.profiles p
   WHERE p.id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found' USING ERRCODE = '42501';
  END IF;
  IF v_p.organization_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'organization mismatch' USING ERRCODE = '42501';
  END IF;
  IF v_p.status IS DISTINCT FROM 'Active' THEN
    RAISE EXCEPTION 'profile is not active' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT v_uid, v_org, v_p.role, v_p.isa;
END;
$$;

REVOKE ALL ON FUNCTION private.campaign_actor() FROM PUBLIC, anon, authenticated;

-- ── Helper the suite uses to impersonate a caller exactly as PostgREST does ────────────────────
CREATE OR REPLACE FUNCTION public.test_set_caller(p_uid uuid, p_org uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', p_uid,
      'app_metadata', json_build_object('organization_id', p_org)
    )::text,
    true
  );
END;
$$;

-- ── Anonymous caller: what PostgREST actually sends for a request with no user JWT ─────────────
-- It sets request.jwt.claims to the anon role's claims JSON — a VALID document with no `sub` and no
-- app_metadata. It never sets the GUC to an empty string, and never leaves it unset mid-session, so
-- this is the faithful "unauthenticated" state to test against.
CREATE OR REPLACE FUNCTION public.test_clear_caller()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
END;
$$;
