-- Hosted Supabase does not allow `ALTER DATABASE ... SET app.settings.recording_retention_cron_secret`.
-- pg_cron reads the shared secret from a non-API schema instead (set once via SQL Editor; see ROADMAP).

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.recording_retention_cron_secret (
  id int PRIMARY KEY CHECK (id = 1),
  secret text NOT NULL DEFAULT ''
);

INSERT INTO private.recording_retention_cron_secret (id, secret)
VALUES (1, '')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE private.recording_retention_cron_secret OWNER TO postgres;

REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON TABLE private.recording_retention_cron_secret FROM PUBLIC;
REVOKE ALL ON TABLE private.recording_retention_cron_secret FROM anon, authenticated, service_role;

COMMENT ON TABLE private.recording_retention_cron_secret IS
  'Singleton row (id=1) used only by pg_cron net.http_post x-cron-secret for recording-retention-purge. Not exposed via PostgREST if schema private stays out of API settings.';

DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'recording-retention-purge-daily') THEN
    PERFORM cron.unschedule('recording-retention-purge-daily');
  END IF;

  PERFORM cron.schedule(
    'recording-retention-purge-daily',
    '15 8 * * *',
    $http$
    SELECT
      net.http_post(
        url := 'https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/recording-retention-purge',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (SELECT secret FROM private.recording_retention_cron_secret WHERE id = 1)
        ),
        body := '{}'::jsonb
      );
    $http$
  );
END
$migration$;
