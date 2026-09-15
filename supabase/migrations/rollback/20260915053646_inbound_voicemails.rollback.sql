-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- EXACT ROLLBACK for 20260915053646_inbound_voicemails.sql (M7)
-- Unschedules the sweep, drops the convergence functions, the voicemail RPCs, policies, object policy,
-- the `voicemails` table and calls.voicemail_id, and restores the pre-M7 notifications_type_check.
-- ⚠ Dropping public.voicemails loses voicemail metadata; the bucket and its objects are NOT deleted
-- here (media export/retention is an operator decision). Gate on zero stored voicemails or an export.
-- ⚠ NOT EXECUTED REMOTELY. Run inside a single transaction.
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
BEGIN;
-- Corrective pass 9: the extension test is its OWN statement, and every reference to `cron.job` /
-- `cron.unschedule` lives inside that branch. PL/pgSQL prepares an SQL expression when execution first
-- reaches it, so a single expression combining both tests still parses `cron.job` on a stack WITHOUT
-- pg_cron and fails with "schema cron does not exist" — which aborted this whole rollback. Nested
-- statements let the absent-extension branch skip those expressions entirely. Only the two jobs M7
-- created are unscheduled; any other cron job is left untouched.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'inbound-notify-sweep') THEN
      PERFORM cron.unschedule('inbound-notify-sweep');
    END IF;
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'inbound-route-attempt-sweep') THEN
      PERFORM cron.unschedule('inbound-route-attempt-sweep');
    END IF;
  ELSE
    RAISE NOTICE 'pg_cron not installed: no inbound sweep job to unschedule (local/dev stack)';
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.sweep_inbound_notifications(integer);
DROP FUNCTION IF EXISTS public.converge_inbound_notifications(uuid);
DROP FUNCTION IF EXISTS private.missed_call_label(text);
DROP FUNCTION IF EXISTS private.resolve_snapshot_recipients(uuid, uuid[]);
DROP FUNCTION IF EXISTS public.mark_voicemails_purged(uuid[]);
DROP FUNCTION IF EXISTS public.voicemails_expired_batch(uuid, timestamptz, timestamptz, integer);
DROP FUNCTION IF EXISTS public.voicemails_cleanup_batch(integer);
DROP FUNCTION IF EXISTS public.record_voicemail_cleanup_failure(text, text);
DROP FUNCTION IF EXISTS public.mark_voicemail_source_deleted(text);
DROP FUNCTION IF EXISTS public.upsert_voicemail_from_recording(text, uuid, uuid, uuid, text, text, integer, text, text);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'objects') THEN
    EXECUTE 'DROP POLICY IF EXISTS voicemail_objects_select ON storage.objects';
  END IF;
END $$;
DROP POLICY IF EXISTS voicemails_update_listened ON public.voicemails;
DROP POLICY IF EXISTS voicemails_select ON public.voicemails;
DROP FUNCTION IF EXISTS public.can_access_voicemail(uuid);
ALTER TABLE public.calls DROP COLUMN IF EXISTS voicemail_id;
DROP TABLE IF EXISTS public.voicemails;
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type = ANY (ARRAY['win','missed_call','lead_claimed','appointment_reminder','anniversary','system','inbound_sms','inbound_email']));
COMMIT;
