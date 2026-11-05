-- Reports V2 PKG-C (D3 §3.6): Reports v3 reads the captured producing-call links. Privilege class C: no GRANT.
-- Runs only inside the v3-only window (v3 disabled), after …30, with the exact PKG-A stub of
-- private.report_v3_sale_call_links and the PKG-B (…21) postimage of private.report_v3_basis_flags.
--   private.report_v3_sale_call_links  same-org sale and call joined, captured_at <= as_of
--   private.report_v3_basis_flags      3.2.0: sale_call_links 'installed'; every other key copied from the preimage
-- The journey bodies and their pins are unchanged; KPI 38 classifies from links once the flag is installed.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname LIKE 'get\_report\_%\_v3'
                AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION 'Reports v3 sale call links: Reports v3 must be disabled first' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('private.policy_sale_call_links') IS NULL THEN
    RAISE EXCEPTION 'Reports v3 sale call links: the link table (…30) must be applied first' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('private.report_v3_sale_call_links(uuid,timestamptz)') IS NULL
     OR to_regprocedure('private.report_v3_basis_flags()') IS NULL THEN
    RAISE EXCEPTION 'Reports v3 sale call links: the PKG-A helpers (…10, …12) must be applied first' USING ERRCODE = 'P0001';
  END IF;
  IF private.report_v3_basis_flags() ->> 'sale_call_links' = 'installed' THEN
    RAISE EXCEPTION 'Reports v3 sale call links: refusing replay' USING ERRCODE = 'P0001';
  END IF;
  IF md5(pg_get_functiondef('private.report_v3_sale_call_links(uuid,timestamptz)'::regprocedure)) <> '769d31d180bf61264b0609e87b3ea24f'
     OR md5(pg_get_functiondef('private.report_v3_basis_flags()'::regprocedure)) <> '67c6a60a1004b4596a4a61487a41d17b' THEN
    RAISE EXCEPTION 'Reports v3 sale call links: preimage drift' USING ERRCODE = 'P0001';
  END IF;
END $guard$;

CREATE TEMP TABLE rvscl_meta ON COMMIT DROP AS
  SELECT p.oid, p.proowner, p.prosecdef, p.provolatile, p.proconfig, p.proacl::text AS acl, pg_get_function_result(p.oid) AS result
    FROM pg_proc p
   WHERE p.oid IN ('private.report_v3_sale_call_links(uuid,timestamptz)'::regprocedure, 'private.report_v3_basis_flags()'::regprocedure);

-- PKG-C replaced the PKG-A stub (…32): captured links, same-org sale and call, captured by as_of.
CREATE OR REPLACE FUNCTION private.report_v3_sale_call_links(p_org uuid, p_as_of timestamptz)
RETURNS TABLE (win_id uuid, call_id uuid, call_direction text, link_source text)
LANGUAGE sql
STABLE
PARALLEL RESTRICTED
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT l.win_id, l.call_id, l.call_direction, l.link_source
    FROM private.policy_sale_call_links l
    JOIN public.wins w ON w.id = l.win_id AND w.organization_id = l.organization_id
    JOIN public.calls c ON c.id = l.call_id AND c.organization_id = l.organization_id
   WHERE l.organization_id = p_org AND l.captured_at <= p_as_of;
$$;

CREATE OR REPLACE FUNCTION private.report_v3_basis_flags()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT '{"contract_version":"3.2.0","corrections":"audited_ledger","sale_call_links":"installed","appointment_evidence":"not_installed"}'::jsonb;
$$;

REVOKE ALL ON FUNCTION private.report_v3_sale_call_links(uuid, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_basis_flags() FROM PUBLIC, anon, authenticated, service_role;

DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM rvscl_meta m JOIN pg_proc p ON p.oid = m.oid
              WHERE (p.proowner, p.prosecdef, p.provolatile, p.proconfig, p.proacl::text, pg_get_function_result(p.oid))
                    IS DISTINCT FROM (m.proowner, m.prosecdef, m.provolatile, m.proconfig, m.acl, m.result)) THEN
    RAISE EXCEPTION 'Reports v3 sale call links: function attributes changed' USING ERRCODE = 'P0001';
  END IF;
  IF private.report_v3_basis_flags() IS DISTINCT FROM
     '{"contract_version":"3.2.0","corrections":"audited_ledger","sale_call_links":"installed","appointment_evidence":"not_installed"}'::jsonb THEN
    RAISE EXCEPTION 'Reports v3 sale call links: basis flags not installed' USING ERRCODE = 'P0001';
  END IF;
END $post$;
