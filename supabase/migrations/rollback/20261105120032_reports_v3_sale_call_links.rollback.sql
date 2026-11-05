-- Rollback for 20261105120032_reports_v3_sale_call_links (D3 §8). Class C: no GRANT.
-- Runs only while Reports v3 is disabled and only from the exact …32 postimages. It restores the PKG-A link stub and
-- the PKG-B (…21) basis flags byte for byte; links stay stored (KPI 38 returns to sale_call_link_not_captured).
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname LIKE 'get\_report\_%\_v3'
                AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION 'Reports v3 sale call links rollback: Reports v3 must be disabled first' USING ERRCODE = '55000';
  END IF;
  IF md5(pg_get_functiondef(to_regprocedure('private.report_v3_sale_call_links(uuid,timestamptz)'))) IS DISTINCT FROM '998bad67912edf1d113b4f72417520d7'
     OR md5(pg_get_functiondef(to_regprocedure('private.report_v3_basis_flags()'))) IS DISTINCT FROM '9c6c9d5e9a2ca2b985e027e72cd5e10d' THEN
    RAISE EXCEPTION 'Reports v3 sale call links rollback: the …32 postimages are not in place' USING ERRCODE = 'P0001';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION private.report_v3_sale_call_links(p_org uuid, p_as_of timestamptz)
RETURNS TABLE (win_id uuid, call_id uuid, call_direction text, link_source text)
LANGUAGE sql
STABLE
PARALLEL RESTRICTED
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT NULL::uuid, NULL::uuid, NULL::text, NULL::text WHERE false;
$$;

CREATE OR REPLACE FUNCTION private.report_v3_basis_flags()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT '{"contract_version":"3.1.0","corrections":"audited_ledger","sale_call_links":"not_installed","appointment_evidence":"not_installed"}'::jsonb;
$$;

REVOKE ALL ON FUNCTION private.report_v3_sale_call_links(uuid, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_basis_flags() FROM PUBLIC, anon, authenticated, service_role;

DO $post$
BEGIN
  IF md5(pg_get_functiondef('private.report_v3_sale_call_links(uuid,timestamptz)'::regprocedure)) <> '769d31d180bf61264b0609e87b3ea24f'
     OR md5(pg_get_functiondef('private.report_v3_basis_flags()'::regprocedure)) <> '67c6a60a1004b4596a4a61487a41d17b' THEN
    RAISE EXCEPTION 'Reports v3 sale call links rollback: preimages not restored exactly' USING ERRCODE = 'P0001';
  END IF;
END $post$;
