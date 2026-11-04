-- Rollback for 20261104120020_policy_sale_premium_corrections (D2 §10). Privilege class C: no GRANT.
-- It runs only while Reports v3 is disabled. It always seals the correction writer and the history reader.
-- With an empty ledger and the …20 postimage of private.performance_sale_monthly still in place, it also restores the
-- exact preimage (md5 51e06b46…) and drops the readers and RPCs. Otherwise it seals only, and the readers keep
-- applying corrections (RL-18). The ledger table, its guard and its triggers are never dropped. A re-forward is a new
-- reviewed migration, never a replay of …20.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

DO $rollback$
DECLARE
  v_fn regprocedure := to_regprocedure('private.performance_sale_monthly(public.wins,numeric)');
  v_post constant text := 'ee64ddb694ad2e1b250ba069342c75fa';
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
  IF EXISTS (SELECT 1 FROM private.policy_sale_premium_corrections) OR v_fn IS NULL
     OR md5(pg_get_functiondef(v_fn)) <> v_post THEN
    RAISE NOTICE 'Sale premium corrections rollback: writer sealed; corrections stay applied by the readers';
    RETURN;
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
