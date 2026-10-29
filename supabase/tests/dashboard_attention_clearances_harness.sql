-- =====================================================================================================
-- Harness for the Dashboard attention clearance suite (G3 package).
-- STATUS: run ONLY on a disposable LOCAL PostgreSQL database (AGENT_RULES invariant #28), through
-- scripts/run_dashboard_attention_tests.sh. Never against a hosted project.
--
-- Builds the minimum the migration depends on, with production's semantics where they matter:
--   * Supabase roles (anon / authenticated / service_role BYPASSRLS) and Supabase's DEFAULT PRIVILEGES
--     (ALL on new public tables and functions to anon/authenticated/service_role) — so the suite proves
--     the migration's REVOKEs, not a clean-room default.
--   * auth.users + auth.uid() (the JWT `sub`), schema `private`.
--   * public.get_org_id() and public.get_user_role() — VERBATIM copies of the production definitions
--     (as in supabase/tests/dashboard_milestone_reviews_harness.sql).
--   * public.calls / campaign_leads / campaigns / appointments / profiles with the columns used here, and
--     SELECT policies copied from production's pg_policies (2026-10-29): "Calls Hierarchical Select",
--     "Calls Agency Group Peer Read", campaign_leads_select, appointments_select. Their helper functions
--     (is_ancestor_of, super_admin_own_org, is_super_admin, is_agency_group_peer_organization) are
--     STAND-INS with the same meaning for this fixture.
--   * Permissive UPDATE/DELETE policies + grants on the source tables, as production has, so a defect that
--     wrote a source row would SUCCEED here and be caught by the write audit (dac_t.source_writes).
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
  upline_id uuid,
  team_id uuid
);
CREATE TABLE public.campaigns (
  id uuid PRIMARY KEY,
  organization_id uuid REFERENCES public.organizations(id),
  type text NOT NULL,
  user_id uuid,
  assigned_agent_ids jsonb NOT NULL DEFAULT '[]'
);
CREATE TABLE public.campaign_leads (
  id uuid PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id),
  organization_id uuid REFERENCES public.organizations(id),
  lead_id uuid,
  user_id uuid,
  claimed_by uuid,
  status text,
  callback_due_at timestamptz,
  scheduled_callback_at timestamptz,
  callback_agent_id uuid,
  call_attempts integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.calls (
  id uuid PRIMARY KEY,
  organization_id uuid REFERENCES public.organizations(id),
  agent_id uuid,
  direction text,
  is_missed boolean,
  missed_for_agent_id uuid,
  missed_recipient_ids uuid[] NOT NULL DEFAULT '{}',
  routed_agent_ids uuid[],
  duration integer,
  status text,
  disposition_name text,
  voicemail_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.appointments (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  user_id uuid,
  created_by uuid,
  title text NOT NULL DEFAULT 'Callback',
  type text NOT NULL,
  status text NOT NULL,
  start_time timestamptz NOT NULL,
  updated_at timestamptz DEFAULT now()
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

-- ---- Stand-in helpers (same meaning as production for this fixture) --------------------------------
CREATE TABLE public.harness_agency_group_peers (viewer_org uuid NOT NULL, peer_org uuid NOT NULL);

CREATE FUNCTION public.super_admin_own_org(p_org uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.is_ancestor_of(p_ancestor uuid, p_descendant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE up(id, upline_id) AS (
    SELECT p.id, p.upline_id FROM public.profiles p WHERE p.id = p_descendant
    UNION ALL
    SELECT p.id, p.upline_id FROM public.profiles p JOIN up ON p.id = up.upline_id
  )
  SELECT EXISTS (SELECT 1 FROM up WHERE up.upline_id = p_ancestor)
$$;
CREATE FUNCTION public.is_agency_group_peer_organization(p_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.harness_agency_group_peers g
                 WHERE g.viewer_org = public.get_org_id() AND g.peer_org = p_org)
$$;

-- ---- Production SELECT policies (copied from pg_policies, 2026-10-29) ----------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_select_harness ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid()
         OR organization_id = nullif(current_setting('request.jwt.claims', true)::json->'app_metadata'->>'organization_id', '')::uuid);

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY campaigns_select_harness ON public.campaigns FOR SELECT TO authenticated USING (true);

ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Calls Hierarchical Select" ON public.calls FOR SELECT TO authenticated
  USING ((agent_id = auth.uid()) OR super_admin_own_org(organization_id)
    OR ((get_user_role() = 'Admin'::text) AND (organization_id = get_org_id()))
    OR ((get_user_role() = ANY (ARRAY['Team Leader'::text, 'Team Lead'::text])) AND (organization_id = get_org_id())
        AND (agent_id IS NOT NULL) AND is_ancestor_of(auth.uid(), agent_id))
    OR ((get_org_id() IS NOT NULL) AND (organization_id = get_org_id()) AND (direction = 'inbound'::text) AND (agent_id IS NULL)));
CREATE POLICY "Calls Agency Group Peer Read" ON public.calls FOR SELECT TO authenticated
  USING (is_agency_group_peer_organization(organization_id));

ALTER TABLE public.campaign_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY campaign_leads_select ON public.campaign_leads FOR SELECT TO authenticated
  USING (super_admin_own_org(organization_id) OR ((organization_id = get_org_id()) AND (
    (get_user_role() = ANY (ARRAY['Admin'::text, 'Team Leader'::text, 'Team Lead'::text]))
    OR ((get_user_role() = 'Agent'::text) AND (
      (EXISTS (SELECT 1 FROM campaigns c WHERE c.id = campaign_leads.campaign_id AND c.organization_id = get_org_id()
               AND upper(TRIM(BOTH FROM c.type)) = ANY (ARRAY['OPEN POOL'::text, 'OPEN'::text])))
      OR (EXISTS (SELECT 1 FROM campaigns c WHERE c.id = campaign_leads.campaign_id AND c.organization_id = get_org_id()
               AND upper(TRIM(BOTH FROM c.type)) = 'TEAM'::text
               AND (auth.uid())::text = ANY (ARRAY(SELECT jsonb_array_elements_text(c.assigned_agent_ids)))))
      OR ((EXISTS (SELECT 1 FROM campaigns c WHERE c.id = campaign_leads.campaign_id AND c.type = 'Personal'::text
               AND c.organization_id = get_org_id()))
          AND ((claimed_by = auth.uid()) OR (user_id = auth.uid()))))))));

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY appointments_select ON public.appointments FOR SELECT TO authenticated
  USING ((organization_id = get_org_id()) AND ((user_id = auth.uid()) OR (created_by = auth.uid())
    OR (get_user_role() = 'Admin'::text) OR is_super_admin()
    OR (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'Team Leader'::text AND p.team_id IS NOT NULL
               AND appointments.user_id IN (SELECT profiles.id FROM profiles WHERE profiles.team_id = p.team_id)))));

-- Writable sources (as production): a defect that wrote one would succeed, then fail the write audit.
CREATE POLICY calls_write_harness ON public.calls FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY campaign_leads_write_harness ON public.campaign_leads FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY appointments_write_harness ON public.appointments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public.organizations, public.profiles, public.campaigns, public.campaign_leads, public.calls,
  public.appointments, public.harness_agency_group_peers FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.profiles, public.campaigns, public.campaign_leads, public.calls, public.appointments
  TO authenticated, service_role;
GRANT UPDATE, DELETE ON TABLE public.campaign_leads, public.calls, public.appointments TO authenticated;

-- ---- Test helpers (run as the role that calls them) -----------------------------------------------
CREATE SCHEMA dac_t;
GRANT USAGE ON SCHEMA dac_t TO anon, authenticated, service_role;

-- Every INSERT / UPDATE / DELETE on a source table after the fixture is armed (proves Clear never writes one).
CREATE TABLE dac_t.source_writes (tbl text NOT NULL, op text NOT NULL, at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE dac_t.armed (on_ boolean NOT NULL);
INSERT INTO dac_t.armed VALUES (false);
GRANT SELECT, INSERT ON dac_t.source_writes TO authenticated, service_role;
GRANT SELECT ON dac_t.armed TO authenticated, service_role;
CREATE FUNCTION dac_t.audit_source_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF (SELECT on_ FROM dac_t.armed) THEN
    INSERT INTO dac_t.source_writes (tbl, op) VALUES (TG_TABLE_NAME, TG_OP);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER audit_calls AFTER INSERT OR UPDATE OR DELETE ON public.calls
  FOR EACH ROW EXECUTE FUNCTION dac_t.audit_source_write();
CREATE TRIGGER audit_campaign_leads AFTER INSERT OR UPDATE OR DELETE ON public.campaign_leads
  FOR EACH ROW EXECUTE FUNCTION dac_t.audit_source_write();
CREATE TRIGGER audit_appointments AFTER INSERT OR UPDATE OR DELETE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION dac_t.audit_source_write();

-- JWT claims of a signed-in user (sub, organization, role), as PostgREST sets them.
CREATE FUNCTION dac_t.claims(p_sub uuid, p_org uuid, p_role text DEFAULT 'Agent') RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', p_sub, 'role', 'authenticated',
                      'app_metadata', json_build_object('organization_id', p_org, 'role', p_role))::text, false);
$$;

-- Run one statement; 'OK' or the SQLSTATE it raised (its effects roll back on error).
CREATE FUNCTION dac_t.try(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END $$;

CREATE FUNCTION dac_t.check(p_label text, p_ok boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS: %', p_label;
END $$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA dac_t TO anon, authenticated, service_role;
