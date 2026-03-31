-- =============================================================
-- Migration 001: JWT Custom Claims Auth Hook
-- Purpose: Inject org_id, user_role, and is_super_admin into
--          every JWT access token for zero-lookup RLS.
-- =============================================================

-- 1. Helper: Extract org_id from the signed JWT (used in RLS policies)
CREATE OR REPLACE FUNCTION public.get_org_id()
RETURNS UUID
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(
    current_setting('request.jwt.claims', true)::json->>'org_id', ''
  )::UUID;
$$;

-- 2. Helper: Extract role from the signed JWT (used in RLS policies)
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    current_setting('request.jwt.claims', true)::json->>'user_role', 'Agent'
  );
$$;

-- 3. Helper: Check if caller is a super admin via JWT
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    (current_setting('request.jwt.claims', true)::json->>'is_super_admin')::BOOLEAN,
    false
  );
$$;

-- 4. The Auth Hook function (called by Supabase on every token mint/refresh)
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claims JSONB;
  user_org_id UUID;
  user_role TEXT;
  user_is_super BOOLEAN;
BEGIN
  -- Extract current claims from the event
  claims := event->'claims';

  -- Fetch the user's org, role, and super admin status from profiles
  SELECT organization_id, role, COALESCE(is_super_admin, false)
  INTO user_org_id, user_role, user_is_super
  FROM public.profiles
  WHERE id = (event->>'user_id')::UUID;

  -- Inject custom claims into the JWT
  claims := jsonb_set(claims, '{org_id}', COALESCE(to_jsonb(user_org_id), 'null'::jsonb));
  claims := jsonb_set(claims, '{user_role}', COALESCE(to_jsonb(user_role), '"Agent"'::jsonb));
  claims := jsonb_set(claims, '{is_super_admin}', to_jsonb(COALESCE(user_is_super, false)));

  -- Return modified event with the enriched claims
  event := jsonb_set(event, '{claims}', claims);
  RETURN event;
END;
$$;

-- 5. Grant execution to supabase_auth_admin (required for Auth Hooks)
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;

-- 6. Ensure supabase_auth_admin can read profiles for the lookup
REVOKE ALL ON public.profiles FROM supabase_auth_admin;
GRANT SELECT ON public.profiles TO supabase_auth_admin;

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
