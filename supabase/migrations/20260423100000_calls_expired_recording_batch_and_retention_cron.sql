-- Batch-select call rows whose Storage-backed recordings are older than a cutoff (for retention purge Edge Function).
CREATE OR REPLACE FUNCTION public.calls_expired_recording_batch(
  p_organization_id uuid,
  p_cutoff timestamptz,
  p_limit integer DEFAULT 200
)
RETURNS TABLE (id uuid, recording_storage_path text)
LANGUAGE sql
STABLE
AS $$
  SELECT c.id, c.recording_storage_path
  FROM public.calls c
  WHERE c.organization_id = p_organization_id
    AND c.recording_storage_path IS NOT NULL
    AND btrim(c.recording_storage_path) <> ''
    AND COALESCE(c.ended_at, c.started_at, c.created_at) < p_cutoff
  ORDER BY COALESCE(c.ended_at, c.started_at, c.created_at) ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);
$$;

COMMENT ON FUNCTION public.calls_expired_recording_batch(uuid, timestamptz, integer) IS
  'Returns up to p_limit calls for an org whose recording_storage_path should be purged (call ended/started before p_cutoff). Used by recording-retention-purge Edge Function.';

REVOKE ALL ON FUNCTION public.calls_expired_recording_batch(uuid, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calls_expired_recording_batch(uuid, timestamptz, integer) TO service_role;

-- Daily purge: cron header secret was originally read from app.settings (not settable on hosted Supabase); superseded by private.recording_retention_cron_secret in 20260423140000.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

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
          'x-cron-secret', COALESCE(current_setting('app.settings.recording_retention_cron_secret', true), '')
        ),
        body := '{}'::jsonb
      );
    $http$
  );
END
$migration$;
