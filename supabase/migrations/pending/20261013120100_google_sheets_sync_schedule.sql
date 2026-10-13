-- =====================================================================================================
-- PENDING (outside the CLI glob) — Google Sheets sync worker schedule. Apply ONLY at pilot activation,
-- after the foundation migration, the four Edge Functions and the secrets are in place and verified.
-- Approved pattern (platform-admin-notify / sms-consent-worker): pg_cron POSTs every minute ONLY while a
-- source is due; the worker authenticates with the dedicated Vault secret `google_sheets_worker_token`,
-- compared in constant time against Edge secret GOOGLE_SHEETS_WORKER_TOKEN. Never the service-role key.
-- Rollback: SELECT cron.unschedule('google-sheets-sync-every-minute');
-- =====================================================================================================
DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN RAISE EXCEPTION 'pg_cron missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN RAISE EXCEPTION 'pg_net missing'; END IF;
  IF to_regclass('public.google_sheets_sources') IS NULL THEN RAISE EXCEPTION 'foundation migration not applied'; END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets
                  WHERE name = 'google_sheets_worker_token' AND length(decrypted_secret) >= 32) THEN
    RAISE EXCEPTION 'Vault secret google_sheets_worker_token missing or shorter than 32 characters';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'google-sheets-sync-every-minute') THEN
    RAISE EXCEPTION 'cron job google-sheets-sync-every-minute already exists; review before replacing';
  END IF;

  PERFORM cron.schedule('google-sheets-sync-every-minute', '* * * * *', $job$
    SELECT net.http_post(
      url := 'https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/google-sheets-sync-worker',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||decrypted_secret),
      body := '{}'::jsonb, timeout_milliseconds := 60000
    ) FROM vault.decrypted_secrets
     WHERE name = 'google_sheets_worker_token' AND length(decrypted_secret) >= 32
       AND EXISTS (SELECT 1 FROM public.google_sheets_sources s
                     JOIN public.google_sheets_connections c ON c.id = s.connection_id
                    WHERE s.state = 'enabled' AND s.health IN ('ok','error')
                      AND s.next_sync_at <= now() AND c.status = 'connected'
                      AND (s.lease_expires_at IS NULL OR s.lease_expires_at <= now()));
  $job$);
END
$guard$;
