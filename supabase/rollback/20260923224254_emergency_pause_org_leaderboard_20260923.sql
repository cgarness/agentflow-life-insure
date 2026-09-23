-- Run ONLY after deliberate approval to resume leaderboard computation.
-- Apply as a new migration; never edit the applied containment history.
SET LOCAL lock_timeout = '2s';
DO $restore$
DECLARE
  target oid := to_regprocedure('public.get_org_leaderboard_stats(timestamptz,timestamptz)');
  paused text;
  restored text;
  marker text := E'  -- AF_INCIDENT_LEADERBOARD_PAUSE_20260923_BEGIN\n  RAISE SQLSTATE ''PT503'' USING\n    MESSAGE = ''Standings temporarily paused'',\n    HINT = ''Leaderboard maintenance is in progress. Avoid repeated retries.'';\n  -- AF_INCIDENT_LEADERBOARD_PAUSE_20260923_END\n\n';
BEGIN
  IF target IS NULL THEN RAISE EXCEPTION 'Target missing'; END IF;
  paused := pg_get_functiondef(target);
  restored := replace(paused, marker, '');
  IF paused = restored OR md5(restored) <> 'd26a38b59de90db91ed777236ee4acc4' THEN
    RAISE EXCEPTION 'Function changed since containment; review before restoring';
  END IF;
  EXECUTE restored;
  IF md5(pg_get_functiondef(target)) <> 'd26a38b59de90db91ed777236ee4acc4' THEN
    RAISE EXCEPTION 'Restoration mismatch; rolling back';
  END IF;
END;
$restore$;
