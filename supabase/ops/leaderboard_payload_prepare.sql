-- Organization leaderboard payload prepare. Production requires separate exact approval.
-- Standalone NEW migration only; refuse drift/replay and preserve complete metadata.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';
DO $payload$
DECLARE
  target oid := to_regprocedure('public.get_org_leaderboard_stats(timestamptz,timestamptz)');
  original text;
  replacement text;
  original_meta jsonb;
  current_meta jsonb;
  needle text := E'    p.avatar_url,\n';
  substitute text := E'    NULL::text,\n';
BEGIN
  IF target IS NULL THEN RAISE EXCEPTION 'Leaderboard target missing'; END IF;
  SELECT pg_get_functiondef(p.oid), to_jsonb(p) - 'prosrc'
    INTO original, original_meta FROM pg_catalog.pg_proc p WHERE p.oid = target;
  IF md5(original) <> '75eec092f7039c2c8cb0cca93e93d1ae' THEN
    RAISE EXCEPTION 'Leaderboard definition changed; refusing payload prepare';
  END IF;
  IF (SELECT proowner <> 'postgres'::regrole
      OR proacl IS DISTINCT FROM ARRAY['postgres=X/postgres','authenticated=X/postgres','service_role=X/postgres']::aclitem[]
      FROM pg_catalog.pg_proc WHERE oid = target) THEN
    RAISE EXCEPTION 'Leaderboard owner or ACL changed; refusing payload prepare';
  END IF;
  IF (length(original) - length(replace(original, needle, ''))) / length(needle) <> 1 THEN
    RAISE EXCEPTION 'Leaderboard payload replacement location not unique';
  END IF;
  replacement := replace(original, needle, substitute);
  EXECUTE replacement;
  SELECT to_jsonb(p) - 'prosrc' INTO current_meta FROM pg_catalog.pg_proc p WHERE p.oid = target;
  IF current_meta IS DISTINCT FROM original_meta THEN
    RAISE EXCEPTION 'Unexpected metadata change; rolling back payload prepare';
  END IF;
  IF pg_get_functiondef(target) <> replacement
     OR md5(pg_get_functiondef(target)) <> '41615c590703650c27ed41d164bcbfe4' THEN
    RAISE EXCEPTION 'Unexpected body change; rolling back payload prepare';
  END IF;
END;
$payload$;
