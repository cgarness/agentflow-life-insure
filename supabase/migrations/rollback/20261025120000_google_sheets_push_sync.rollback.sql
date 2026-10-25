-- =====================================================================================================
-- ROLLBACK for 20261025120000_google_sheets_push_sync.sql. NOT RUN. Needs approval; apply as a migration at the
-- time. Prerequisites: the push maintenance schedule is unscheduled (google_sheets_push_unschedule.sql) and the
-- Edge kill switch GOOGLE_SHEETS_PUSH_ENABLED is unset; Google channels left behind expire within one day and
-- their notifications are answered 404 once the channel rows are gone.
-- Removes ONLY the push objects, restores the exact foundation private.google_sheets_finish (MD5-verified) and
-- the three-value sync_runs trigger CHECK. Leads, receipts, the identity ledger, sources, connections and
-- sync_runs history are never touched; if 'push' history rows exist, the CHECK is restored NOT VALID so they stay.
-- =====================================================================================================
DO $pre$
BEGIN
  IF to_regclass('private.google_sheets_watch_targets') IS NULL THEN
    RAISE EXCEPTION 'google sheets push sync is not applied';
  END IF;
  IF to_regnamespace('cron') IS NOT NULL THEN
    IF (xpath('/row/c/text()', query_to_xml(
          'SELECT count(*) AS c FROM cron.job WHERE jobname = ''google-sheets-push-maintenance-every-minute''',
          false, true, '')))[1]::text::int > 0 THEN
      RAISE EXCEPTION 'unschedule google-sheets-push-maintenance-every-minute first';
    END IF;
  END IF;
END
$pre$;

DROP FUNCTION public.google_sheets_push_accept(text, text, text, text, bigint, text, timestamptz);
DROP FUNCTION public.google_sheets_push_claim(uuid, uuid, integer, text);
DROP FUNCTION public.google_sheets_push_claim_source(uuid, uuid, uuid, uuid);
DROP FUNCTION public.google_sheets_push_complete(uuid, uuid, jsonb);
DROP FUNCTION public.google_sheets_push_kick(uuid, uuid, uuid, text);
DROP FUNCTION public.google_sheets_watch_begin(uuid, bigint, text, text, text, text, text);
DROP FUNCTION public.google_sheets_watch_result(uuid, text, text, timestamptz, text);
DROP FUNCTION public.google_sheets_watch_release(uuid, uuid, text, boolean);
DROP FUNCTION public.google_sheets_push_maintenance_claim(uuid, integer, text);
DROP FUNCTION public.google_sheets_push_status(uuid, uuid);

DROP FUNCTION private.google_sheets_push_accept(text, text, text, text, bigint, text, timestamptz);
DROP FUNCTION private.google_sheets_push_claim(uuid, uuid, integer, text);
DROP FUNCTION private.google_sheets_push_claim_source(uuid, uuid, uuid, uuid);
DROP FUNCTION private.google_sheets_push_complete(uuid, uuid, jsonb);
DROP FUNCTION private.google_sheets_push_kick(uuid, uuid, uuid, text);
DROP FUNCTION private.google_sheets_watch_begin(uuid, bigint, text, text, text, text, text);
DROP FUNCTION private.google_sheets_watch_result(uuid, text, text, timestamptz, text);
DROP FUNCTION private.google_sheets_watch_release(uuid, uuid, text, boolean);
DROP FUNCTION private.google_sheets_push_maintenance_claim(uuid, integer, text);
DROP FUNCTION private.google_sheets_push_maintenance_due();
DROP FUNCTION private.google_sheets_push_status(uuid, uuid);
DROP FUNCTION private.google_sheets_push_source_allowed(uuid);
DROP FUNCTION private.google_sheets_ct_equal(bytea, bytea);

DROP TABLE private.google_sheets_push_attempts;
DROP TABLE private.google_sheets_push_events;
DROP TABLE private.google_sheets_watch_channels;
DROP TABLE private.google_sheets_watch_targets;
DROP TABLE private.google_sheets_push_pilot_sources;
DROP TABLE private.google_sheets_push_config;

-- Exact foundation definition (spliced byte-for-byte from 20261022062539_google_sheets_import_foundation.sql).
CREATE OR REPLACE FUNCTION private.google_sheets_finish(p_source uuid, p_lease uuid, p_version integer, p_generation bigint,
  p_trigger text, p_result jsonb)
 RETURNS text
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
DECLARE
  s public.google_sheets_sources; c public.google_sheets_connections;
  v_health text := COALESCE(p_result->>'health', 'ok');
  v_backoff boolean := COALESCE((p_result->>'backoff')::boolean, false);
  v_backlog boolean := COALESCE((p_result->>'backlog')::boolean, false);
  v_code text := left(p_result->>'error_code', 64);
  v_fail int; v_next timestamptz; v_now timestamptz;
BEGIN
  IF v_health NOT IN ('ok','needs_review','access_lost','error') OR p_trigger NOT IN ('schedule','manual','activation') THEN
    RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO s FROM public.google_sheets_sources WHERE id = p_source FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF s.lease_owner IS DISTINCT FROM p_lease THEN RETURN 'not_owner'; END IF;
  SELECT * INTO c FROM public.google_sheets_connections WHERE id = s.connection_id FOR SHARE; -- finish:connection-lock
  v_now := clock_timestamp();
  IF s.lease_expires_at IS NULL OR s.lease_expires_at <= v_now
     OR s.config_version IS DISTINCT FROM p_version OR s.state <> 'enabled'
     OR c.id IS NULL OR c.status <> 'connected' OR c.auth_generation IS DISTINCT FROM p_generation
     OR c.user_id <> s.user_id OR c.organization_id <> s.organization_id
     OR NOT private.google_sheets_owner_eligible(s.user_id, s.organization_id) THEN
    UPDATE public.google_sheets_sources SET lease_owner = NULL, lease_expires_at = NULL WHERE id = s.id;
    RETURN 'released';
  END IF;

  v_fail := CASE WHEN v_backoff OR v_health = 'error' THEN s.consecutive_failures + 1 ELSE 0 END;
  v_next := CASE
    WHEN v_backoff OR v_health = 'error' THEN now() + (CASE LEAST(v_fail, 6)
         WHEN 1 THEN interval '1 minute' WHEN 2 THEN interval '2 minutes' WHEN 3 THEN interval '5 minutes'
         WHEN 4 THEN interval '15 minutes' WHEN 5 THEN interval '30 minutes' ELSE interval '60 minutes' END)
    WHEN v_backlog THEN now()
    ELSE now() + interval '5 minutes' + (random() * interval '60 seconds') - interval '30 seconds' END;

  UPDATE public.google_sheets_sources g
     SET lease_owner = NULL, lease_expires_at = NULL, last_checked_at = now(),
         health = v_health,
         review_reason = CASE WHEN v_health = 'needs_review' THEN left(p_result->>'review_reason', 64) ELSE NULL END,
         phase = CASE WHEN COALESCE((p_result->>'phase_complete')::boolean, false) THEN 'steady' ELSE g.phase END,
         consecutive_failures = v_fail, next_sync_at = v_next,
         last_success_at = CASE WHEN v_health = 'ok' AND NOT v_backoff THEN now() ELSE g.last_success_at END,
         last_error_code = v_code,
         last_error_message = left(p_result->>'error_message', 200),
         last_result = jsonb_build_object(
           'imported', COALESCE((p_result->>'imported')::int, 0), 'flagged', COALESCE((p_result->>'flagged')::int, 0),
           'skipped', COALESCE((p_result->>'skipped')::int, 0), 'errors', COALESCE((p_result->>'errors')::int, 0),
           'pending', COALESCE((p_result->>'pending')::int, 0), 'at', now()),
         updated_at = now()
   WHERE g.id = s.id;

  INSERT INTO public.google_sheets_sync_runs
    (organization_id, user_id, source_id, trigger, started_at, rows_read, imported, flagged, skipped, errors,
     error_code, errors_sample)
  VALUES (s.organization_id, s.user_id, s.id, p_trigger,
          COALESCE((p_result->>'started_at')::timestamptz, now()),
          COALESCE((p_result->>'rows_read')::int, 0), COALESCE((p_result->>'imported')::int, 0),
          COALESCE((p_result->>'flagged')::int, 0), COALESCE((p_result->>'skipped')::int, 0),
          COALESCE((p_result->>'errors')::int, 0), v_code,
          CASE WHEN jsonb_typeof(p_result->'errors_sample') = 'array'
               THEN (SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) FROM
                       (SELECT e FROM jsonb_array_elements(p_result->'errors_sample') e LIMIT 20) q)
               ELSE '[]'::jsonb END);
  DELETE FROM public.google_sheets_sync_runs
   WHERE source_id = s.id AND id NOT IN (SELECT id FROM public.google_sheets_sync_runs
                                         WHERE source_id = s.id ORDER BY finished_at DESC LIMIT 50);
  RETURN 'completed';
END $$;
REVOKE ALL ON FUNCTION private.google_sheets_finish(uuid, uuid, integer, bigint, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.google_sheets_sync_runs DROP CONSTRAINT google_sheets_sync_runs_trigger_check;
DO $chk$
BEGIN
  IF EXISTS (SELECT 1 FROM public.google_sheets_sync_runs WHERE trigger = 'push') THEN
    ALTER TABLE public.google_sheets_sync_runs ADD CONSTRAINT google_sheets_sync_runs_trigger_check
      CHECK (trigger IN ('schedule','manual','activation')) NOT VALID;
  ELSE
    ALTER TABLE public.google_sheets_sync_runs ADD CONSTRAINT google_sheets_sync_runs_trigger_check
      CHECK (trigger IN ('schedule','manual','activation'));
  END IF;
END
$chk$;

DO $post$
BEGIN
  IF md5(pg_get_functiondef('private.google_sheets_finish(uuid,uuid,integer,bigint,text,jsonb)'::regprocedure))
       <> 'f1cf66bea7de1d469e2ff03c57f1a414' THEN
    RAISE EXCEPTION 'restored google_sheets_finish does not match the foundation preimage';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname IN ('public','private')
                AND (p.proname LIKE 'google\_sheets\_push\_%' OR p.proname LIKE 'google\_sheets\_watch\_%'
                     OR p.proname = 'google_sheets_ct_equal')) THEN
    RAISE EXCEPTION 'push functions remain';
  END IF;
END
$post$;
