-- Emergency containment approved by Chris, 2026-09-23.
-- This adds no objects and changes no data, privileges, signatures or RLS.
-- Apply through Supabase apply_migration, never an ad-hoc DDL executor.
SET LOCAL lock_timeout = '2s';
DO $containment$
DECLARE
  target oid := to_regprocedure('public.get_org_leaderboard_stats(timestamptz,timestamptz)');
  original text;
  replacement text;
  original_meta jsonb;
  current_meta jsonb;
  marker text := E'  -- AF_INCIDENT_LEADERBOARD_PAUSE_20260923_BEGIN\n  RAISE SQLSTATE ''PT503'' USING\n    MESSAGE = ''Standings temporarily paused'',\n    HINT = ''Leaderboard maintenance is in progress. Avoid repeated retries.'';\n  -- AF_INCIDENT_LEADERBOARD_PAUSE_20260923_END\n\n';
  needle text := E'  SELECT pr.organization_id INTO v_org\n';
BEGIN
  IF target IS NULL THEN RAISE EXCEPTION 'Leaderboard target missing; no changes applied'; END IF;
  SELECT pg_get_functiondef(target), jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,'security_definer',prosecdef,'volatility',provolatile,'return_type',prorettype,'argument_types',proargtypes::text)
  INTO original, original_meta FROM pg_proc WHERE oid=target;
  IF md5(original) <> 'd26a38b59de90db91ed777236ee4acc4' THEN
    RAISE EXCEPTION 'Leaderboard definition changed; refusing emergency patch';
  END IF;
  IF (length(original)-length(replace(original,needle,'')))/length(needle) <> 1 THEN
    RAISE EXCEPTION 'Leaderboard patch location not unique';
  END IF;
  replacement := replace(original,needle,marker || needle);
  EXECUTE replacement;
  SELECT jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,'security_definer',prosecdef,'volatility',provolatile,'return_type',prorettype,'argument_types',proargtypes::text)
  INTO current_meta FROM pg_proc WHERE oid=target;
  IF current_meta IS DISTINCT FROM original_meta THEN
    RAISE EXCEPTION 'Unexpected metadata change; rolling back';
  END IF;
  IF md5(replace(pg_get_functiondef(target),marker,'')) <> 'd26a38b59de90db91ed777236ee4acc4' THEN
    RAISE EXCEPTION 'Unexpected function change; rolling back';
  END IF;
END;
$containment$;
