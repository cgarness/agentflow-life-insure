-- ROLLBACK for 20260929160000_group_leaderboard_appointment_setter_credit.sql — NOT a forward migration.
-- STATUS: prepared, never applied. Apply only with Chris's separate exact approval, as a NEW migration.
-- Restores the single predicate COALESCE(ap.created_by, ap.user_id) = p.id  ->  ap.user_id = p.id, i.e. the
-- pre-migration definition (md5 e1283b5b05d295c1d25888485cc08346). Refuses anything but the exact post-image,
-- owner and ACL; preserves all other metadata; a replay refuses.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';
DO $group_setter_rollback$
DECLARE
  target oid := to_regprocedure('public.get_agency_group_leaderboard(uuid,text)');
  original text;
  replacement text;
  original_meta jsonb;
  current_meta jsonb;
  needle text := E'    WHERE COALESCE(ap.created_by, ap.user_id) = p.id\n';
  substitute text := E'    WHERE ap.user_id = p.id\n';
BEGIN
  IF target IS NULL THEN RAISE EXCEPTION 'Group leaderboard target missing'; END IF;
  SELECT pg_get_functiondef(p.oid),
         (to_jsonb(p) - 'prosrc' - 'proargdefaults') || jsonb_build_object('arguments', pg_get_function_arguments(p.oid))
    INTO original, original_meta FROM pg_catalog.pg_proc p WHERE p.oid = target;
  IF md5(original) <> 'e69bbcf6a9f47457a44c887cb4418aef' THEN
    RAISE EXCEPTION 'Group leaderboard definition is not the setter-credit version; refusing rollback';
  END IF;
  IF (SELECT proowner <> 'postgres'::regrole
      OR proacl IS DISTINCT FROM ARRAY['=X/postgres','postgres=X/postgres','anon=X/postgres','authenticated=X/postgres','service_role=X/postgres']::aclitem[]
      FROM pg_catalog.pg_proc WHERE oid = target) THEN
    RAISE EXCEPTION 'Group leaderboard owner or ACL changed; refusing rollback';
  END IF;
  IF (length(original) - length(replace(original, needle, ''))) / length(needle) <> 1 THEN
    RAISE EXCEPTION 'Group leaderboard appointment predicate not unique';
  END IF;
  replacement := replace(original, needle, substitute);
  EXECUTE replacement;
  SELECT (to_jsonb(p) - 'prosrc' - 'proargdefaults') || jsonb_build_object('arguments', pg_get_function_arguments(p.oid))
    INTO current_meta FROM pg_catalog.pg_proc p WHERE p.oid = target;
  IF current_meta IS DISTINCT FROM original_meta THEN
    RAISE EXCEPTION 'Unexpected metadata change; rolling back the rollback';
  END IF;
  IF pg_get_functiondef(target) <> replacement
     OR md5(pg_get_functiondef(target)) <> 'e1283b5b05d295c1d25888485cc08346' THEN
    RAISE EXCEPTION 'Unexpected body change; rolling back the rollback';
  END IF;
END;
$group_setter_rollback$;
