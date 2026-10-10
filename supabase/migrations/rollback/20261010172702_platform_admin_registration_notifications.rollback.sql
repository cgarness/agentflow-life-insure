-- =====================================================================================================
-- ROLLBACK of 20261010200000_platform_admin_registration_notifications.sql.
-- Apply as a NEW migration only with Chris's exact approval.
--
-- Removes the schedule, both enqueue triggers, their functions, the worker RPCs and the queue table.
-- Signup and organization creation then behave byte-identically to before the feature: no other
-- object is touched (no RLS policy, grant or function outside this feature changes).
-- The queue holds ids and delivery metadata only (no PII snapshot). If its delivery history must be
-- kept for review, export it first (AGENT_RULES invariant #29) — dropping it is otherwise final.
-- =====================================================================================================
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
BEGIN
  IF to_regclass('public.platform_admin_notifications') IS NULL THEN
    RAISE EXCEPTION 'platform_admin_notifications does not exist; nothing to roll back (refusing replay)';
  END IF;
END $guard$;

DO $unschedule$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'platform-admin-notify-every-minute') THEN
      PERFORM cron.unschedule('platform-admin-notify-every-minute');
    END IF;
  END IF;
END $unschedule$;

DROP TRIGGER IF EXISTS trg_zz_platform_admin_notify_user_registered ON public.profiles;
DROP TRIGGER IF EXISTS trg_zz_platform_admin_notify_agency_created ON public.organizations;
DROP FUNCTION IF EXISTS private.enqueue_platform_admin_user_registered();
DROP FUNCTION IF EXISTS private.enqueue_platform_admin_agency_created();
DROP FUNCTION IF EXISTS public.claim_platform_admin_notifications(integer);
DROP FUNCTION IF EXISTS public.complete_platform_admin_notification(uuid, text, text, text);
DROP TABLE public.platform_admin_notifications;
