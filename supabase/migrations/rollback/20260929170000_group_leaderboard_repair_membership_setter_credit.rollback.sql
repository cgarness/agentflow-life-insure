-- ROLLBACK for 20260929170000_group_leaderboard_repair_membership_setter_credit.sql — NOT a forward migration.
-- STATUS: prepared, never applied. Apply only with Chris's separate exact approval, as a NEW migration.
-- Restores the exact pre-repair state: the function returns to the production preimage (md5
-- e1283b5b05d295c1d25888485cc08346 — which raises 42702 on every call under variable_conflict = error), the setter
-- index is dropped, and EXECUTE returns to the exact production ACL, element order included:
-- {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres} (which
-- re-opens PUBLIC/anon EXECUTE — only with explicit approval). Refuses anything but the exact post-repair function,
-- owner, ACL and index; replay refuses.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';
DO $group_repair_rollback$
DECLARE
  target oid := to_regprocedure('public.get_agency_group_leaderboard(uuid,text)');
  original text;
  replacement text;
  original_meta jsonb;
  current_meta jsonb;
  membership_needle text := E'      AND agency_group_members.organization_id = v_caller_org\n';
  membership_back   text := E'      AND organization_id = v_caller_org\n';
  setter_needle     text := E'    WHERE COALESCE(ap.created_by, ap.user_id) = p.id\n';
  setter_back       text := E'    WHERE ap.user_id = p.id\n';
BEGIN
  IF target IS NULL THEN RAISE EXCEPTION 'Group leaderboard target missing'; END IF;
  SELECT pg_get_functiondef(p.oid),
         (to_jsonb(p) - 'prosrc' - 'proargdefaults') || jsonb_build_object('arguments', pg_get_function_arguments(p.oid))
    INTO original, original_meta FROM pg_catalog.pg_proc p WHERE p.oid = target;
  IF md5(original) <> '8bd49ee01e0b92abd3e66548569f36bb' THEN
    RAISE EXCEPTION 'Group leaderboard definition is not the repaired version; refusing rollback';
  END IF;
  IF (SELECT proowner <> 'postgres'::regrole
      OR proacl IS DISTINCT FROM ARRAY['postgres=X/postgres','authenticated=X/postgres','service_role=X/postgres']::aclitem[]
      FROM pg_catalog.pg_proc WHERE oid = target) THEN
    RAISE EXCEPTION 'Group leaderboard owner or ACL changed; refusing rollback';
  END IF;
  IF to_regclass('public.appointments_setter_created_at_idx') IS NULL
     OR pg_get_indexdef('public.appointments_setter_created_at_idx'::regclass)
        <> 'CREATE INDEX appointments_setter_created_at_idx ON public.appointments USING btree (COALESCE(created_by, user_id), created_at)' THEN
    RAISE EXCEPTION 'appointments_setter_created_at_idx missing or changed; refusing rollback';
  END IF;
  IF (length(original) - length(replace(original, membership_needle, ''))) / length(membership_needle) <> 1
     OR (length(original) - length(replace(original, setter_needle, ''))) / length(setter_needle) <> 1 THEN
    RAISE EXCEPTION 'Group leaderboard repair locations not unique';
  END IF;
  replacement := replace(replace(original, membership_needle, membership_back), setter_needle, setter_back);
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
  EXECUTE 'DROP INDEX public.appointments_setter_created_at_idx';
  -- Rebuild the production ACL in its original element order: clear every entry (the owner's included), then grant
  -- in the order production's array lists them.
  EXECUTE 'REVOKE ALL ON FUNCTION public.get_agency_group_leaderboard(UUID, TEXT) FROM PUBLIC, postgres, anon, authenticated, service_role';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_agency_group_leaderboard(UUID, TEXT) TO PUBLIC';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_agency_group_leaderboard(UUID, TEXT) TO postgres';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_agency_group_leaderboard(UUID, TEXT) TO anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_agency_group_leaderboard(UUID, TEXT) TO authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_agency_group_leaderboard(UUID, TEXT) TO service_role';
  IF (SELECT proacl IS DISTINCT FROM ARRAY['=X/postgres','postgres=X/postgres','anon=X/postgres','authenticated=X/postgres','service_role=X/postgres']::aclitem[]
      FROM pg_catalog.pg_proc WHERE oid = target) THEN
    RAISE EXCEPTION 'Production ACL not restored exactly; rolling back the rollback';
  END IF;
END;
$group_repair_rollback$;
