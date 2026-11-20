-- Business conflicts must terminate as HTTP 409, not request transaction retries.
-- Execute in one transaction. No data, RLS, grants, defaults or predicates change.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '15s';
DO $guard$
DECLARE target oid := 'public.advance_campaign_lead(uuid,uuid,uuid,timestamp with time zone,text,boolean,uuid,text,uuid,bigint,text)'::regprocedure;
 dependency oid := 'public.save_disposition_with_booking(jsonb,jsonb)'::regprocedure;
 source text;
BEGIN
 IF md5(pg_get_functiondef(target)) IS DISTINCT FROM '088c6d615225ccdca43f3099a5fbb65d'
    OR md5(pg_get_functiondef(dependency)) IS DISTINCT FROM '7ab488a93fbee0d7131c5c10c8fc07ad' THEN
  RAISE EXCEPTION 'Dialer conflict function preimage drift; stop and re-review';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_proc WHERE oid IN (target, dependency) AND (
   proowner <> 'postgres'::regrole OR NOT prosecdef OR provolatile <> 'v'
   OR proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']::text[]
   OR proacl IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'::aclitem[])) THEN
  RAISE EXCEPTION 'Dialer conflict security metadata drift; stop and re-review';
 END IF;
 source := pg_get_functiondef(target);
 IF (length(source)-length(replace(source, 'ERRCODE=''40001''', ''))) / length('ERRCODE=''40001''') <> 5 THEN
  RAISE EXCEPTION 'Expected exactly five explicit business conflicts';
 END IF;
 EXECUTE replace(source, 'ERRCODE=''40001''', 'ERRCODE=''PT409''');
 IF md5(pg_get_functiondef(target)) IS DISTINCT FROM '1051af15d3f9e08b2789d9f8e2d4ab39' THEN
  RAISE EXCEPTION 'Unexpected dialer conflict postimage';
 END IF;
END
$guard$;
