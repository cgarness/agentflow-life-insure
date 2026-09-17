-- =====================================================================================================
-- M8 — Inbound Calling v2: actionable selection for the voicemail source-cleanup queue.
-- NOT YET APPLIED ANYWHERE. Local/dev only until a separate approval.
-- =====================================================================================================
-- THE DEFECT THIS CORRECTS (independent reproduction against the deployed v30 worker):
--   `voicemails_cleanup_batch` selects due rows `ORDER BY created_at ASC LIMIT 100` with no filter on
--   whether the owning provider account is even known. A row whose `provider_account_sid` is absent or
--   malformed is deliberately left COMPLETELY untouched by the worker — no provider request, no failure
--   record, no attempt increment, no backoff — because guessing an owner would delete the wrong account's
--   media and advancing the attempt counter would silently retire the obligation at M7's 50-attempt
--   ceiling. Correct in isolation, but it makes such rows IMMORTAL at the head of the queue: every batch
--   returns the same prefix, the worker's in-pass no-progress guard stops the invocation, and actionable
--   rows behind them are never reached on any run. Reproduced at 100 blocked rows (total starvation) and
--   at 99 (proportional starvation: one actionable row per invocation instead of 1000).
--
-- THE CORRECTION, and what it deliberately does NOT do:
--   A second, narrower selection returns only rows whose owner is ESTABLISHED, so an arbitrary prefix of
--   unresolvable rows can never hide actionable work behind it. Nothing about blocked rows changes:
--     * their `source_cleanup_state`, `source_cleanup_attempts`, `source_cleanup_next_at` and
--       `source_cleanup_error` are untouched — the obligation is preserved, not retired;
--     * no owner is ever guessed or substituted;
--     * they are NOT silently dropped: `voicemails_cleanup_blocked_summary` reports them so the worker
--       can say "the actionable queue is empty AND N rows are blocked" instead of "the queue is empty".
--   The moment a legitimate signed callback establishes and persists an owner (twilio-recording-status
--   v36's durable ownership recovery), the row matches the actionable predicate again with no further
--   intervention — recovery is a data change, not a queue operation.
--
--   This is NOT a new queue architecture, and NOT a larger batch: batch size, the 500 clamp, the
--   50-attempt ceiling, the backoff, `ORDER BY created_at ASC` and the rest of M7 are unchanged. It is
--   also NOT offset pagination — there is no blocked prefix left to page past, so nothing restarts at
--   the same stuck rows next invocation.
--
-- COMPATIBILITY / DEPLOYMENT ORDER:
--   `voicemails_cleanup_batch` is left exactly as M7 defined it, so the CURRENTLY DEPLOYED worker
--   (recording-retention-purge v30) keeps working unchanged after this migration is applied. Apply this
--   migration FIRST, then deploy the corrected worker, which calls the two functions added here. If the
--   worker were deployed first it would receive SQLSTATE 42883 and report the cleanup phase
--   `skipped/schema_unavailable` — visible and harmless, but the ordering above avoids it.

-- ── Actionable due rows: identical to M7's predicate plus an ESTABLISHED owner ───────────────────────
-- NULL `provider_account_sid` yields NULL from `~`, which is not true, so unowned rows are excluded
-- without a separate IS NOT NULL test.
CREATE OR REPLACE FUNCTION public.voicemails_cleanup_actionable_batch(p_limit integer DEFAULT 100)
RETURNS TABLE (id uuid, organization_id uuid, recording_sid text, source_cleanup_attempts integer, provider_account_sid text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT v.id, v.organization_id, v.recording_sid, v.source_cleanup_attempts, v.provider_account_sid
    FROM public.voicemails v
   WHERE v.status IN ('stored','purged') AND v.source_cleanup_state <> 'deleted'
     AND v.source_cleanup_attempts < 50
     AND (v.source_cleanup_next_at IS NULL OR v.source_cleanup_next_at <= now())
     AND v.provider_account_sid ~ '^AC[0-9a-fA-F]{32}$'
   ORDER BY v.created_at ASC
   LIMIT least(greatest(coalesce(p_limit, 100), 1), 500);
$$;

-- ── Blocked work, reported rather than hidden ───────────────────────────────────────────────────────
-- `blocked_due`   rows the actionable selection just skipped and that are due NOW.
-- `blocked_total` every row still owing a source deletion whose owner cannot be established, whatever
--                 its backoff — the true size of the operator-attention backlog.
-- `blocked_orgs`  how many organizations they span (a single organization's bad data cannot be read as
--                 a platform-wide fault).
-- The scan is bounded so this can never become the expensive part of a nightly pass; `scan_capped`
-- says plainly when the real numbers are larger than the ones returned.
CREATE OR REPLACE FUNCTION public.voicemails_cleanup_blocked_summary(p_scan_limit integer DEFAULT 5000)
RETURNS TABLE (blocked_due integer, blocked_total integer, blocked_orgs integer,
               oldest_blocked_at timestamptz, scan_capped boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  WITH lim AS (
    SELECT least(greatest(coalesce(p_scan_limit, 5000), 1), 50000) AS n
  ), scanned AS (
    SELECT v.organization_id,
           v.created_at,
           (v.source_cleanup_next_at IS NULL OR v.source_cleanup_next_at <= now()) AS is_due
      FROM public.voicemails v
     WHERE v.status IN ('stored','purged') AND v.source_cleanup_state <> 'deleted'
       AND v.source_cleanup_attempts < 50
       AND (v.provider_account_sid IS NULL OR v.provider_account_sid !~ '^AC[0-9a-fA-F]{32}$')
     ORDER BY v.created_at ASC
     LIMIT (SELECT n + 1 FROM lim)
  ), capped AS (
    SELECT (SELECT count(*) FROM scanned) > (SELECT n FROM lim) AS over
  ), kept AS (
    SELECT * FROM scanned ORDER BY created_at ASC LIMIT (SELECT n FROM lim)
  )
  SELECT count(*) FILTER (WHERE is_due)::integer,
         count(*)::integer,
         count(DISTINCT organization_id)::integer,
         min(created_at),
         (SELECT over FROM capped)
    FROM kept;
$$;

-- Same privilege shape as every other M7 cleanup helper: service_role only, nothing for PUBLIC/anon/
-- authenticated, search_path pinned, SECURITY DEFINER.
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.voicemails_cleanup_actionable_batch(integer)',
    'public.voicemails_cleanup_blocked_summary(integer)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

-- Keeps the actionable scan off the blocked prefix rather than filtering it out row by row. Plain
-- CREATE INDEX (not CONCURRENTLY) is deliberate and safe here: `voicemails` holds 0 rows in production,
-- so the ACCESS EXCLUSIVE lock is momentary. Revisit if that ever stops being true.
CREATE INDEX IF NOT EXISTS idx_voicemails_cleanup_actionable
  ON public.voicemails (created_at)
  WHERE status IN ('stored','purged')
    AND source_cleanup_state <> 'deleted'
    AND source_cleanup_attempts < 50
    AND provider_account_sid ~ '^AC[0-9a-fA-F]{32}$';

-- And the mirror image, so the blocked summary is equally cheap.
CREATE INDEX IF NOT EXISTS idx_voicemails_cleanup_blocked
  ON public.voicemails (created_at)
  WHERE status IN ('stored','purged')
    AND source_cleanup_state <> 'deleted'
    AND source_cleanup_attempts < 50
    AND (provider_account_sid IS NULL OR provider_account_sid !~ '^AC[0-9a-fA-F]{32}$');

COMMENT ON FUNCTION public.voicemails_cleanup_actionable_batch(integer) IS
  'Due source-cleanup rows whose owning provider account is ESTABLISHED. Unowned rows are excluded here '
  'and reported by voicemails_cleanup_blocked_summary; they are never modified, never guessed at, and '
  'become eligible again the moment a signed callback persists their owner.';
COMMENT ON FUNCTION public.voicemails_cleanup_blocked_summary(integer) IS
  'Bounded count of source-cleanup obligations whose owning provider account cannot be established, so '
  'the worker reports blocked work instead of claiming an empty queue. scan_capped = the real numbers '
  'are larger than those returned.';
