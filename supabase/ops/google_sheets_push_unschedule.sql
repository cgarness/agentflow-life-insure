-- =====================================================================================================
-- Google Sheets push — remove the maintenance schedule. NOT RUN. Needs approval. Idempotent; deletes no data.
-- A request already queued in pg_net can still be sent; verify with google_sheets_drain_check.sql.
-- =====================================================================================================
DO $unschedule$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN RAISE NOTICE 'pg_cron is not installed; nothing to unschedule'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'google-sheets-push-maintenance-every-minute') THEN
    PERFORM cron.unschedule('google-sheets-push-maintenance-every-minute');
  ELSE
    RAISE NOTICE 'google-sheets-push-maintenance-every-minute is not scheduled';
  END IF;
END
$unschedule$;
