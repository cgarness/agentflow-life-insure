-- Emergency rollback: retain the concurrency guard and re-pause expensive work.
-- Apply as a NEW migration only, after verifying the current incident state.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';
DO $repause$
DECLARE
  target oid := to_regprocedure('public.get_org_leaderboard_stats(timestamptz,timestamptz)');
  original text := pg_get_functiondef(target);
  marker text := E'  -- AF_INCIDENT_LEADERBOARD_PAUSE_20260923_BEGIN\n  RAISE SQLSTATE ''PT503'' USING\n    MESSAGE = ''Standings temporarily paused'',\n    HINT = ''Leaderboard maintenance is in progress. Avoid repeated retries.'';\n  -- AF_INCIDENT_LEADERBOARD_PAUSE_20260923_END\n\n';
  needle text := E'  SELECT pr.organization_id INTO v_org\n';
BEGIN
  IF original IS NULL OR position('AF_LEADERBOARD_CONCURRENCY_GUARD_V1_BEGIN' IN original)=0 THEN
    RAISE EXCEPTION 'Guarded leaderboard not found; refusing rollback';
  END IF;
  IF position('AF_INCIDENT_LEADERBOARD_PAUSE_20260923_BEGIN' IN original)>0 THEN
    RAISE EXCEPTION 'Leaderboard already paused; do not replay rollback';
  END IF;
  IF (length(original)-length(replace(original,needle,'')))/length(needle)<>1 THEN
    RAISE EXCEPTION 'Pause insertion point changed';
  END IF;
  EXECUTE replace(original,needle,marker || needle);
  IF replace(pg_get_functiondef(target),marker,'') <> original THEN
    RAISE EXCEPTION 'Unexpected rollback difference';
  END IF;
END;
$repause$;
