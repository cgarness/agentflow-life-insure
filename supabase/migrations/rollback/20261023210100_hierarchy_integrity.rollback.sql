-- Rollback for migrations/pending/20261023210100_hierarchy_integrity.sql (hierarchy stabilization M2).
-- Plan: docs/plans/2026-10-23-hierarchy-stabilization/implementation_plan.md §10. Production use requires Chris's
-- separate explicit approval. Reads and writes no rows.
--
-- Restores the exact preimage bodies of public.compute_hierarchy_path, public.update_hierarchy_path and
-- public.cascade_hierarchy_update (baseline 20260806000000, byte-for-byte) and the exact preimage definitions of
-- trg_update_hierarchy_path and trg_cascade_hierarchy_update (CREATE OR REPLACE TRIGGER: readers are not blocked),
-- and drops everything M2 added: the builder, the statement lock trigger and function, the invitation guard and its
-- trigger, private.hierarchy_consistency() and idx_profiles_upline_id.
-- KEPT (re-assert-only hardening): EXECUTE stays revoked from PUBLIC / anon / authenticated on the three restored
-- functions and on on_profile_update, and on_profile_update keeps its pinned search_path. Paths repaired by M3 (or
-- derived while M2 was live) stay correct; from then on the preimage defects apply again to new writes.
-- Re-applying the forward migration after this rollback is supported: its guard accepts exactly this state.
-- M1 is not touched (roll it back separately, after this file, if needed).
-- Guarded: refuses unless every M2 object is exactly the reviewed post-image.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public, pg_temp;

DO $guard$
DECLARE
  v_old_sp text := pg_catalog.current_setting('search_path');
  r        record;
  v        text;
BEGIN
  PERFORM pg_catalog.set_config('search_path', '"$user", public, extensions', true);
  FOR r IN SELECT * FROM (VALUES
      ('private.build_hierarchy_path(uuid,uuid,uuid,boolean)', 'fecfc2995febeb119f0bc5b862e16500', 'postgres'),
      ('public.compute_hierarchy_path(uuid)', '058bb6b37b152aec062c87f8ac929425', 'postgres,service_role'),
      ('private.lock_profile_hierarchy()', 'b186acd328fd756ca42e3126d3bc1ba4', 'postgres'),
      ('public.update_hierarchy_path()', 'f892eb620cdf4d146a112e5b66783d6b', 'postgres,service_role'),
      ('public.cascade_hierarchy_update()', 'e26ddd18e96bffec29d440280176ca2a', 'postgres,service_role'),
      ('private.validate_invitation_upline()', '76f71d54f2ff396080616581f442c87c', 'postgres'),
      ('private.hierarchy_consistency()', 'e1984a07ba5c76004d5f9290d49f2834', 'postgres'),
      ('public.on_profile_update()', '0afa0358aca12d396b9ae50c292bca6f', 'postgres,service_role')) x(fn, digest, acl)
  LOOP
    IF pg_catalog.to_regprocedure(r.fn) IS NULL
       OR md5(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(r.fn))) <> r.digest THEN
      RAISE EXCEPTION 'hierarchy M2 rollback refused: % is not the reviewed M2 post-image', r.fn;
    END IF;
    SELECT string_agg(g, ',' ORDER BY g COLLATE "C") INTO v
      FROM (SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END AS g
              FROM pg_catalog.pg_proc f,
                   pg_catalog.aclexplode(coalesce(f.proacl, pg_catalog.acldefault('f', f.proowner))) a
             WHERE f.oid = r.fn::regprocedure AND a.privilege_type = 'EXECUTE') s;
    IF v IS DISTINCT FROM r.acl THEN
      RAISE EXCEPTION 'hierarchy M2 rollback refused: % ACL drifted (%)', r.fn, v;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('public.profiles', 'trg_update_hierarchy_path', '41c39a180f8715ab543c6a02af00eaf3'),
      ('public.profiles', 'trg_cascade_hierarchy_update', '9540c1a57f6878f9e1b625840c261085'),
      ('public.profiles', 'trg_update_hierarchy_path_lock', '69081184456094326ffbd0b34942e7c1'),
      ('public.invitations', 'trg_validate_invitation_upline', 'c393c409a3d428287db81f720c0a0065')) x(tbl, name, digest)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                    WHERE t.tgrelid = r.tbl::regclass AND t.tgname = r.name
                      AND md5(pg_catalog.pg_get_triggerdef(t.oid)) = r.digest) THEN
      RAISE EXCEPTION 'hierarchy M2 rollback refused: trigger % on % is not the reviewed M2 post-image', r.name, r.tbl;
    END IF;
  END LOOP;
  IF pg_catalog.to_regclass('public.idx_profiles_upline_id') IS NULL
     OR md5(pg_catalog.pg_get_indexdef('public.idx_profiles_upline_id'::regclass)) <> '6200ef769341b8b0667f0716e6101081' THEN
    RAISE EXCEPTION 'hierarchy M2 rollback refused: idx_profiles_upline_id is not the reviewed M2 post-image';
  END IF;
  PERFORM pg_catalog.set_config('search_path', v_old_sp, true);
END $guard$;

-- ── 1. The exact preimage bodies (baseline 20260806000000, byte-for-byte). Owner, definer flag and ACL are kept. ──
CREATE OR REPLACE FUNCTION "public"."compute_hierarchy_path"("target_user_id" "uuid") RETURNS "public"."ltree"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  path_parts TEXT[] := ARRAY[]::TEXT[];
  current_id UUID := target_user_id;
  current_upline UUID;
  max_depth INT := 20; -- Safety valve against circular references
  depth INT := 0;
BEGIN
  LOOP
    -- Prepend current user to path (replace hyphens with underscores for ltree)
    path_parts := ARRAY[REPLACE(current_id::TEXT, '-', '_')] || path_parts;

    -- Get the upline of the current user
    SELECT upline_id INTO current_upline
    FROM public.profiles WHERE id = current_id;

    -- Stop if no upline, self-reference, or max depth reached
    EXIT WHEN current_upline IS NULL OR current_upline = current_id;

    current_id := current_upline;
    depth := depth + 1;
    EXIT WHEN depth >= max_depth;
  END LOOP;

  RETURN text2ltree(array_to_string(path_parts, '.'));
END;
$$;

CREATE OR REPLACE FUNCTION "public"."update_hierarchy_path"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Compute this user's path
  NEW.hierarchy_path := compute_hierarchy_path(NEW.id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."cascade_hierarchy_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  descendant RECORD;
BEGIN
  -- Find all profiles whose upline_id points to the changed user
  -- and recursively update their hierarchy paths
  FOR descendant IN
    SELECT id FROM public.profiles
    WHERE upline_id = NEW.id AND id != NEW.id
  LOOP
    UPDATE public.profiles
    SET hierarchy_path = compute_hierarchy_path(descendant.id)
    WHERE id = descendant.id;
  END LOOP;
  RETURN NEW;
END;
$$;

-- ── 2. The exact preimage trigger definitions (baseline 20260806000000) ─────────────────────────────────────────
CREATE OR REPLACE TRIGGER "trg_update_hierarchy_path" BEFORE INSERT OR UPDATE OF "upline_id" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_hierarchy_path"();
CREATE OR REPLACE TRIGGER "trg_cascade_hierarchy_update" AFTER UPDATE OF "upline_id" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."cascade_hierarchy_update"();

-- ── 3. Everything M2 added ──────────────────────────────────────────────────────────────────────────────────────
DROP TRIGGER trg_update_hierarchy_path_lock ON public.profiles;
DROP TRIGGER trg_validate_invitation_upline ON public.invitations;
DROP FUNCTION private.lock_profile_hierarchy();
DROP FUNCTION private.validate_invitation_upline();
DROP FUNCTION private.hierarchy_consistency();
DROP FUNCTION private.build_hierarchy_path(uuid, uuid, uuid, boolean);
DROP INDEX public.idx_profiles_upline_id;

-- ── 4. Postconditions: exact preimage bodies and triggers, hardened ACLs kept ───────────────────────────────────
DO $post$
DECLARE
  v_old_sp text := pg_catalog.current_setting('search_path');
  r        record;
  v        text;
BEGIN
  PERFORM pg_catalog.set_config('search_path', '"$user", public, extensions', true);
  FOR r IN SELECT * FROM (VALUES
      ('public.compute_hierarchy_path(uuid)', 'b9aaa16d5b974676ce18d55c5dce9e18'),
      ('public.update_hierarchy_path()', 'd9ff2d22fcc0bd5e55ea288850ad1cfe'),
      ('public.cascade_hierarchy_update()', '8392e93e9b09f726dcb097cb54dae522'),
      ('public.on_profile_update()', '0afa0358aca12d396b9ae50c292bca6f')) x(fn, digest)
  LOOP
    SELECT string_agg(g, ',' ORDER BY g COLLATE "C") INTO v
      FROM (SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END AS g
              FROM pg_catalog.pg_proc f,
                   pg_catalog.aclexplode(coalesce(f.proacl, pg_catalog.acldefault('f', f.proowner))) a
             WHERE f.oid = r.fn::regprocedure AND a.privilege_type = 'EXECUTE') s;
    IF md5(pg_catalog.pg_get_functiondef(r.fn::regprocedure)) <> r.digest OR v IS DISTINCT FROM 'postgres,service_role' THEN
      RAISE EXCEPTION 'hierarchy M2 rollback postcondition failed: % (body or ACL %)', r.fn, v;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('trg_update_hierarchy_path', '800fa050d8f940e783b14569fd01faef'),
      ('trg_cascade_hierarchy_update', '869f33cd50c475f78bb754fa9aa8efdd')) x(name, digest)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                    WHERE t.tgrelid = 'public.profiles'::regclass AND t.tgname = r.name AND t.tgenabled = 'O'
                      AND md5(pg_catalog.pg_get_triggerdef(t.oid)) = r.digest) THEN
      RAISE EXCEPTION 'hierarchy M2 rollback postcondition failed: trigger % is not the preimage', r.name;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
              WHERE t.tgname IN ('trg_update_hierarchy_path_lock', 'trg_validate_invitation_upline'))
     OR pg_catalog.to_regclass('public.idx_profiles_upline_id') IS NOT NULL
     OR pg_catalog.to_regprocedure('private.build_hierarchy_path(uuid,uuid,uuid,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'hierarchy M2 rollback postcondition failed: an M2 object remains';
  END IF;
  PERFORM pg_catalog.set_config('search_path', v_old_sp, true);
END $post$;

NOTIFY pgrst, 'reload schema';
