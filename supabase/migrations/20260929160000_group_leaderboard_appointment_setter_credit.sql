-- Group leaderboard "Appointments Set" = setter credit. Production requires Chris's separate exact approval.
-- Changes ONE predicate: ap.user_id = p.id  ->  COALESCE(ap.created_by, ap.user_id) = p.id (AGENT_RULES #23 / #38).
-- Standalone NEW migration only; refuses a drifted definition, owner or ACL, and a replay; preserves all metadata.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';
DO $group_setter$
DECLARE
  target oid := to_regprocedure('public.get_agency_group_leaderboard(uuid,text)');
  original text;
  replacement text;
  original_meta jsonb;
  current_meta jsonb;
  needle text := E'    WHERE ap.user_id = p.id\n';
  substitute text := E'    WHERE COALESCE(ap.created_by, ap.user_id) = p.id\n';
BEGIN
  IF target IS NULL THEN RAISE EXCEPTION 'Group leaderboard target missing'; END IF;
  -- proargdefaults stores the default's source-text offset, which any re-creation moves; its meaning is
  -- compared through pg_get_function_arguments (which renders the DEFAULT) instead.
  SELECT pg_get_functiondef(p.oid),
         (to_jsonb(p) - 'prosrc' - 'proargdefaults') || jsonb_build_object('arguments', pg_get_function_arguments(p.oid))
    INTO original, original_meta FROM pg_catalog.pg_proc p WHERE p.oid = target;
  IF md5(original) <> 'e1283b5b05d295c1d25888485cc08346' THEN
    RAISE EXCEPTION 'Group leaderboard definition changed; refusing appointment setter credit';
  END IF;
  IF (SELECT proowner <> 'postgres'::regrole
      OR proacl IS DISTINCT FROM ARRAY['=X/postgres','postgres=X/postgres','anon=X/postgres','authenticated=X/postgres','service_role=X/postgres']::aclitem[]
      FROM pg_catalog.pg_proc WHERE oid = target) THEN
    RAISE EXCEPTION 'Group leaderboard owner or ACL changed; refusing appointment setter credit';
  END IF;
  IF (length(original) - length(replace(original, needle, ''))) / length(needle) <> 1 THEN
    RAISE EXCEPTION 'Group leaderboard appointment predicate not unique';
  END IF;
  replacement := replace(original, needle, substitute);
  EXECUTE replacement;
  SELECT (to_jsonb(p) - 'prosrc' - 'proargdefaults') || jsonb_build_object('arguments', pg_get_function_arguments(p.oid))
    INTO current_meta FROM pg_catalog.pg_proc p WHERE p.oid = target;
  IF current_meta IS DISTINCT FROM original_meta THEN
    RAISE EXCEPTION 'Unexpected metadata change; rolling back appointment setter credit';
  END IF;
  IF pg_get_functiondef(target) <> replacement
     OR md5(pg_get_functiondef(target)) <> 'e69bbcf6a9f47457a44c887cb4418aef' THEN
    RAISE EXCEPTION 'Unexpected body change; rolling back appointment setter credit';
  END IF;
END;
$group_setter$;
