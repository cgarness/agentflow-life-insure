-- NOT APPROVED FOR PRODUCTION. Contract 3.4.0; see the dedicated cleanup release and recovery package.
-- Owner decision: Calls measures initiated attempts, not successful provider admission.
-- No call data, admission verdict, duration, disposition, authorization or historical premium is rewritten.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
DO $patch$
DECLARE r record; definition text; patched text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('private.report_v3_call_facts(uuid,timestamptz,timestamptz)', 'ec935ad4f9c9a313f9a6b6377173d97c'),
    ('private.report_v3_journey_rows(uuid,uuid[],text,timestamptz,timestamptz,date,date,timestamptz)', 'a89342cdebc000af171458215f56eedf')
  ) AS expected(signature, digest) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure(r.signature) AND md5(prosrc)=r.digest) THEN
      RAISE EXCEPTION 'Reports initiated-attempt preimage drift: %', r.signature;
    END IF;
    definition := pg_get_functiondef(to_regprocedure(r.signature));
    patched := replace(definition, 'c.dialer_admission_required, adm.admitted,',
      'c.dialer_admission_required, c.attempt_id, c.dialer_dispatch_error, adm.admitted,');
    IF patched=definition THEN RAISE EXCEPTION 'Missing call evidence projection'; END IF;
    definition := patched;
    patched := replace(definition,
      $old$WHEN NOT cr.dialer_admission_required OR cr.admitted IS TRUE THEN 'attempt'
                WHEN cr.admitted IS FALSE THEN 'non_attempt'
                ELSE 'unverified' END AS attempt_class$old$,
      $new$WHEN cr.admitted IS FALSE THEN 'non_attempt'
                WHEN cr.admitted IS TRUE OR NOT cr.dialer_admission_required THEN 'attempt'
                WHEN cr.dialer_dispatch_error = 'not_sent' THEN 'non_attempt'
                WHEN cr.attempt_id IS NOT NULL THEN 'attempt'
                ELSE 'unverified' END AS attempt_class$new$);
    IF patched=definition THEN RAISE EXCEPTION 'Missing call classifier'; END IF;
    EXECUTE patched;
  END LOOP;
END $patch$;

DO $version$
DECLARE definition text;
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='private.report_v3_basis_flags()'::regprocedure)
    IS DISTINCT FROM 'f8ec6855680ce2d0d53c9437f3506ab6' THEN RAISE EXCEPTION 'Reports contract preimage drift'; END IF;
 definition:=pg_get_functiondef('private.report_v3_basis_flags()'::regprocedure);
 EXECUTE replace(definition,'3.3.0','3.4.0');
END $version$;

-- Shared atomic sale writers all insert a canonical win. Reject new missing/zero premiums there,
-- before commit, preserving existing immutable historical events and idempotent receipt replays.
CREATE FUNCTION private.require_new_policy_sale_premium() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF NEW.premium_amount IS NULL OR NEW.premium_amount <= 0
     OR NEW.premium_amount::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'Enter a monthly premium greater than zero' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.require_new_policy_sale_premium() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER wins_require_new_policy_sale_premium BEFORE INSERT ON public.wins
  FOR EACH ROW EXECUTE FUNCTION private.require_new_policy_sale_premium();
COMMIT;
