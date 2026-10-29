-- =====================================================================================================
-- ROLLBACK for pending/20261029200000_dashboard_attention_clearances.sql (Gate G3)
-- STATUS: NEVER APPLIED. Run only with Chris's explicit approval, and only AFTER the frontend has been
-- rolled back or VITE_DASHBOARD_ATTENTION_CLEARANCES has been unset (release order: frontend first).
--
-- Drops exactly what the forward migration created: two RPCs, the guard trigger and its function, the
-- table with its policies and indexes. What is lost is ONLY per-user Dashboard "Clear" state (which
-- missed calls and callbacks each user hid from their own Dashboard); those items simply reappear.
-- No call, voicemail, campaign lead, appointment, notification or other record is read or changed.
--
-- It REFUSES while any clearance row exists, unless the session first confirms the loss explicitly:
--   SET dashboard_attention.rollback_discard_rows = 'confirmed';
-- =====================================================================================================

SET lock_timeout = '2s';
SET statement_timeout = '60s';

DO $preflight$
DECLARE
  v_rows bigint;
BEGIN
  IF to_regclass('public.dashboard_attention_clearances') IS NULL THEN
    RAISE EXCEPTION 'dashboard_attention_clearances does not exist: nothing to roll back' USING ERRCODE = '42P01';
  END IF;
  -- Blocks new clearances while the decision is made; released at commit.
  LOCK TABLE public.dashboard_attention_clearances IN ACCESS EXCLUSIVE MODE;
  EXECUTE 'SELECT count(*) FROM public.dashboard_attention_clearances' INTO v_rows;
  RAISE NOTICE 'dashboard_attention_clearances rollback: % clearance rows (Dashboard state only)', v_rows;
  IF v_rows > 0 AND coalesce(current_setting('dashboard_attention.rollback_discard_rows', true), '') <> 'confirmed' THEN
    RAISE EXCEPTION 'Refusing to drop % clearance rows without dashboard_attention.rollback_discard_rows = confirmed', v_rows
      USING ERRCODE = '55000';
  END IF;
END
$preflight$;

DROP FUNCTION public.undo_dashboard_attention_clear(uuid, timestamptz);
DROP FUNCTION public.clear_dashboard_attention_item(text, uuid, timestamptz);
DROP TABLE public.dashboard_attention_clearances;   -- its policies, indexes and trigger go with it
DROP FUNCTION private.dashboard_attention_clearances_guard();
