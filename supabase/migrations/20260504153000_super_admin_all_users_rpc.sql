-- =============================================================
-- Super-admin: cross-tenant user listing.
-- Adds public.super_admin_all_users() to list all profiles with
-- their organization names, restricted to super admins.
-- =============================================================

CREATE OR REPLACE FUNCTION public.super_admin_all_users()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'first_name', p.first_name,
      'last_name', p.last_name,
      'email', p.email,
      'role', p.role,
      'status', p.status,
      'organization_id', p.organization_id,
      'organization_name', o.name,
      'agency_display_name', COALESCE(NULLIF(trim(cs.company_name), ''), NULLIF(trim(o.name::text), ''), 'Agency'),
      'created_at', p.created_at
    )
    ORDER BY p.created_at DESC
  )
  INTO v
  FROM public.profiles p
  LEFT JOIN public.organizations o ON p.organization_id = o.id
  LEFT JOIN public.company_settings cs ON cs.organization_id = o.id;

  RETURN COALESCE(v, '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.super_admin_all_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.super_admin_all_users() TO authenticated;

COMMENT ON FUNCTION public.super_admin_all_users() IS
  'Super admin only — list all users across all organizations for platform management.';

-- ── Super admin: cross-tenant user update -------------------------------------
CREATE OR REPLACE FUNCTION public.super_admin_update_user(
  p_user_id uuid,
  p_role text DEFAULT NULL,
  p_status text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles
  SET
    role = COALESCE(p_role, role),
    status = COALESCE(p_status, status),
    updated_at = now()
  WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.super_admin_update_user(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.super_admin_update_user(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.super_admin_update_user(uuid, text, text) IS
  'Super admin only — update any user role or status across organizations.';
