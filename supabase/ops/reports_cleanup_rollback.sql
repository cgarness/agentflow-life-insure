-- Separately approved rollback only; restore old frontend first. No data rewrite.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';
DO $rollback$
DECLARE r record; definition text; patched text;
BEGIN
 FOR r IN SELECT * FROM (VALUES
 ('private.report_v3_call_facts(uuid,timestamptz,timestamptz)','4265ffb146f3be4647af284c33cb18b7','ec935ad4f9c9a313f9a6b6377173d97c'),
 ('private.report_v3_journey_rows(uuid,uuid[],text,timestamptz,timestamptz,date,date,timestamptz)','e89bb2eb3c5a63fe8f7a0276df5c1c12','a89342cdebc000af171458215f56eedf'),
 ('private.report_v3_basis_flags()','caa89505da6f58e86009d028be305f52','f8ec6855680ce2d0d53c9437f3506ab6')) AS x(signature,postimage,preimage) LOOP
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure(r.signature)) IS DISTINCT FROM r.postimage THEN RAISE EXCEPTION 'Rollback postimage drift: %',r.signature; END IF;
 definition:=pg_get_functiondef(to_regprocedure(r.signature));
 patched:=replace(definition,'3.4.0','3.3.0');
 patched:=replace(patched,'c.dialer_admission_required, c.attempt_id, c.dialer_dispatch_error, adm.admitted,','c.dialer_admission_required, adm.admitted,');
 patched:=replace(patched,$new$WHEN cr.admitted IS FALSE THEN 'non_attempt'
                WHEN cr.admitted IS TRUE OR NOT cr.dialer_admission_required THEN 'attempt'
                WHEN cr.dialer_dispatch_error = 'not_sent' THEN 'non_attempt'
                WHEN cr.attempt_id IS NOT NULL THEN 'attempt'
                ELSE 'unverified' END AS attempt_class$new$,$old$WHEN NOT cr.dialer_admission_required OR cr.admitted IS TRUE THEN 'attempt'
                WHEN cr.admitted IS FALSE THEN 'non_attempt'
                ELSE 'unverified' END AS attempt_class$old$);
 EXECUTE patched;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure(r.signature)) IS DISTINCT FROM r.preimage THEN RAISE EXCEPTION 'Rollback did not restore exact original body'; END IF;
 END LOOP;
END $rollback$;

DO $premium_guard$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.require_new_policy_sale_premium()') AND md5(prosrc)='217f8b3c265b7c4c12e68d23c0c31806' AND proowner='postgres'::regrole AND NOT prosecdef) THEN RAISE EXCEPTION 'Premium guard drift'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.wins'::regclass AND tgname='wins_require_new_policy_sale_premium' AND tgfoid='private.require_new_policy_sale_premium()'::regprocedure AND tgenabled='O' AND tgtype=7) THEN RAISE EXCEPTION 'Premium trigger missing or changed'; END IF;
 IF EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='private.require_new_policy_sale_premium()'::regprocedure AND a.grantee<>p.proowner) THEN RAISE EXCEPTION 'Premium guard has extra grants'; END IF;
END $premium_guard$;

DROP TRIGGER wins_require_new_policy_sale_premium ON public.wins;
DROP FUNCTION private.require_new_policy_sale_premium();
COMMIT;
