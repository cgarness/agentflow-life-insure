-- Permanent leaderboard backpressure. Apply only after frontend verification.
-- No data, signature, security, ACL, or canonical metric changes.
-- This source is copied to a CLI-generated migration and reconciled to the
-- apply_migration version returned by Supabase; do not replay an applied version.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';
DO $recovery$
DECLARE
  target oid := to_regprocedure('public.get_org_leaderboard_stats(timestamptz,timestamptz)');
  original text;
  clean text;
  replacement text;
  original_meta jsonb;
  current_meta jsonb;
  pause_marker text := E'  -- AF_INCIDENT_LEADERBOARD_PAUSE_20260923_BEGIN\n  RAISE SQLSTATE ''PT503'' USING\n    MESSAGE = ''Standings temporarily paused'',\n    HINT = ''Leaderboard maintenance is in progress. Avoid repeated retries.'';\n  -- AF_INCIDENT_LEADERBOARD_PAUSE_20260923_END\n\n';
  guard_marker text := E'  -- AF_LEADERBOARD_CONCURRENCY_GUARD_V1_BEGIN\n  -- A busy organization receives a retryable response; it never queues behind\n  -- another standings aggregate or locks CRM rows. Transaction end releases it.\n  IF NOT pg_catalog.pg_try_advisory_xact_lock(\n    pg_catalog.hashtextextended(''agentflow:leaderboard:v1:'' || v_org::text, 0)\n  ) THEN\n    RAISE SQLSTATE ''PT429'' USING\n      MESSAGE = ''Standings are busy'',\n      HINT = ''Retry after the client cooldown; do not overlap refreshes.'';\n  END IF;\n  -- AF_LEADERBOARD_CONCURRENCY_GUARD_V1_END\n\n';
  needle text := '  -- Each source table is scanned ONCE';
BEGIN
  IF target IS NULL THEN RAISE EXCEPTION 'Leaderboard target missing'; END IF;
  SELECT pg_get_functiondef(target), jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,'security_definer',prosecdef,'volatility',provolatile,'return_type',prorettype,'argument_types',proargtypes::text)
  INTO original, original_meta FROM pg_proc WHERE oid=target;
  IF md5(original) NOT IN ('d26a38b59de90db91ed777236ee4acc4','1314cefc781ff326540b83f748d48046') THEN
    RAISE EXCEPTION 'Leaderboard definition changed; refusing patch';
  END IF;
  clean := replace(original,pause_marker,'');
  IF md5(clean) <> 'd26a38b59de90db91ed777236ee4acc4' THEN
    RAISE EXCEPTION 'Unexpected pause marker; refusing patch';
  END IF;
  IF (length(clean)-length(replace(clean,needle,'')))/length(needle) <> 1 THEN
    RAISE EXCEPTION 'Leaderboard guard location not unique';
  END IF;
  replacement := replace(clean,needle,guard_marker || needle);
  EXECUTE replacement;
  SELECT jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,'security_definer',prosecdef,'volatility',provolatile,'return_type',prorettype,'argument_types',proargtypes::text)
  INTO current_meta FROM pg_proc WHERE oid=target;
  IF current_meta IS DISTINCT FROM original_meta THEN
    RAISE EXCEPTION 'Unexpected security or signature change; rolling back';
  END IF;
  IF md5(replace(pg_get_functiondef(target),guard_marker,'')) <> 'd26a38b59de90db91ed777236ee4acc4' THEN
    RAISE EXCEPTION 'Unexpected metric/body change; rolling back';
  END IF;
END;
$recovery$;
