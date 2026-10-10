-- =====================================================================================================
-- Synthetic LOCAL harness for 20261010172702_platform_admin_registration_notifications.sql (authored as 20261010200000).
-- Mirrors only the production shapes the feature touches: Supabase roles, auth.users + the
-- handle_new_user profile trigger (simplified, same INSERT), organizations with its CHECKs,
-- profiles with ON DELETE CASCADE from auth.users, dispositions, and provision_organization
-- copied verbatim from the baseline. No production data; never run against a hosted project.
-- =====================================================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

CREATE SCHEMA auth;
CREATE SCHEMA private;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  raw_user_meta_data jsonb,
  email_confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  twilio_subaccount_status text DEFAULT 'pending' NOT NULL
    CHECK (twilio_subaccount_status IN ('pending','active','pending_manual','suspended','closed')),
  status text DEFAULT 'active' CHECK (status IN ('active','suspended','archived'))
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL DEFAULT '',
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  organization_id uuid REFERENCES public.organizations(id),
  role text NOT NULL DEFAULT 'Agent' CHECK (role IN ('Agent','Team Leader','Admin','Super Admin')),
  status text NOT NULL DEFAULT 'Active',
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.profiles TO authenticated;

CREATE TABLE public.dispositions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text, color text, is_locked boolean, campaign_action text, dnc_auto_add boolean,
  appointment_scheduler boolean, callback_scheduler boolean,
  organization_id uuid REFERENCES public.organizations(id), sort_order int
);

-- Same INSERT shape as production handle_new_user (metadata parsing simplified).
CREATE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO public.profiles (id, email, first_name, last_name, organization_id, role, status)
  VALUES (NEW.id, NEW.email,
          COALESCE(NULLIF(NEW.raw_user_meta_data->>'first_name', ''), 'User'),
          COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
          NULLIF(NEW.raw_user_meta_data->>'organization_id', '')::uuid,
          COALESCE(NEW.raw_user_meta_data->>'role', 'Agent'), 'Active');
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Verbatim from 20260806000000_baseline_production_schema.sql.
CREATE OR REPLACE FUNCTION "public"."provision_organization"("p_name" "text", "p_slug" "text", "p_owner_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  new_org_id uuid;
  attached   int;
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'Organization name is required';
  END IF;

  INSERT INTO public.organizations (name, slug)
  VALUES (btrim(p_name), p_slug)
  RETURNING id INTO new_org_id;

  INSERT INTO public.dispositions
    (name, color, is_locked, campaign_action, dnc_auto_add, appointment_scheduler, callback_scheduler, organization_id, sort_order)
  VALUES
    ('No Answer',       '#3B82F6', true,  'none',                  false, false, false, new_org_id, 0),
    ('Appointment Set', '#10B981', true,  'remove_from_queue',     false, true,  false, new_org_id, 1),
    ('Call Back',       '#F59E0B', false, 'none',                  false, false, true,  new_org_id, 2),
    ('Not Interested',  '#EF4444', false, 'remove_from_campaign',  false, false, false, new_org_id, 3),
    ('DNC',             '#000000', true,  'remove_from_campaign',  true,  false, false, new_org_id, 4),
    ('Sold',            '#059669', false, 'remove_from_queue',     false, false, false, new_org_id, 5);

  IF p_owner_user_id IS NOT NULL THEN
    UPDATE public.profiles
       SET organization_id = new_org_id,
           role            = 'Admin'
     WHERE id = p_owner_user_id;
    GET DIAGNOSTICS attached = ROW_COUNT;
    IF attached <> 1 THEN
      RAISE EXCEPTION 'Founder profile % not found; rolling back organization', p_owner_user_id;
    END IF;
  END IF;

  RETURN new_org_id;
END;
$$;

-- Pre-existing rows created BEFORE the migration: they must never be backfilled into the queue.
INSERT INTO public.organizations (id, name, slug)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'Existing Agency', 'existing-agency');
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES ('00000000-0000-0000-0000-0000000000b1', 'existing@example.test',
        '{"first_name":"Existing","organization_id":"00000000-0000-0000-0000-0000000000a1"}');
