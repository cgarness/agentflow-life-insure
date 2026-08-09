-- pg_cron schedules for email-sync-incremental and google-calendar-inbound-sync.
-- =====================================================================
-- Hosted Supabase denies `ALTER DATABASE ... SET app.settings.*` (42501),
-- so cron header secrets are read from a singleton private table per the
-- recording-retention pattern shipped in 20260423140000_recording_cron_secret_private_table.sql.
--
-- Operator action required AFTER this migration applies (one-time, run in
-- the Supabase SQL Editor as Super Admin):
--   UPDATE private.email_sync_cron_secret
--      SET secret = '<value of EMAIL_SYNC_CRON_SECRET edge secret>'
--    WHERE id = 1;
--   UPDATE private.google_sync_cron_secret
--      SET secret = '<value of GOOGLE_SYNC_CRON_SECRET edge secret>'
--    WHERE id = 1;
-- Until those rows are populated the cron jobs will fire with an empty
-- x-cron-secret header and the edge functions will respond 401 Unauthorized.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE SCHEMA IF NOT EXISTS private;

-- email-sync-incremental cron secret (singleton row).
CREATE TABLE IF NOT EXISTS private.email_sync_cron_secret (
  id     int PRIMARY KEY CHECK (id = 1),
  secret text NOT NULL DEFAULT ''
);

INSERT INTO private.email_sync_cron_secret (id, secret)
VALUES (1, '')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE private.email_sync_cron_secret OWNER TO postgres;
REVOKE ALL ON TABLE private.email_sync_cron_secret FROM PUBLIC;
REVOKE ALL ON TABLE private.email_sync_cron_secret FROM anon, authenticated, service_role;

COMMENT ON TABLE private.email_sync_cron_secret IS
  'Singleton (id=1) used only by pg_cron net.http_post x-cron-secret header for email-sync-incremental. Not exposed via PostgREST as long as schema private stays out of API settings.';

-- google-calendar-inbound-sync cron secret (singleton row).
CREATE TABLE IF NOT EXISTS private.google_sync_cron_secret (
  id     int PRIMARY KEY CHECK (id = 1),
  secret text NOT NULL DEFAULT ''
);

INSERT INTO private.google_sync_cron_secret (id, secret)
VALUES (1, '')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE private.google_sync_cron_secret OWNER TO postgres;
REVOKE ALL ON TABLE private.google_sync_cron_secret FROM PUBLIC;
REVOKE ALL ON TABLE private.google_sync_cron_secret FROM anon, authenticated, service_role;

COMMENT ON TABLE private.google_sync_cron_secret IS
  'Singleton (id=1) used only by pg_cron net.http_post x-cron-secret header for google-calendar-inbound-sync. Not exposed via PostgREST as long as schema private stays out of API settings.';

-- Job 1: email-sync-incremental every 5 minutes.
DO $email_cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'email-sync-incremental-every-5m') THEN
    PERFORM cron.unschedule('email-sync-incremental-every-5m');
  END IF;

  PERFORM cron.schedule(
    'email-sync-incremental-every-5m',
    '*/5 * * * *',
    $http$
    SELECT
      net.http_post(
        url := 'https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/email-sync-incremental',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (SELECT secret FROM private.email_sync_cron_secret WHERE id = 1)
        ),
        body := '{}'::jsonb
      );
    $http$
  );
END
$email_cron$;

-- Job 2: google-calendar-inbound-sync every 5 minutes (restoring the
-- legacy 20260308171000 schedule that was inert because it relied on the
-- forbidden app.settings.* path).
DO $calendar_cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'google-calendar-inbound-sync-every-5m') THEN
    PERFORM cron.unschedule('google-calendar-inbound-sync-every-5m');
  END IF;

  PERFORM cron.schedule(
    'google-calendar-inbound-sync-every-5m',
    '*/5 * * * *',
    $http$
    SELECT
      net.http_post(
        url := 'https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/google-calendar-inbound-sync',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (SELECT secret FROM private.google_sync_cron_secret WHERE id = 1)
        ),
        body := '{}'::jsonb
      );
    $http$
  );
END
$calendar_cron$;
