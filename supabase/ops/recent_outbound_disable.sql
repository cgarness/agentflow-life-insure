-- Recent-outbound callback routing — DISABLE everywhere (the first recovery step; implementation_plan.md §A11).
-- ⚠ Production needs Chris's exact approval like every production write (AGENT_RULES #28); it is the approved stop rule.
-- One transaction:  psql -v ON_ERROR_STOP=1 -f supabase/ops/recent_outbound_disable.sql
-- Sets enabled = false AND unanswered_eligible = false on EVERY configuration row, deletes nothing (the rows and the
-- did_allowlist stay), and asserts that no row is enabled or unanswered-eligible afterwards. Returns the rows it
-- changed. Idempotent (a re-run changes nothing). Effective for the next planned call: plan_inbound_route reads the
-- switch per call; attempts already committed keep their decision.
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';
CREATE TEMP TABLE ro_ops_result (
  organization_id uuid, changed boolean, enabled boolean, unanswered_eligible boolean, did_allowlist text[], updated_at timestamptz
) ON COMMIT DROP;
DO $ops$
DECLARE v_left integer;
BEGIN
  IF to_regclass('private.recent_outbound_routing_orgs') IS NULL THEN
    RAISE EXCEPTION 'recent_outbound disable: configuration table missing (migration 20260927052736 not applied here); nothing to disable';
  END IF;
  WITH changed AS (
    UPDATE private.recent_outbound_routing_orgs cfg
       SET enabled = false, unanswered_eligible = false, updated_at = now()
     WHERE cfg.enabled OR cfg.unanswered_eligible
    RETURNING cfg.organization_id, cfg.enabled, cfg.unanswered_eligible, cfg.did_allowlist, cfg.updated_at
  )
  INSERT INTO pg_temp.ro_ops_result
  SELECT ch.organization_id, true, ch.enabled, ch.unanswered_eligible, ch.did_allowlist, ch.updated_at FROM changed ch;

  SELECT count(*)::integer INTO v_left FROM private.recent_outbound_routing_orgs cfg WHERE cfg.enabled OR cfg.unanswered_eligible;
  IF v_left <> 0 THEN
    RAISE EXCEPTION 'recent_outbound disable: % row(s) still enabled or unanswered-eligible; rolled back', v_left;
  END IF;
  RAISE NOTICE 'recent_outbound disable: % row(s) changed; 0 enabled', (SELECT count(*) FROM pg_temp.ro_ops_result);
END;
$ops$;
SELECT * FROM pg_temp.ro_ops_result;
COMMIT;
