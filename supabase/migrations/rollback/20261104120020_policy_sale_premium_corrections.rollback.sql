-- Rollback for 20261104120020_policy_sale_premium_corrections (D2 §10). Privilege class C: no GRANT.
-- It runs only while Reports v3 is disabled. It always seals the correction writer and the history reader.
-- With an empty ledger and the PKG-B postimages still in place (…20's private.performance_sale_monthly, and either
-- the PKG-A or, after …21, the PKG-B bodies of private.report_v3_sale_premium and private.report_v3_basis_flags), it
-- restores the exact preimages (performance_sale_monthly md5 51e06b46…; after …21 also the PKG-A stub and basis flags)
-- and drops the readers and RPCs. Otherwise (a non-empty ledger, or a later package replaced the basis flags) it seals
-- only, and the readers keep applying corrections (RL-18). The ledger table, its guard and its triggers are never dropped. A re-forward is a new
-- reviewed migration, never a replay of …20.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

DO $rollback$
DECLARE
  v_fn regprocedure := to_regprocedure('private.performance_sale_monthly(public.wins,numeric)');
  v_post constant text := 'ee64ddb694ad2e1b250ba069342c75fa';
  v_stub text := md5(pg_get_functiondef(to_regprocedure('private.report_v3_sale_premium(public.wins,numeric)')));
  v_flags text := md5(pg_get_functiondef(to_regprocedure('private.report_v3_basis_flags()')));
  v_basis boolean;  -- true: the …21 postimages are in place; false: the PKG-A ones or no v3 at all; NULL: neither
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname LIKE 'get\_report\_%\_v3'
                AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION 'Sale premium corrections rollback: Reports v3 must be disabled first' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('private.policy_sale_premium_corrections') IS NULL THEN
    RAISE EXCEPTION 'Sale premium corrections rollback: nothing to roll back' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.correct_policy_sale_premium(uuid,uuid,integer,numeric,jsonb,numeric,text,text,text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.correct_policy_sale_premium(uuid,uuid,integer,numeric,jsonb,numeric,text,text,text)
      FROM PUBLIC, anon, authenticated, service_role;
  END IF;
  IF to_regprocedure('public.get_client_policy_sale_premiums(uuid)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.get_client_policy_sale_premiums(uuid) FROM PUBLIC, anon, authenticated, service_role;
  END IF;
  v_basis := CASE WHEN v_stub = '9c46e97ff58247a13826ddef83e28355' AND v_flags = '67c6a60a1004b4596a4a61487a41d17b' THEN true
                  WHEN v_stub = '37800ccc8ada2fae26b86dd5a610eb09' AND v_flags = 'e446177c344762bec8caf7d5e9321d9b' THEN false
                  WHEN v_stub IS NULL AND v_flags IS NULL THEN false END;
  IF EXISTS (SELECT 1 FROM private.policy_sale_premium_corrections) OR v_fn IS NULL
     OR md5(pg_get_functiondef(v_fn)) <> v_post OR v_basis IS NULL THEN
    RAISE NOTICE 'Sale premium corrections rollback: writer sealed; corrections stay applied by the readers';
    RETURN;
  END IF;
  IF v_basis THEN
    EXECUTE $restore$CREATE OR REPLACE FUNCTION private.report_v3_sale_premium(p_win public.wins, p_client numeric)
RETURNS TABLE (monthly numeric, premium_source text, premium_state text, revision integer)
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
-- PL/pgSQL, not SQL: the choke point is called through an assignment, so its initialized state is kept across the
-- per-sale calls instead of being rebuilt inside each call (the same row, about a third of the cost).
DECLARE
  v_fallback numeric;
BEGIN
  monthly := private.performance_sale_monthly(p_win, p_client);
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
END $$;$restore$;
    EXECUTE $restore$CREATE OR REPLACE FUNCTION private.report_v3_basis_flags()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT '{"contract_version":"3.0.0","corrections":"not_installed","sale_call_links":"not_installed","appointment_evidence":"not_installed"}'::jsonb;
$$;$restore$;
    IF md5(pg_get_functiondef('private.report_v3_sale_premium(public.wins,numeric)'::regprocedure)) <> '37800ccc8ada2fae26b86dd5a610eb09'
       OR md5(pg_get_functiondef('private.report_v3_basis_flags()'::regprocedure)) <> 'e446177c344762bec8caf7d5e9321d9b' THEN
      RAISE EXCEPTION 'Sale premium corrections rollback: PKG-A sale premium basis not restored exactly' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  EXECUTE $preimage$CREATE OR REPLACE FUNCTION private.performance_sale_monthly(p_win public.wins,p_client numeric) RETURNS numeric
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT private.performance_monthly(p_win.premium_snapshot,p_win.premium_amount,
  CASE WHEN p_win.idempotency_key ~ ':policy:[0-9]+$' OR EXISTS(SELECT 1 FROM private.policy_identities i WHERE i.policy_id=p_win.policy_id AND i.organization_id=p_win.organization_id AND i.source='additional')
   THEN NULL ELSE p_client END)
$$;$preimage$;
  IF md5(pg_get_functiondef(v_fn)) <> '51e06b46a13c3a8eec4d672bec158376' THEN
    RAISE EXCEPTION 'Sale premium corrections rollback: preimage not restored exactly' USING ERRCODE = 'P0001';
  END IF;
  DROP FUNCTION public.correct_policy_sale_premium(uuid,uuid,integer,numeric,jsonb,numeric,text,text,text);
  DROP FUNCTION public.get_client_policy_sale_premiums(uuid);
  DROP FUNCTION private.policy_sale_effective_premium(public.wins,numeric);
  DROP FUNCTION private.policy_sale_original_premium(public.wins,numeric);
  DROP FUNCTION private.policy_sale_book_monthly(jsonb,boolean);
END $rollback$;
