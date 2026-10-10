-- =====================================================================================================
-- Onboarding email series — remove the worker schedule. NOT RUN. Kill switch (§11); needs approval.
-- Idempotent: does nothing when pg_cron or the job is absent. Deletes no data.
-- =====================================================================================================
DO $unschedule$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE NOTICE 'pg_cron is not installed; nothing to unschedule';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'onboarding-email-worker-every-minute') THEN
    PERFORM cron.unschedule('onboarding-email-worker-every-minute');
  ELSE
    RAISE NOTICE 'onboarding-email-worker-every-minute is not scheduled';
  END IF;
END $unschedule$;
