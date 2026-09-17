-- =====================================================================================================
-- ROLLBACK for M8 (20260917010000_voicemail_cleanup_actionable_selection.sql).
-- =====================================================================================================
-- Removes ONLY what M8 added. M7's `voicemails_cleanup_batch` was never modified, so after this rollback
-- the queue behaves exactly as it does under the currently deployed worker (v30) — including the
-- starvation defect M8 exists to correct. Roll the worker back to a build that calls
-- `voicemails_cleanup_batch` BEFORE running this, or the cleanup phase will report
-- `skipped / schema_unavailable` (SQLSTATE 42883) on every run: visible and harmless, but no cleanup.
--
-- Nothing here touches voicemail rows, obligations, counters, media or notification state.

DROP INDEX IF EXISTS public.idx_voicemails_cleanup_actionable;
DROP INDEX IF EXISTS public.idx_voicemails_cleanup_blocked;

DROP FUNCTION IF EXISTS public.voicemails_cleanup_blocked_summary(integer);
DROP FUNCTION IF EXISTS public.voicemails_cleanup_actionable_batch(integer);
