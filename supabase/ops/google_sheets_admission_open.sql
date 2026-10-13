-- =====================================================================================================
-- Google Sheets — OPEN ADMISSION (restore after google_sheets_admission_close.sql). NOT RUN. Needs approval;
-- apply as a migration at the time. Restores exactly the foundation migration's wrapper ACL: EXECUTE for
-- service_role on every public.google_sheets_* wrapper, none for PUBLIC, anon or authenticated. Interrupted
-- leases expire within 3 minutes; permanent receipts prevent any replay when sources resume.
-- =====================================================================================================
DO $open$
DECLARE fn regprocedure; n int := 0;
BEGIN
  IF to_regclass('public.google_sheets_sources') IS NULL THEN
    RAISE EXCEPTION 'google sheets foundation is not applied';
  END IF;
  FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
             WHERE ns.nspname = 'public' AND p.proname LIKE 'google\_sheets\_%' ORDER BY 1 LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'google sheets admission OPEN: % wrappers executable by service_role only', n;
END $open$;
