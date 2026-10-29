-- =====================================================================================================
-- ROLLBACK for pending/20261029120000_dashboard_milestone_reviews.sql (Gate G2)
-- STATUS: NEVER APPLIED. Run only with Chris's explicit approval, and only AFTER the frontend has been
-- rolled back or VITE_DASHBOARD_MILESTONE_REVIEWS has been unset (release order: frontend first).
--
-- Drops exactly what the forward migration created: two RPCs, the guard trigger and its function, the
-- table with its policies and indexes. What is lost is ONLY per-user reminder state (who marked which
-- Client Milestone reviewed or snoozed). No client, policy, payment, task, notification or other CRM
-- record is read or changed. The row count is reported before anything is dropped.
-- =====================================================================================================

SET lock_timeout = '2s';
SET statement_timeout = '60s';

DO $preflight$
DECLARE
  v_rows bigint;
BEGIN
  IF to_regclass('public.dashboard_milestone_reviews') IS NULL THEN
    RAISE EXCEPTION 'dashboard_milestone_reviews does not exist: nothing to roll back' USING ERRCODE = '42P01';
  END IF;
  EXECUTE 'SELECT count(*) FROM public.dashboard_milestone_reviews' INTO v_rows;
  RAISE NOTICE 'dashboard_milestone_reviews rollback: % review rows (reminder state only) will be removed', v_rows;
END
$preflight$;

DROP FUNCTION public.clear_dashboard_milestone_review(uuid, timestamptz);
DROP FUNCTION public.set_dashboard_milestone_review(text, uuid, text, date, text, timestamptz);
DROP TABLE public.dashboard_milestone_reviews;   -- its policies, indexes and trigger go with it
DROP FUNCTION private.dashboard_milestone_reviews_guard();
