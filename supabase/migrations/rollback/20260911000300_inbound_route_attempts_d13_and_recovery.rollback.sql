-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260911000300_inbound_route_attempts_d13_and_recovery.sql (M6)
--
-- ⚠ DELIBERATELY PARTIAL — the D13 finalize replacement is NOT reverted here.
-- Restoring the 20260823222805 body of finalize_inbound_call_terminal would restore a writer that
-- CLEARS existing "Missed in AgentFlow — forwarded to mobile" classifications (its p_external_answer
-- branch set is_missed=false). Per Chris's implementation approval (2026-09-10, safeguard 4) such a
-- writer must not be restored. The M6 body is therefore kept; it is a strict superset of the old
-- behavior except for that retraction and is safe for legacy-engine calls.
--
-- Dropping the tables/columns below discards v2 routing evidence and D13 attribution columns
-- (missed_reason / missed_for_agent_id / missed_recipient_ids) — is_missed itself is untouched.
-- Requires M7 rolled back first (voicemails references inbound_route_attempts).
-- ⚠ NOT EXECUTED REMOTELY. Run inside a single transaction.
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
BEGIN;
DROP FUNCTION IF EXISTS public.record_inbound_mobile_leg_end(uuid, uuid, text, text, integer);
DROP FUNCTION IF EXISTS public.record_inbound_mobile_bridge(uuid, uuid, uuid, uuid, boolean, text, text, integer);
DROP FUNCTION IF EXISTS public.record_inbound_mobile_accept(uuid, uuid, uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.append_inbound_provider_outcome(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.advance_inbound_route_stage(uuid, uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS private.bounded_outcomes(jsonb, jsonb);
DROP FUNCTION IF EXISTS public.advance_to_owner_mobile(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.plan_inbound_route(uuid, uuid, uuid, text, uuid[], integer);
DROP FUNCTION IF EXISTS private.commit_owner_mobile(uuid, uuid, uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.mark_inbound_missed(uuid, uuid, text, uuid[], uuid);
DROP FUNCTION IF EXISTS public.is_agent_busy(uuid, uuid, uuid);
DROP INDEX IF EXISTS public.idx_calls_missed_notify_owed;
DROP INDEX IF EXISTS public.idx_calls_missed_recipients;
DROP INDEX IF EXISTS public.idx_calls_missed_for_agent;
ALTER TABLE public.calls DROP CONSTRAINT IF EXISTS calls_missed_reason_check;
ALTER TABLE public.calls
  DROP COLUMN IF EXISTS missed_notify_error,
  DROP COLUMN IF EXISTS missed_notify_next_at,
  DROP COLUMN IF EXISTS missed_notify_attempts,
  DROP COLUMN IF EXISTS missed_notified_at,
  DROP COLUMN IF EXISTS missed_recipient_ids,
  DROP COLUMN IF EXISTS missed_for_agent_id,
  DROP COLUMN IF EXISTS missed_reason,
  DROP COLUMN IF EXISTS answered_by_agent_id;
DROP TABLE IF EXISTS public.inbound_route_attempts;
COMMIT;
