-- Migration: Set up secure JWT Claims for Multi-Tenant Auth Lock-down
-- Date: 2026-04-02

-- 1. Setter Function: Overrides the JWT via auth.users securely
CREATE OR REPLACE FUNCTION public.set_claim(uid uuid, claim text, value jsonb)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE auth.users
  SET raw_app_meta_data = 
    coalesce(raw_app_meta_data, '{}'::jsonb) || 
    jsonb_build_object(claim, value)
  WHERE id = uid;
  RETURN 'OK';
END;
$$;

-- 2. Trigger Function: Syncs public.profiles -> JWT
CREATE OR REPLACE FUNCTION public.on_profile_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.organization_id IS NOT NULL THEN
    PERFORM public.set_claim(NEW.id, 'organization_id', to_jsonb(NEW.organization_id));
  END IF;
  
  IF NEW.role IS NOT NULL THEN
    PERFORM public.set_claim(NEW.id, 'role', to_jsonb(NEW.role));
  END IF;
  
  RETURN NEW;
END;
$$;

-- 3. Install Trigger
-- Ensure no existing trigger collides
DROP TRIGGER IF EXISTS on_profile_update_trigger ON public.profiles;

CREATE TRIGGER on_profile_update_trigger
AFTER INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.on_profile_update();

-- 4. Fast Helper Functions for RLS execution
CREATE OR REPLACE FUNCTION public.get_org_id() RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::json->'app_metadata'->>'organization_id', '')::uuid;
$$;

CREATE OR REPLACE FUNCTION public.get_user_role() RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::json->'app_metadata'->>'role', '');
$$;
