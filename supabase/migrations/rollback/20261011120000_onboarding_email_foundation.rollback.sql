-- =====================================================================================================
-- ROLLBACK of 20261011120000_onboarding_email_foundation.sql (prepared, NOT applied anywhere).
-- Never applied automatically: this directory is outside the CLI migration glob.
--
-- WARNING: dropping the tables deletes onboarding delivery history and users' opt-out choices.
-- In production that is a destructive data change (AGENT_RULES invariant #28) and needs Chris's
-- separate, exact approval. Prefer supabase/ops/onboarding_emails_disable.sql, which stops
-- everything and deletes nothing.
--
-- Fails closed: refuses while the program is enabled or while the worker is scheduled.
-- =====================================================================================================
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
BEGIN
  IF to_regclass('public.onboarding_email_program') IS NULL THEN
    RAISE EXCEPTION 'onboarding email foundation is not installed; refusing replay';
  END IF;
  IF EXISTS (SELECT 1 FROM public.onboarding_email_program WHERE enabled) THEN
    RAISE EXCEPTION 'program is enabled; run supabase/ops/onboarding_emails_disable.sql first';
  END IF;
  IF to_regnamespace('cron') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'onboarding-email-worker-every-minute') THEN
      RAISE EXCEPTION 'worker is scheduled; run supabase/ops/onboarding_emails_unschedule.sql first';
    END IF;
  END IF;
END $guard$;

DROP FUNCTION public.set_my_onboarding_email_opt_out(boolean);
DROP FUNCTION public.get_my_email_subscriptions();
DROP FUNCTION public.record_onboarding_email_opt_out(uuid, text);
DROP FUNCTION public.complete_onboarding_email_delivery(uuid, text, text, text, text);
DROP FUNCTION public.get_onboarding_email_context(uuid);
DROP FUNCTION public.claim_onboarding_email_deliveries(integer);
DROP FUNCTION public.onboarding_email_enroll_due(integer);
DROP FUNCTION private.onboarding_email_cancel_user(uuid, text);
DROP FUNCTION private.onboarding_email_settle(uuid[]);
DROP FUNCTION private.onboarding_email_slot(timestamptz, integer, text, integer);
DROP FUNCTION private.onboarding_email_valid_time_zone(text);

DROP TABLE public.user_email_subscriptions;
DROP TABLE public.onboarding_email_delivery_attempts;
DROP TABLE public.onboarding_email_deliveries;
DROP TABLE public.onboarding_email_enrollments;
DROP TABLE public.onboarding_email_steps;
DROP TABLE public.onboarding_email_program;
