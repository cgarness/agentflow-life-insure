-- Migration: Control Center v2 Security Hardening
-- Purpose: Pin search_path on public.analyze_system_db() and restrict EXECUTE permissions.

-- 1. Re-create the function with pinned search_path
CREATE OR REPLACE FUNCTION public.analyze_system_db()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
  result jsonb;
  v_tables jsonb;
  v_rls_disabled jsonb;
  v_rls_no_policy jsonb;
  v_rls_always_true jsonb;
  v_sec_def_public jsonb;
  v_sec_def_authenticated jsonb;
  v_mutable_search_path jsonb;
  v_public_buckets jsonb;
  v_public_extensions jsonb;
  v_system_status jsonb;
BEGIN
  -- Check platform_admin
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Access denied. Platform Admin only.';
  END IF;

  -- 1. List of public tables
  SELECT jsonb_agg(tablename) INTO v_tables
  FROM pg_tables WHERE schemaname = 'public';

  -- 2. RLS Disabled in Public
  SELECT jsonb_agg(tablename) INTO v_rls_disabled
  FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = false;

  -- 3. RLS Enabled No Policy
  SELECT jsonb_agg(t.tablename) INTO v_rls_no_policy
  FROM pg_tables t
  WHERE t.schemaname = 'public'
    AND t.rowsecurity = true
    AND NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = t.tablename
    );

  -- 4. RLS Policy Always True (open to public or authenticated)
  SELECT jsonb_agg(jsonb_build_object('table', tablename, 'policy', policyname)) INTO v_rls_always_true
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (qual = 'true' OR with_check = 'true')
    AND roles && ARRAY['public'::name, 'authenticated'::name];

  -- 5. Public Can Execute SECURITY DEFINER Function
  SELECT jsonb_agg(p.proname) INTO v_sec_def_public
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.prosecdef = true
    AND has_function_privilege('public', p.oid, 'execute');

  -- 6. Signed-In Users Can Execute SECURITY DEFINER Function
  SELECT jsonb_agg(p.proname) INTO v_sec_def_authenticated
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.prosecdef = true
    AND has_function_privilege('authenticated', p.oid, 'execute');

  -- 7. Function Search Path Mutable
  SELECT jsonb_agg(p.proname) INTO v_mutable_search_path
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.prosecdef = true
    AND (p.proconfig IS NULL OR NOT (p.proconfig::text LIKE '%search_path=%'));

  -- 8. Public Bucket Allows Listing (using public = true as proxy)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
    EXECUTE 'SELECT jsonb_agg(name) FROM storage.buckets WHERE public = true' INTO v_public_buckets;
  ELSE
    v_public_buckets := '[]'::jsonb;
  END IF;

  -- 9. Extension in Public
  SELECT jsonb_agg(extname) INTO v_public_extensions
  FROM pg_extension e
  JOIN pg_namespace n ON e.extnamespace = n.oid
  WHERE n.nspname = 'public';

  -- 10. Existing public.system_status
  SELECT jsonb_agg(jsonb_build_object(
    'component_name', component_name,
    'status', status,
    'description', description,
    'notes', notes
  )) INTO v_system_status
  FROM public.system_status;

  -- Construct final JSON
  result := jsonb_build_object(
    'tables', COALESCE(v_tables, '[]'::jsonb),
    'rls_disabled', COALESCE(v_rls_disabled, '[]'::jsonb),
    'rls_no_policy', COALESCE(v_rls_no_policy, '[]'::jsonb),
    'rls_always_true', COALESCE(v_rls_always_true, '[]'::jsonb),
    'sec_def_public', COALESCE(v_sec_def_public, '[]'::jsonb),
    'sec_def_authenticated', COALESCE(v_sec_def_authenticated, '[]'::jsonb),
    'mutable_search_path', COALESCE(v_mutable_search_path, '[]'::jsonb),
    'public_buckets', COALESCE(v_public_buckets, '[]'::jsonb),
    'public_extensions', COALESCE(v_public_extensions, '[]'::jsonb),
    'system_status', COALESCE(v_system_status, '[]'::jsonb)
  );

  RETURN result;
END;
$$;

-- 2. Restrict execute permissions
REVOKE ALL ON FUNCTION public.analyze_system_db() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.analyze_system_db() TO authenticated;

NOTIFY pgrst, 'reload schema';
