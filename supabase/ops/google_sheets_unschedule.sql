-- =====================================================================================================
-- Google Sheets — remove the sync worker schedule. NOT RUN. Shutdown step (release-package.md §5); needs
-- approval. Idempotent: does nothing when pg_cron or the job is absent. Deletes no data.
-- Effect: no FUTURE scheduled invocation. A net.http_post already queued in net.http_request_queue can still
-- be sent, and an invocation already running keeps going: close admission (google_sheets_admission_close.sql)
-- and run google_sheets_drain_check.sql before calling anything stopped.
-- =====================================================================================================
DO $unschedule$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE NOTICE 'pg_cron is not installed; nothing to unschedule';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'google-sheets-sync-every-minute') THEN
    PERFORM cron.unschedule('google-sheets-sync-every-minute');
  ELSE
    RAISE NOTICE 'google-sheets-sync-every-minute is not scheduled';
  END IF;
END $unschedule$;
