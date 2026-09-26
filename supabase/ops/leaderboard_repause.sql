-- Emergency re-pause template; apply only as a NEW, explicitly approved migration.
-- Accept only the exact guarded definition. Preserve the guard and all metadata.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';
DO $repause$
DECLARE
  target oid := to_regprocedure('public.get_org_leaderboard_stats(timestamptz,timestamptz)');
  original text;
  original_meta jsonb;
  current_meta jsonb;
  marker text := E'  -- AF_INCIDENT_LEADERBOARD_PAUSE_20260923_BEGIN\n  RAISE SQLSTATE ''PT503'' USING\n    MESSAGE = ''Standings temporarily paused'',\n    HINT = ''Leaderboard maintenance is in progress. Avoid repeated retries.'';\n  -- AF_INCIDENT_LEADERBOARD_PAUSE_20260923_END\n\n';
  needle text := E'  SELECT pr.organization_id INTO v_org\n';
BEGIN
  IF target IS NULL THEN RAISE EXCEPTION 'Leaderboard target missing'; END IF;
  SELECT pg_get_functiondef(target), jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,'security_definer',prosecdef,'volatility',provolatile,'return_type',prorettype,'argument_types',proargtypes::text)
  INTO original, original_meta FROM pg_catalog.pg_proc WHERE oid=target;
  IF md5(original) <> '8af04a4deed619788ee803df90d59205' THEN
    RAISE EXCEPTION 'Guarded leaderboard definition changed; refusing re-pause';
  END IF;
  IF (SELECT proowner <> 'postgres'::regrole
      OR proacl IS DISTINCT FROM ARRAY['postgres=X/postgres','authenticated=X/postgres','service_role=X/postgres']::aclitem[]
      FROM pg_catalog.pg_proc WHERE oid = target) THEN
    RAISE EXCEPTION 'Leaderboard owner or ACL changed; refusing re-pause';
  END IF;
  IF (length(original)-length(replace(original,needle,'')))/length(needle) <> 1 THEN
    RAISE EXCEPTION 'Pause insertion point changed';
  END IF;
  EXECUTE replace(original,needle,marker || needle);
  SELECT jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,'security_definer',prosecdef,'volatility',provolatile,'return_type',prorettype,'argument_types',proargtypes::text)
  INTO current_meta FROM pg_catalog.pg_proc WHERE oid=target;
  IF current_meta IS DISTINCT FROM original_meta THEN
    RAISE EXCEPTION 'Unexpected re-pause metadata change; rolling back';
  END IF;
  IF md5(pg_get_functiondef(target)) <> '75eec092f7039c2c8cb0cca93e93d1ae'
     OR replace(pg_get_functiondef(target),marker,'') <> original THEN
    RAISE EXCEPTION 'Unexpected re-pause difference; rolling back';
  END IF;
END;
$repause$;
