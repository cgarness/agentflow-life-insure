-- Control helpers run only in the disposable synthetic test database.
CREATE FUNCTION rt.expect_sql_failure(p_sql text,p_message text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE rejected boolean:=false;
BEGIN
 BEGIN EXECUTE p_sql;
 EXCEPTION WHEN OTHERS THEN
  IF position(p_message in SQLERRM)=0 THEN RAISE EXCEPTION 'Unexpected control failure: %',SQLERRM; END IF;
  rejected:=true;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'Negative control did not fail: %',p_message; END IF;
END $$;
CREATE FUNCTION rt.source_fingerprint() RETURNS text LANGUAGE sql AS $$
 SELECT md5(string_agg(row_data,'|' ORDER BY row_data)) FROM (
  SELECT 'calls:'||to_jsonb(t)::text row_data FROM calls t UNION ALL
  SELECT 'sessions:'||to_jsonb(t)::text FROM dialer_sessions t UNION ALL
  SELECT 'bookings:'||to_jsonb(t)::text FROM appointments t UNION ALL
  SELECT 'clients:'||to_jsonb(t)::text FROM clients t UNION ALL
  SELECT 'wins:'||to_jsonb(t)::text FROM wins t UNION ALL
  SELECT 'profiles:'||to_jsonb(t)::text FROM profiles t UNION ALL
  SELECT 'permissions:'||to_jsonb(t)::text FROM role_permissions t UNION ALL
  SELECT 'maps:'||to_jsonb(t)::text FROM private.performance_duplicate_rows t
 ) s;
$$;
CREATE TABLE rt.integrity_preimage AS SELECT rt.source_fingerprint() fingerprint;
CREATE FUNCTION rt.assert_sealed(p_enabled boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE f record; r text; want boolean;
BEGIN
 FOR f IN SELECT p.oid,n.nspname,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE (n.nspname='private' AND p.proname LIKE 'report\_%')
     OR (n.nspname='public' AND (p.proname LIKE 'get\_report\_%' OR p.proname LIKE 'rpc\_report\_%')) LOOP
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   want:=p_enabled AND r='authenticated' AND f.nspname='public' AND f.proname LIKE '%\_v2';
   IF has_function_privilege(r,f.oid,'EXECUTE') IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'Seal mismatch % %',f.oid::regprocedure,r;
   END IF;
  END LOOP;
 END LOOP;
END $$;
CREATE FUNCTION rt.reject_mutation(p_signature text,p_from text,p_to text,p_probe text,p_message text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE original text;
BEGIN
 SELECT pg_get_functiondef(p_signature::regprocedure) INTO original;
 IF position(p_from in original)=0 THEN RAISE EXCEPTION 'Mutation target missing: %',p_signature; END IF;
 PERFORM rt.expect_sql_failure(replace(original,p_from,p_to)||';'||p_probe,p_message);
 IF pg_get_functiondef(p_signature::regprocedure)<>original THEN RAISE EXCEPTION 'Mutation was not rolled back'; END IF;
END $$;
