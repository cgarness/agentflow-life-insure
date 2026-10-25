-- =====================================================================================================
-- PENDING (outside the CLI glob) — Google Sheets push MAINTENANCE schedule. Apply ONLY at the pilot gate (Gate E),
-- after 20261025120000_google_sheets_push_sync.sql, the google-sheets-push-maintenance Edge Function and its
-- secrets are in place and verified. NOT the old 5-minute sync schedule (pending/20261013120100), which stays
-- unapplied.
-- The job sends an HTTP request ONLY while private.google_sheets_push_maintenance_due() is true: watch channels to
-- register / renew / stop, or queued notification jobs due for retry / recovery. It never causes a spreadsheet
-- read on its own; reads happen only for jobs a notification or an owner action queued.
-- Auth: dedicated Vault secret `google_sheets_push_maintenance_token`, compared in constant time against Edge secret
-- GOOGLE_SHEETS_PUSH_MAINTENANCE_TOKEN (≥ 32 chars). Never the service-role key.
-- Rollback: supabase/ops/google_sheets_push_unschedule.sql
-- =====================================================================================================
DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN RAISE EXCEPTION 'pg_cron missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN RAISE EXCEPTION 'pg_net missing'; END IF;
  IF to_regclass('private.google_sheets_watch_targets') IS NULL THEN RAISE EXCEPTION 'push sync migration not applied'; END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets
                  WHERE name = 'google_sheets_push_maintenance_token' AND length(decrypted_secret) >= 32) THEN
    RAISE EXCEPTION 'Vault secret google_sheets_push_maintenance_token missing or shorter than 32 characters';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'google-sheets-push-maintenance-every-minute') THEN
    RAISE EXCEPTION 'cron job google-sheets-push-maintenance-every-minute already exists; review before replacing';
  END IF;

  PERFORM cron.schedule('google-sheets-push-maintenance-every-minute', '* * * * *', $job$
    SELECT net.http_post(
      url := 'https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/google-sheets-push-maintenance',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||decrypted_secret),
      body := '{}'::jsonb, timeout_milliseconds := 120000
    ) FROM vault.decrypted_secrets
     WHERE name = 'google_sheets_push_maintenance_token' AND length(decrypted_secret) >= 32
       AND private.google_sheets_push_maintenance_due();
  $job$);
END
$guard$;
