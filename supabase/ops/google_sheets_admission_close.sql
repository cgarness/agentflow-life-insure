-- =====================================================================================================
-- Google Sheets — CLOSE ADMISSION (non-destructive shutdown gate). NOT RUN. Needs approval; apply as a
-- migration at the time (release-package.md §5).
-- Revokes EXECUTE on every public.google_sheets_* wrapper from service_role, EXCEPT google_sheets_disconnect
-- (agents can still remove their Google access). The Edge functions reach the database only through these
-- wrappers, so from this point NO invocation — a scheduled run, a queued pg_net request, an invocation that is
-- already running, the API or the OAuth callback — can start another database operation: each new call fails
-- with 42501 (permission denied). An RPC that is already executing finishes or rolls back atomically; verify
-- that with google_sheets_drain_check.sql. Deletes nothing and changes no lead, receipt, baseline, source
-- state, lease, schedule or connection. Restore with google_sheets_admission_open.sql.
-- =====================================================================================================
DO $close$
DECLARE fn regprocedure; n int := 0;
BEGIN
  IF to_regclass('public.google_sheets_sources') IS NULL THEN
    RAISE EXCEPTION 'google sheets foundation is not applied';
  END IF;
  FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
             WHERE ns.nspname = 'public' AND p.proname LIKE 'google\_sheets\_%' AND p.proname <> 'google_sheets_disconnect'
             ORDER BY 1 LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM service_role', fn);
    n := n + 1;
  END LOOP;
  IF n = 0 THEN RAISE EXCEPTION 'no google sheets wrappers found'; END IF;
  RAISE NOTICE 'google sheets admission CLOSED: EXECUTE revoked from service_role on % wrappers (disconnect kept)', n;
END $close$;
