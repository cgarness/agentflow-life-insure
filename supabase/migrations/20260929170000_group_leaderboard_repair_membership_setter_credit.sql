-- Group leaderboard repair. Production requires Chris's separate exact approval. Exactly three changes:
--   1. 42702 fix. The membership check's unqualified `organization_id` collides with the function's own
--      RETURNS TABLE column; production runs plpgsql.variable_conflict = error, so EVERY call raised 42702.
--      Qualified as agency_group_members.organization_id — the column the check always meant. Membership
--      semantics (caller org = get_org_id(), status = 'active', this group) are unchanged; access is not widened.
--   2. Appointments Set = setter credit (AGENT_RULES #23 / #38): ap.user_id = p.id becomes
--      COALESCE(ap.created_by, ap.user_id) = p.id; booking window on created_at unchanged; no status filter.
--   3. appointments_setter_created_at_idx ON (COALESCE(created_by, user_id), created_at): keeps (2) on an index path.
-- Standalone NEW migration only; refuses a drifted definition, owner, ACL, an existing index name, or a replay.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';
DO $group_repair$
DECLARE
  target oid := to_regprocedure('public.get_agency_group_leaderboard(uuid,text)');
  original text;
  replacement text;
  original_meta jsonb;
  current_meta jsonb;
  membership_needle text := E'      AND organization_id = v_caller_org\n';
  membership_fix    text := E'      AND agency_group_members.organization_id = v_caller_org\n';
  setter_needle     text := E'    WHERE ap.user_id = p.id\n';
  setter_fix        text := E'    WHERE COALESCE(ap.created_by, ap.user_id) = p.id\n';
BEGIN
  IF target IS NULL THEN RAISE EXCEPTION 'Group leaderboard target missing'; END IF;
  -- proargdefaults stores the DEFAULT's source-text offset, which re-creation can move; its meaning is compared
  -- through pg_get_function_arguments (which renders the DEFAULT) instead.
  SELECT pg_get_functiondef(p.oid),
         (to_jsonb(p) - 'prosrc' - 'proargdefaults') || jsonb_build_object('arguments', pg_get_function_arguments(p.oid))
    INTO original, original_meta FROM pg_catalog.pg_proc p WHERE p.oid = target;
  IF md5(original) <> 'e1283b5b05d295c1d25888485cc08346' THEN
    RAISE EXCEPTION 'Group leaderboard definition changed; refusing repair';
  END IF;
  IF (SELECT proowner <> 'postgres'::regrole
      OR proacl IS DISTINCT FROM ARRAY['=X/postgres','postgres=X/postgres','anon=X/postgres','authenticated=X/postgres','service_role=X/postgres']::aclitem[]
      FROM pg_catalog.pg_proc WHERE oid = target) THEN
    RAISE EXCEPTION 'Group leaderboard owner or ACL changed; refusing repair';
  END IF;
  IF (length(original) - length(replace(original, membership_needle, ''))) / length(membership_needle) <> 1
     OR (length(original) - length(replace(original, setter_needle, ''))) / length(setter_needle) <> 1 THEN
    RAISE EXCEPTION 'Group leaderboard repair locations not unique';
  END IF;
  IF to_regclass('public.appointments_setter_created_at_idx') IS NOT NULL THEN
    RAISE EXCEPTION 'appointments_setter_created_at_idx already exists; refusing repair';
  END IF;
  replacement := replace(replace(original, membership_needle, membership_fix), setter_needle, setter_fix);
  EXECUTE replacement;
  SELECT (to_jsonb(p) - 'prosrc' - 'proargdefaults') || jsonb_build_object('arguments', pg_get_function_arguments(p.oid))
    INTO current_meta FROM pg_catalog.pg_proc p WHERE p.oid = target;
  IF current_meta IS DISTINCT FROM original_meta THEN
    RAISE EXCEPTION 'Unexpected metadata change; rolling back repair';
  END IF;
  IF pg_get_functiondef(target) <> replacement
     OR md5(pg_get_functiondef(target)) <> '8bd49ee01e0b92abd3e66548569f36bb' THEN
    RAISE EXCEPTION 'Unexpected body change; rolling back repair';
  END IF;
  EXECUTE 'CREATE INDEX appointments_setter_created_at_idx ON public.appointments USING btree ((COALESCE(created_by, user_id)), created_at)';
  IF pg_get_indexdef('public.appointments_setter_created_at_idx'::regclass)
     <> 'CREATE INDEX appointments_setter_created_at_idx ON public.appointments USING btree (COALESCE(created_by, user_id), created_at)' THEN
    RAISE EXCEPTION 'Unexpected index definition; rolling back repair';
  END IF;
END;
$group_repair$;
