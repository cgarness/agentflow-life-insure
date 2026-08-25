-- =====================================================================================================
-- Inbound call flow — disposable-localhost harness schema (Inbound Call Flow Rebuild, plan rev 5)
-- =====================================================================================================
-- STATUS: run ONLY on a disposable LOCAL PostgreSQL stack — never production (AGENT_RULES invariant #28).
-- Provides the minimum baseline-faithful surface the four inbound suites need:
--   roles (anon/authenticated/service_role), auth.users + auth.uid(), public.get_org_id(),
--   organizations/profiles/leads/clients/recruits/campaign_leads/phone_numbers/calls (baseline column
--   shapes for every column the inbound functions touch), the live append_call_routed_agents RPC
--   (verbatim from migration 20260819000000), permissive-but-role-real RLS + grants so
--   SET ROLE authenticated exercises expression-index EXECUTE checks (R23/C2), and counting triggers
--   on calls so C1/R6 can assert exactly-once trigger execution.
-- Apply order for a run:  inbound_harness.sql → M1 → M2 → suites (each suite BEGIN…ROLLBACKs itself).

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT (NULLIF(current_setting('request.jwt.claims', true), '')::json ->> 'sub')::uuid
$$;

-- ── Tenant tables (baseline-faithful columns for everything the inbound functions read/write) ────────
CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id),
  organization_id uuid,
  role text DEFAULT 'Agent',
  is_super_admin boolean DEFAULT false,
  first_name text DEFAULT '',
  last_name text DEFAULT '',
  status text DEFAULT 'Active',
  hierarchy_path text,
  twilio_client_identity text
);

-- get_org_id: baseline behavior — JWT claim fast path with profiles fallback.
CREATE OR REPLACE FUNCTION public.get_org_id() RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE v uuid;
BEGIN
  BEGIN
    v := (NULLIF(current_setting('request.jwt.claims', true), '')::json ->> 'org_id')::uuid;
  EXCEPTION WHEN OTHERS THEN v := NULL; END;
  IF v IS NULL THEN
    SELECT p.organization_id INTO v FROM public.profiles p WHERE p.id = auth.uid();
  END IF;
  RETURN v;
END $$;

CREATE TABLE IF NOT EXISTS public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  phone text NOT NULL DEFAULT '',
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  lead_source text,
  status text DEFAULT 'New',
  assigned_agent_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  phone text NOT NULL DEFAULT '',
  beneficiary_phone text DEFAULT '',
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  assigned_agent_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.recruits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  phone text NOT NULL DEFAULT '',
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  assigned_agent_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.campaign_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  campaign_id uuid,
  lead_id uuid,
  phone text DEFAULT '',
  first_name text DEFAULT '',
  last_name text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.phone_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  phone_number text NOT NULL,
  assigned_to uuid,
  is_direct_line boolean NOT NULL DEFAULT false
);

-- calls: baseline columns + routed_agent_ids (production-verified shape, plan §1.6)
CREATE TABLE IF NOT EXISTS public.calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid,
  contact_type text DEFAULT 'lead',
  contact_name text DEFAULT '',
  contact_phone text DEFAULT '',
  agent_id uuid,
  campaign_id uuid,
  campaign_lead_id uuid,
  direction text DEFAULT 'outbound',
  duration integer DEFAULT 0,
  recording_url text,
  disposition_id uuid,
  disposition_name text,
  notes text DEFAULT '',
  outcome text DEFAULT '',
  started_at timestamptz DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz DEFAULT now(),
  status text DEFAULT 'completed',
  caller_id_used text,
  provider_session_id text,
  provider_error_code text,
  shaken_stir text,
  is_missed boolean DEFAULT false,
  organization_id uuid,
  updated_at timestamptz DEFAULT now(),
  twilio_call_sid text,
  lead_id uuid,
  recording_storage_path text,
  recording_duration integer,
  routed_agent_ids uuid[],
  CONSTRAINT calls_contact_type_check CHECK (contact_type = ANY (ARRAY['lead','client','recruit'])),
  CONSTRAINT calls_direction_check CHECK (direction = ANY (ARRAY['outbound','inbound'])),
  CONSTRAINT calls_status_check CHECK (status = ANY (ARRAY['ringing','connected','completed','failed','no-answer']))
);
CREATE INDEX IF NOT EXISTS idx_calls_telnyx_call_control_id ON public.calls (twilio_call_sid);

-- Live append_call_routed_agents — verbatim semantics from applied migration 20260819163413.
CREATE OR REPLACE FUNCTION public.append_call_routed_agents(
  p_call_id uuid, p_org_id uuid, p_agent_ids uuid[]
) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO ''
AS $$
DECLARE v_rows integer := 0;
BEGIN
  IF p_call_id IS NULL OR p_org_id IS NULL OR p_agent_ids IS NULL
     OR cardinality(p_agent_ids) = 0 THEN
    RETURN false;
  END IF;
  UPDATE public.calls c
     SET routed_agent_ids = (
           SELECT array_agg(DISTINCT u.agent_id)
             FROM unnest(COALESCE(c.routed_agent_ids, ARRAY[]::uuid[]) || p_agent_ids) AS u(agent_id)
            WHERE u.agent_id IS NOT NULL
         ),
         updated_at = now()
   WHERE c.id = p_call_id
     AND c.organization_id = p_org_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;
REVOKE ALL ON FUNCTION public.append_call_routed_agents(uuid, uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.append_call_routed_agents(uuid, uuid, uuid[]) TO service_role;

-- ── Grants + role-real RLS so SET ROLE authenticated performs true index-maintenance writes (C2) ─────
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recruits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
-- Harness policies: writes are role-gated TO authenticated (mirrors prod's TO authenticated posture —
-- anon can never reach index maintenance), permissive within the role for test simplicity.
DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['leads','clients','recruits','calls'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS harness_all ON public.%I', t);
    EXECUTE format('CREATE POLICY harness_all ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- ── Counting triggers: prove exactly-once INSERT-trigger and zero duplicate UPDATE-trigger firing ────
CREATE TABLE IF NOT EXISTS public.harness_trigger_counts (
  k text PRIMARY KEY, n integer NOT NULL DEFAULT 0
);
INSERT INTO public.harness_trigger_counts (k, n) VALUES ('calls_insert', 0), ('calls_update', 0)
ON CONFLICT (k) DO NOTHING;
GRANT SELECT, UPDATE ON public.harness_trigger_counts TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.harness_count_calls_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.harness_trigger_counts SET n = n + 1 WHERE k = 'calls_insert';
    RETURN NEW;
  END IF;
  UPDATE public.harness_trigger_counts SET n = n + 1 WHERE k = 'calls_update';
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS harness_calls_insert_count ON public.calls;
CREATE TRIGGER harness_calls_insert_count AFTER INSERT ON public.calls
  FOR EACH ROW EXECUTE FUNCTION public.harness_count_calls_trigger();
DROP TRIGGER IF EXISTS harness_calls_update_count ON public.calls;
CREATE TRIGGER harness_calls_update_count AFTER UPDATE ON public.calls
  FOR EACH ROW EXECUTE FUNCTION public.harness_count_calls_trigger();
