-- =====================================================================================================
-- Onboarding email series — disable. NOT RUN. Kill switch (§11); needs approval, run as a NEW migration.
-- Stops new enrollment and every claim at once. Deletes nothing: queued rows, history, opt-outs, the
-- watermark and the pilot list are kept for review (invariant #28).
-- =====================================================================================================
DO $disable$
BEGIN
  IF to_regclass('public.onboarding_email_program') IS NULL THEN
    RAISE EXCEPTION 'onboarding email foundation is not applied';
  END IF;
  UPDATE public.onboarding_email_program SET enabled = false, updated_at = now() WHERE id = 1;
END $disable$;
