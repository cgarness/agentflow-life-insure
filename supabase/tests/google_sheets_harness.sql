-- =====================================================================================================
-- Synthetic LOCAL harness for 20261013120000_google_sheets_import_foundation.sql.
-- Mirrors only the production shapes the feature touches (read-only MCP inspection, 2026-10-13):
-- Supabase roles + default privileges, auth.uid()/get_org_id(), organizations, profiles, role_permissions,
-- leads with its production triggers (sync_leads_user_id, workflow_on_lead_created and
-- notify_lead_assignments copied verbatim; the workflow dispatcher is stubbed to a counting table),
-- contact_management_settings, pipeline_stages, lead_sources, custom_fields, workflows, dnc_list,
-- a Vault stand-in (skipped where the real supabase_vault exists, e.g. the supabase/postgres image used by
-- scripts/run_google_sheets_cron_check.sh), and the exact live _contacts_permission_default preimage
-- (MD5-verified by the migration).
-- No production data; never run against a hosted project (AGENT_RULES invariant #28).
-- =====================================================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD 'authenticator';
  END IF;
END $$;
GRANT anon, authenticated, service_role TO authenticator;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS private;
CREATE SCHEMA IF NOT EXISTS vault;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
-- Supabase grants broad defaults on public; the migration must revoke what it does not intend.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid
$$;

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text DEFAULT 'active' CHECK (status IN ('active','suspended','archived'))
);
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  organization_id uuid REFERENCES public.organizations(id),
  role text NOT NULL DEFAULT 'Agent' CHECK (role IN ('Agent','Team Leader','Admin','Super Admin')),
  status text NOT NULL DEFAULT 'Active',
  is_super_admin boolean DEFAULT false
);

-- Verbatim production get_org_id().
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

CREATE TABLE public.role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  role text NOT NULL,
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Exact live preimage (MD5 a199d5ddfb9a56070aeb7706d3e9a4b8 is asserted by the migration).
CREATE OR REPLACE FUNCTION public._contacts_permission_default(p_role text, p_key text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (SELECT CASE p_role WHEN 'Agent' THEN d.agent WHEN 'Team Leader' THEN d.team_leader ELSE false END
     FROM (VALUES
       ('contacts.leads.view_assigned',   true,  true),
       ('contacts.leads.view_unassigned', false, true),
       ('contacts.leads.view_all',        false, false),
       ('contacts.leads.create',          true,  true),
       ('contacts.leads.edit',            true,  true),
       ('contacts.leads.delete',          false, false),
       ('contacts.leads.import',          false, true),
       ('contacts.leads.undo_own_import', false, true),
       ('contacts.leads.undo_team_import',false, true),
       ('contacts.leads.assign',          false, true),
       ('contacts.leads.bulk_assign',     false, true),
       ('contacts.leads.bulk_status',     true,  true),
       ('contacts.leads.update_status',   true,  true),
       ('contacts.leads.add_to_campaign', false, true),
       ('contacts.clients.view',          true,  true),
       ('contacts.clients.edit',          true,  true),
       ('contacts.clients.delete',        false, false),
       ('contacts.recruits.view',         true,  true),
       ('contacts.recruits.create',       true,  true),
       ('contacts.recruits.edit',         true,  true),
       ('contacts.recruits.delete',       false, false),
       ('contacts.notes.manage',          true,  true),
       ('contacts.tasks.manage',          true,  true),
       ('contacts.appointments.manage',   true,  true),
       ('contacts.messages.manage',       true,  true)
     ) AS d(key, agent, team_leader)
     WHERE d.key = p_key),
    false
  );
$function$
;
REVOKE ALL ON FUNCTION public._contacts_permission_default(text, text) FROM PUBLIC, anon, authenticated, service_role;

-- Verbatim production normalize_us_state / phone_last10.
CREATE OR REPLACE FUNCTION public.normalize_us_state(p_raw text)
 RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE v_trim text; v_upper text; v_code text;
BEGIN
  IF p_raw IS NULL OR btrim(p_raw) = '' THEN RETURN p_raw; END IF;
  v_trim := btrim(p_raw); v_upper := upper(v_trim);
  IF v_upper IN ('AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
    'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
    'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
    'VA','WA','WV','WI','WY','DC') THEN RETURN v_upper; END IF;
  v_code := CASE lower(v_trim) WHEN 'california' THEN 'CA' WHEN 'texas' THEN 'TX' WHEN 'new york' THEN 'NY'
    WHEN 'florida' THEN 'FL' WHEN 'nevada' THEN 'NV' ELSE NULL END;  -- subset sufficient for fixtures
  IF v_code IS NOT NULL THEN RETURN v_code; END IF;
  RETURN p_raw;
END;
$function$;
CREATE OR REPLACE FUNCTION public.phone_last10(p text)
 RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
AS $function$
  SELECT CASE WHEN pg_catalog.length(d.digits) >= 10 THEN pg_catalog.right(d.digits, 10) END
    FROM (SELECT pg_catalog.regexp_replace(p, '[^0-9]', '', 'g') AS digits) AS d
$function$;

CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL DEFAULT '', last_name text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '', email text NOT NULL DEFAULT '', state text NOT NULL DEFAULT '',
  status text DEFAULT 'New', lead_source text DEFAULT '', lead_score integer DEFAULT 5, age integer,
  date_of_birth text, best_time_to_call text, notes text, assigned_agent_id uuid, custom_fields jsonb,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  organization_id uuid, user_id uuid, imported_by_user_id uuid
);
CREATE INDEX idx_leads_org_phone_last10 ON public.leads (organization_id, public.phone_last10(phone));

CREATE TABLE public.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid NOT NULL, type text NOT NULL DEFAULT 'system',
  title text NOT NULL, body text NOT NULL, read boolean NOT NULL DEFAULT false, action_url text, action_label text,
  metadata jsonb DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), organization_id uuid,
  event_key text NOT NULL DEFAULT (gen_random_uuid())::text, dismissed_at timestamptz
);

-- Test-only stand-in for private.workflow_dispatch_event: records each dispatch instead of pg_net.
CREATE TABLE private.test_workflow_dispatches (
  id bigserial PRIMARY KEY, org_id uuid, trigger_type text, contact_id uuid, metadata jsonb, at timestamptz DEFAULT now()
);
CREATE FUNCTION private.workflow_dispatch_event(p_org_id uuid, p_trigger_type text, p_trigger_key text,
  p_contact_id uuid, p_contact_type text DEFAULT 'lead', p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO private.test_workflow_dispatches (org_id, trigger_type, contact_id, metadata)
  VALUES (p_org_id, p_trigger_type, p_contact_id, p_metadata);
END $$;

-- Verbatim production lead triggers.
CREATE OR REPLACE FUNCTION public.sync_leads_user_id()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.assigned_agent_id IS NOT NULL THEN
    NEW.user_id := NEW.assigned_agent_id;
  END IF;
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.workflow_on_lead_created()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  BEGIN
    PERFORM private.workflow_dispatch_event(
      NEW.organization_id,
      'lead_created',
      NULL,
      NEW.id,
      'lead',
      jsonb_build_object('source', NEW.lead_source)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'workflow_on_lead_created dispatch failed (lead %): %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.notify_lead_assignments()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  r record;
BEGIN
  BEGIN
    IF TG_OP = 'INSERT' THEN
      FOR r IN
        SELECT n.assigned_agent_id AS agent_id, n.organization_id AS org_id, count(*) AS cnt,
               (min(n.id::text))::uuid AS single_lead_id,
               min(btrim(COALESCE(n.first_name, '') || ' ' || COALESCE(n.last_name, ''))) AS single_lead_name
          FROM new_rows n
         WHERE n.assigned_agent_id IS NOT NULL
           AND n.organization_id IS NOT NULL
           AND n.assigned_agent_id IS DISTINCT FROM auth.uid()
           AND (n.imported_by_user_id IS NULL OR n.assigned_agent_id <> n.imported_by_user_id)
         GROUP BY n.assigned_agent_id, n.organization_id
      LOOP
        INSERT INTO public.notifications (user_id, type, title, body, metadata, organization_id)
        VALUES (r.agent_id, 'lead_claimed', 'New Lead Assigned', 'x',
                CASE WHEN r.cnt = 1 THEN jsonb_build_object('lead_id', r.single_lead_id)
                     ELSE jsonb_build_object('count', r.cnt) END, r.org_id);
      END LOOP;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_lead_assignments skipped (lead write unaffected): %', SQLERRM;
  END;
  RETURN NULL;
END;
$function$;
CREATE TRIGGER tr_sync_leads_user_id BEFORE INSERT OR UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.sync_leads_user_id();
CREATE TRIGGER trg_workflow_lead_created AFTER INSERT ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.workflow_on_lead_created();
CREATE TRIGGER trg_notify_lead_assignments_ins AFTER INSERT ON public.leads
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.notify_lead_assignments();

CREATE TABLE public.contact_management_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid UNIQUE,
  duplicate_detection_rule text, duplicate_detection_scope text, manual_action text, csv_action text
);
CREATE TABLE public.pipeline_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, pipeline_type text NOT NULL DEFAULT 'lead',
  is_default boolean NOT NULL DEFAULT false, sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), organization_id uuid NOT NULL
);
CREATE TABLE public.lead_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, name text NOT NULL,
  active boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 0
);
CREATE TABLE public.custom_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, name text NOT NULL, type text NOT NULL DEFAULT 'Text',
  applies_to jsonb NOT NULL DEFAULT '[]', active boolean NOT NULL DEFAULT true, created_by uuid,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE public.workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, name text NOT NULL,
  status text NOT NULL DEFAULT 'draft', trigger_type text NOT NULL
);
CREATE TABLE public.dnc_list (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), phone_number text, organization_id uuid NOT NULL
);

-- Vault stand-in with the supabase_vault 0.3.1 call signatures used by the migration (only when no real Vault).
DO $vault$
BEGIN
  IF to_regclass('vault.secrets') IS NOT NULL THEN RETURN; END IF;
  EXECUTE $s$CREATE TABLE vault.secrets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE, description text DEFAULT '',
    secret text NOT NULL, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())$s$;
  EXECUTE $s$CREATE FUNCTION vault.create_secret(new_secret text, new_name text DEFAULT NULL, new_description text DEFAULT '',
    new_key_id uuid DEFAULT NULL) RETURNS uuid LANGUAGE sql AS $f$
    INSERT INTO vault.secrets (secret, name, description) VALUES (new_secret, new_name, new_description) RETURNING id
  $f$$s$;
  EXECUTE $s$CREATE FUNCTION vault.update_secret(secret_id uuid, new_secret text DEFAULT NULL, new_name text DEFAULT NULL,
    new_description text DEFAULT NULL, new_key_id uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS $f$
    UPDATE vault.secrets SET secret = COALESCE(new_secret, secret), name = COALESCE(new_name, name),
           description = COALESCE(new_description, description), updated_at = now() WHERE id = secret_id
  $f$$s$;
  EXECUTE $s$CREATE VIEW vault.decrypted_secrets AS SELECT id, name, description, secret AS decrypted_secret FROM vault.secrets$s$;
END $vault$;
REVOKE ALL ON SCHEMA vault FROM PUBLIC;
