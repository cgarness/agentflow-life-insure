-- Reports V2 PKG-B (D2 §3.7): Reports v3 reads the audited effective sale premium. Privilege class W: its only
-- GRANTs are EXECUTE on the two correction RPCs TO authenticated (never anon, service_role or PUBLIC).
--
--   private.report_v3_sale_premium   the PKG-A stub, replaced: the monthly amount still comes only from the shared
--                                    choke point private.performance_sale_monthly (which …20 switched to the
--                                    effective premium); source, state and revision come from the ledger head.
--   private.report_v3_basis_flags    3.1.0, corrections = audited_ledger.
--
-- The ledger is empty while the RPCs are sealed, so no number changes: every sale is proved identical in monthly,
-- source and state, and equal to private.policy_sale_effective_premium, before COMMIT.
-- Runs only while Reports v3 is disabled, after …20, with the exact PKG-A postimages of both functions.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname LIKE 'get\_report\_%\_v3'
                AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION 'Reports v3 sale premium basis: Reports v3 must be disabled first' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('private.policy_sale_premium_corrections') IS NULL
     OR to_regprocedure('private.policy_sale_effective_premium(public.wins,numeric)') IS NULL
     OR to_regprocedure('public.correct_policy_sale_premium(uuid,uuid,integer,numeric,jsonb,numeric,text,text,text)') IS NULL
     OR to_regprocedure('public.get_client_policy_sale_premiums(uuid)') IS NULL
     OR md5(pg_get_functiondef('private.performance_sale_monthly(public.wins,numeric)'::regprocedure))
        <> 'ee64ddb694ad2e1b250ba069342c75fa' THEN
    RAISE EXCEPTION 'Reports v3 sale premium basis: the corrections ledger (…20) must be applied first' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('private.report_v3_sale_premium(public.wins,numeric)') IS NULL
     OR to_regprocedure('private.report_v3_basis_flags()') IS NULL THEN
    RAISE EXCEPTION 'Reports v3 sale premium basis: the PKG-A sale facts (…10, …11) must be applied first' USING ERRCODE = 'P0001';
  END IF;
  IF private.report_v3_basis_flags() ->> 'corrections' = 'audited_ledger' THEN
    RAISE EXCEPTION 'Reports v3 sale premium basis: refusing replay' USING ERRCODE = 'P0001';
  END IF;
  IF md5(pg_get_functiondef('private.report_v3_sale_premium(public.wins,numeric)'::regprocedure)) <> '37800ccc8ada2fae26b86dd5a610eb09'
     OR md5(pg_get_functiondef('private.report_v3_basis_flags()'::regprocedure)) <> 'e446177c344762bec8caf7d5e9321d9b' THEN
    RAISE EXCEPTION 'Reports v3 sale premium basis: PKG-A preimage drift' USING ERRCODE = 'P0001';
  END IF;
END $guard$;

-- Attributes of both functions and every sale's value before the replacement.
CREATE TEMP TABLE rvsp_meta ON COMMIT DROP AS
  SELECT p.oid, p.proowner, p.prosecdef, p.provolatile, p.proconfig, p.proacl::text AS acl, pg_get_function_result(p.oid) AS result
    FROM pg_proc p
   WHERE p.oid IN ('private.report_v3_sale_premium(public.wins,numeric)'::regprocedure, 'private.report_v3_basis_flags()'::regprocedure);
CREATE TEMP TABLE rvsp_before ON COMMIT DROP AS
  SELECT w.id, e.monthly, e.premium_source, e.premium_state, e.revision
    FROM public.wins w
    LEFT JOIN public.clients c ON c.id = w.contact_id AND c.organization_id = w.organization_id
   CROSS JOIN LATERAL private.report_v3_sale_premium(w, c.premium) e;

-- PL/pgSQL, like the PKG-A stub: the choke point is called through an assignment, so its state is kept across the
-- per-sale calls (D2's literal body, a call of the set-returning effective reader, rebuilds two nested SQL functions
-- for every sale). The monthly amount is the choke point's, so v3 cannot disagree with the Leaderboard; the head
-- revision gives source 'correction' and its state (a correction to unknown is 'missing').
CREATE OR REPLACE FUNCTION private.report_v3_sale_premium(p_win public.wins, p_client numeric)
RETURNS TABLE (monthly numeric, premium_source text, premium_state text, revision integer)
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_fallback numeric;
  v_head integer;
BEGIN
  monthly := private.performance_sale_monthly(p_win, p_client);
  SELECT h.revision INTO v_head FROM private.policy_sale_premium_corrections h
   WHERE h.organization_id = p_win.organization_id AND h.win_id = p_win.id ORDER BY h.revision DESC LIMIT 1;
  IF v_head IS NOT NULL THEN
    premium_source := 'correction';
    premium_state := CASE WHEN monthly IS NULL THEN 'missing' ELSE 'known' END;
    revision := v_head;
    RETURN NEXT;
    RETURN;
  END IF;
  -- Additional-policy legacy sales never borrow a client's premium (the same rule as the choke point).
  v_fallback := CASE WHEN p_win.idempotency_key ~ ':policy:[0-9]+$'
                       OR EXISTS (SELECT 1 FROM private.policy_identities i
                                   WHERE i.organization_id = p_win.organization_id AND i.policy_id = p_win.policy_id
                                     AND i.source = 'additional')
                     THEN NULL ELSE nullif(p_client, 0) END;
  premium_source := CASE WHEN p_win.premium_snapshot THEN 'sale_snapshot'
                         WHEN nullif(p_win.premium_amount, 0) IS NOT NULL THEN 'legacy_sale_event'
                         WHEN v_fallback IS NOT NULL THEN 'legacy_record_fallback'
                         ELSE 'none' END;
  premium_state := CASE WHEN monthly IS NOT NULL THEN 'known'
                        WHEN (CASE WHEN p_win.premium_snapshot THEN p_win.premium_amount
                                   ELSE coalesce(nullif(p_win.premium_amount, 0), v_fallback) END) < 0 THEN 'invalid'
                        ELSE 'missing' END;
  revision := 0;
  RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION private.report_v3_basis_flags()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT '{"contract_version":"3.1.0","corrections":"audited_ledger","sale_call_links":"not_installed","appointment_evidence":"not_installed"}'::jsonb;
$$;

DO $identity$
BEGIN
  IF EXISTS (SELECT 1 FROM rvsp_meta m JOIN pg_proc p ON p.oid = m.oid
              WHERE (p.proowner, p.prosecdef, p.provolatile, p.proconfig, p.proacl::text, pg_get_function_result(p.oid))
                    IS DISTINCT FROM (m.proowner, m.prosecdef, m.provolatile, m.proconfig, m.acl, m.result)) THEN
    RAISE EXCEPTION 'Reports v3 sale premium basis: function attributes changed' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM rvsp_before) <> (SELECT count(*) FROM public.wins) OR EXISTS (
       SELECT 1 FROM rvsp_before b JOIN public.wins w ON w.id = b.id
         LEFT JOIN public.clients c ON c.id = w.contact_id AND c.organization_id = w.organization_id
        CROSS JOIN LATERAL private.report_v3_sale_premium(w, c.premium) n
        CROSS JOIN LATERAL private.policy_sale_effective_premium(w, c.premium) e
        WHERE (n.monthly, n.premium_source, n.premium_state, n.revision) IS DISTINCT FROM (b.monthly, b.premium_source, b.premium_state, b.revision)
           OR (n.monthly, n.premium_source, n.premium_state, n.revision) IS DISTINCT FROM (e.monthly, e.source, e.state, e.revision)) THEN
    RAISE EXCEPTION 'Reports v3 sale premium basis: a sale premium changed at the replacement' USING ERRCODE = 'P0001';
  END IF;
  IF private.report_v3_basis_flags() IS DISTINCT FROM
     '{"contract_version":"3.1.0","corrections":"audited_ledger","sale_call_links":"not_installed","appointment_evidence":"not_installed"}'::jsonb THEN
    RAISE EXCEPTION 'Reports v3 sale premium basis: basis flags not installed' USING ERRCODE = 'P0001';
  END IF;
END $identity$;

-- Class W: the two RPCs become callable by signed-in users only; their own checks decide who may do what.
REVOKE ALL ON FUNCTION public.correct_policy_sale_premium(uuid,uuid,integer,numeric,jsonb,numeric,text,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_client_policy_sale_premiums(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.correct_policy_sale_premium(uuid,uuid,integer,numeric,jsonb,numeric,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_client_policy_sale_premiums(uuid) TO authenticated;

DO $acl$
DECLARE f regprocedure;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.correct_policy_sale_premium(uuid,uuid,integer,numeric,jsonb,numeric,text,text,text)'::regprocedure,
                           'public.get_client_policy_sale_premiums(uuid)'::regprocedure] LOOP
    IF NOT has_function_privilege('authenticated', f, 'EXECUTE') OR has_function_privilege('anon', f, 'EXECUTE')
       OR has_function_privilege('service_role', f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                   WHERE p.oid = f AND x.grantee <> p.proowner AND x.grantee <> 'authenticated'::regrole) THEN
      RAISE EXCEPTION 'Reports v3 sale premium basis: % ACL is not authenticated-only', f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $acl$;
